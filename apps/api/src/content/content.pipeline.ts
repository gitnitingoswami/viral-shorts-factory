import { Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';
import type { SourceRef } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_CONTENT_CHECKS, QUEUE_CONTENT } from '../common/constants';
import {
  CodeVerificationEntity,
  ContentIdeaEntity,
  ScriptClaimEntity,
  ScriptReviewEntity,
  ScriptVersionEntity,
  VideoScriptEntity,
} from '../database/content.entities';
import { NicheEntity, RawSignalEntity, TrendTopicEntity } from '../database/research.entities';
import { JobsService } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { closestIdea, evidenceFound, normalizeScenes, scriptMetrics, SIMILARITY_FLAG, versionHash } from './content-utils';
import { PROMPTS } from './prompts';
import { SandboxService } from './sandbox.service';
import { FactCheckSchema, IdeasSchema, QualitySchema, ScriptSchema } from './schemas';
import { createHash } from 'node:crypto';

export type Heartbeat = (progress: number) => Promise<boolean>;

export class LeaseLostError extends Error {
  constructor() {
    super('Job lease lost; another worker may have taken over');
  }
}

interface SourceItem {
  signalId: string;
  url: string;
  title: string;
  source: string;
  /** Text the fact-check may quote: title plus raw metrics (all that is stored about a signal). */
  text: string;
}

/**
 * Worker-side content generation and checks. Each method is idempotent for its job (re-running replaces the
 * outputs of that job/version rather than duplicating them).
 */
@Injectable()
export class ContentPipeline {
  private readonly logger = new Logger(ContentPipeline.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly llm: LlmService,
    private readonly sandbox: SandboxService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ ideas

  async generateIdeas(topicId: string, workspaceId: string, jobId: string): Promise<{ ideas: number; flagged: number }> {
    const m = this.dataSource.manager;
    const topic = await m.findOneByOrFail(TrendTopicEntity, { id: topicId, workspaceId });
    const niche = await m.findOneByOrFail(NicheEntity, { id: topic.nicheId });
    const sources = await this.sourcesForTopic(topic.id);
    // A retry of this job must not compare against (or point at) the ideas it wrote on an earlier attempt.
    const already = await m.find(ContentIdeaEntity, { where: { jobId } });
    if (already.some((i) => i.status === 'selected')) {
      return { ideas: already.length, flagged: already.filter((i) => i.duplicateOfId).length };
    }
    const previous = await m.find(ContentIdeaEntity, {
      where: [
        { workspaceId, jobId: Not(jobId) },
        { workspaceId, jobId: IsNull() }, // ideas whose job record was deleted
      ],
      order: { createdAt: 'DESC' },
      take: 500,
    });

    const res = await this.llm.generate(
      {
        task: 'ideas',
        promptRef: PROMPTS.ideas.ref,
        system: PROMPTS.ideas.system,
        input: {
          niche: { name: niche.name, description: niche.description, keywords: niche.keywords },
          topic: { title: topic.title, score: topic.score, sources: topic.sources },
          sources: sources.map(({ url, title, source }) => ({ url, title, source })),
          previousIdeas: previous.slice(0, 50).map((p) => p.title),
        },
        schema: IdeasSchema,
        effort: 'medium',
        maxTokens: 16000,
      },
      { workspaceId, relatedType: 'trend_topic', relatedId: topicId, jobId },
    );

    const byUrl = new Map(sources.map((s) => [s.url, s]));
    const batch: Array<{ id: string; title: string; hook: string }> = [];
    let flagged = 0;
    await this.dataSource.transaction(async (tx) => {
      await tx.delete(ContentIdeaEntity, { jobId }); // idempotent per job
      for (const idea of res.data.ideas) {
        const closest = closestIdea(idea, [...batch, ...previous]);
        const isDup = closest.score >= SIMILARITY_FLAG;
        if (isDup) flagged++;
        const sourceRefs: SourceRef[] = idea.sourceUrls
          .map((u) => byUrl.get(u))
          .filter((s): s is SourceItem => Boolean(s))
          .map((s) => ({ signalId: s.signalId, url: s.url, title: s.title }));
        const saved = await tx.save(
          tx.create(ContentIdeaEntity, {
            workspaceId,
            topicId,
            title: idea.title,
            audience: idea.audience,
            angle: idea.angle,
            hook: idea.hook,
            valueProposition: idea.valueProposition,
            format: idea.format,
            targetDurationSec: idea.targetDurationSec,
            sourceRefs,
            similarityScore: Math.round(closest.score * 1000) / 1000,
            duplicateOfId: isDup ? closest.id : null,
            status: 'proposed',
            llmModel: res.model,
            promptRef: PROMPTS.ideas.ref,
            llmMock: res.mock,
            jobId,
          }),
        );
        batch.push({ id: saved.id, title: saved.title, hook: saved.hook });
      }
    });
    return { ideas: res.data.ideas.length, flagged };
  }

  // ------------------------------------------------------------------ script

  async generateScript(scriptId: string, workspaceId: string, jobId: string): Promise<{ version: number }> {
    const m = this.dataSource.manager;
    const script = await m.findOneByOrFail(VideoScriptEntity, { id: scriptId, workspaceId });
    if (script.currentVersion >= 1) return { version: script.currentVersion }; // already generated
    const idea = await m.findOneByOrFail(ContentIdeaEntity, { id: script.ideaId });
    const topic = await m.findOneByOrFail(TrendTopicEntity, { id: idea.topicId });
    const sources = await this.sourcesForTopic(topic.id);

    const res = await this.llm.generate(
      {
        task: 'script',
        promptRef: PROMPTS.script.ref,
        system: PROMPTS.script.system,
        input: {
          topic: { title: topic.title },
          idea: { title: idea.title, audience: idea.audience, angle: idea.angle, hook: idea.hook, valueProposition: idea.valueProposition, format: idea.format, targetDurationSec: idea.targetDurationSec },
          sources: sources.map(({ url, title, source }) => ({ url, title, source })),
        },
        schema: ScriptSchema,
        effort: 'high',
        maxTokens: 32000,
      },
      { workspaceId, relatedType: 'video_script', relatedId: scriptId, jobId },
    );

    const scenes = normalizeScenes(res.data.scenes);
    const { wordCount, estDurationSec } = scriptMetrics(scenes);
    const versionId = await this.dataSource.transaction(async (tx) => {
      const claimed = await tx.query<[Array<{ current_version: number }>, number]>(
        `UPDATE video_script SET current_version = 1, status = 'in_review', title = $2, updated_at = now() WHERE id = $1 AND current_version = 0 RETURNING current_version`,
        [scriptId, res.data.title],
      );
      if (!claimed[1]) return null;
      const v = await tx.save(
        tx.create(ScriptVersionEntity, {
          scriptId,
          version: 1,
          authorType: 'ai',
          authorId: null,
          title: res.data.title,
          body: { scenes },
          contentHash: versionHash(res.data.title, scenes),
          wordCount,
          estDurationSec,
          llmModel: res.model,
          promptRef: PROMPTS.script.ref,
          llmMock: res.mock,
        }),
      );
      return v.id;
    });
    if (versionId) await this.enqueueChecks(versionId, workspaceId, `${versionId}:initial`);
    return { version: 1 };
  }

  async enqueueChecks(versionId: string, workspaceId: string, key: string, createdBy: string | null = null) {
    return this.jobs.enqueue({
      type: JOB_TYPE_CONTENT_CHECKS,
      queue: QUEUE_CONTENT,
      idempotencyKey: `${JOB_TYPE_CONTENT_CHECKS}:${key}`,
      input: { versionId },
      maxAttempts: 2,
      workspaceId,
      createdBy,
    });
  }

  // ------------------------------------------------------------------ checks

  /** Fact-check, quality review and code verification for one version; each step fails independently. */
  async runChecks(versionId: string, workspaceId: string, jobId: string, heartbeat: Heartbeat): Promise<Record<string, string>> {
    const m = this.dataSource.manager;
    const version = await m.findOneByOrFail(ScriptVersionEntity, { id: versionId });
    const script = await m.findOneByOrFail(VideoScriptEntity, { id: version.scriptId, workspaceId });
    const idea = await m.findOneByOrFail(ContentIdeaEntity, { id: script.ideaId });
    const topic = await m.findOneByOrFail(TrendTopicEntity, { id: idea.topicId });
    const sources = await this.sourcesForTopic(topic.id);
    const scenes = version.body.scenes;
    const ctx = { workspaceId, relatedType: 'script_version', relatedId: versionId, jobId };

    // Claim the run. The API queues a run by setting all states to pending (and refuses while any is pending or
    // running), so at most one run is queued per version. A redelivered job takes over any unfinished run, even one
    // where a crashed worker already finished some steps (all steps are redone). A run with every step done or
    // failed is complete and is skipped. Lease ownership (beat) keeps a stale worker from writing.
    const started = await this.dataSource.transaction(async (tx) => {
      const claimed = await tx.query<[unknown[], number]>(
        `UPDATE script_version SET fact_check_state = 'running', quality_state = 'running', code_state = 'running'
         WHERE id = $1 AND (fact_check_state IN ('pending', 'running') OR quality_state IN ('pending', 'running') OR code_state IN ('pending', 'running'))
         RETURNING id`,
        [versionId],
      );
      if (!claimed[1]) return false;
      await tx.delete(ScriptClaimEntity, { scriptVersionId: versionId });
      await tx.delete(CodeVerificationEntity, { scriptVersionId: versionId });
      await tx.delete(ScriptReviewEntity, { scriptVersionId: versionId, kind: 'ai_quality' });
      return true;
    });
    if (!started) return { skipped: 'checks already completed for this run' };
    const beat = async (p: number) => {
      if (!(await heartbeat(p))) throw new LeaseLostError();
    };

    const outcome: Record<string, string> = {};

    // 1) fact-check
    try {
      await beat(10);
      const res = await this.llm.generate(
        {
          task: 'factcheck',
          promptRef: PROMPTS.factcheck.ref,
          system: PROMPTS.factcheck.system,
          input: {
            topic: { title: topic.title },
            scenes: scenes.map((s) => ({ index: s.index, narration: s.narration, onScreenText: s.onScreenText })),
            sources: sources.map((s) => ({ url: s.url, text: s.text })),
          },
          schema: FactCheckSchema,
          effort: 'high',
          maxTokens: 16000,
        },
        ctx,
      );
      const byUrl = new Map(sources.map((s) => [s.url, s]));
      const rows = res.data.claims
        // Out-of-range scene indexes are kept (clamped) and can't be marked supported below.
        .map((c) => ({ ...c, outOfRange: c.sceneIndex < 0 || c.sceneIndex >= scenes.length, sceneIndex: Math.min(Math.max(c.sceneIndex, 0), scenes.length - 1) }))
        .map((c) => {
          const src = c.sourceUrl ? byUrl.get(c.sourceUrl) : undefined;
          // Downgrade any verdict whose quote does not literally appear in the cited source.
          const verified = !c.outOfRange && c.verdict !== 'unsupported' && src !== undefined && evidenceFound(c.evidence, [src.text], c.text);
          return {
            scriptVersionId: versionId,
            sceneIndex: c.sceneIndex,
            text: c.text,
            verdict: verified ? c.verdict : ('unsupported' as const),
            evidence: verified ? c.evidence : null,
            sourceRef: verified && src ? { signalId: src.signalId, url: src.url, title: src.title } : null,
          };
        });
      await beat(35);
      if (rows.length) await m.insert(ScriptClaimEntity, rows);
      await beat(38);
      await m.update(ScriptVersionEntity, { id: versionId }, { factCheckState: 'done' });
      outcome.factCheck = `done (${rows.length} claims)`;
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      await m.update(ScriptVersionEntity, { id: versionId }, { factCheckState: 'failed' });
      outcome.factCheck = `failed: ${errMsg(err)}`;
    }
    await beat(40);

    // 2) quality review (advisory)
    try {
      const res = await this.llm.generate(
        {
          task: 'quality',
          promptRef: PROMPTS.quality.ref,
          system: PROMPTS.quality.system,
          input: { title: version.title, estDurationSec: version.estDurationSec, scenes },
          schema: QualitySchema,
          effort: 'medium',
          maxTokens: 8000,
        },
        ctx,
      );
      await beat(55);
      await m.insert(ScriptReviewEntity, {
        scriptVersionId: versionId,
        kind: 'ai_quality',
        scores: res.data.scores,
        issues: res.data.issues,
        decision: null,
        llmModel: res.model,
        promptRef: PROMPTS.quality.ref,
      });
      await beat(58);
      await m.update(ScriptVersionEntity, { id: versionId }, { qualityState: 'done' });
      outcome.quality = 'done';
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      await m.update(ScriptVersionEntity, { id: versionId }, { qualityState: 'failed' });
      outcome.quality = `failed: ${errMsg(err)}`;
    }
    await beat(60);

    // 3) code verification (sandbox)
    try {
      for (const s of scenes) {
        if (!s.code) continue;
        const r = await this.sandbox.run(s.code.language, s.code.source);
        await beat(60 + 30 * ((s.index + 1) / scenes.length));
        await m.insert(CodeVerificationEntity, {
          scriptVersionId: versionId,
          sceneIndex: s.index,
          language: s.code.language,
          codeHash: createHash('sha256').update(s.code.source).digest('hex'),
          status: r.status,
          stdout: r.stdout,
          stderr: r.stderr,
          durationMs: r.durationMs,
        });
      }
      await beat(95);
      await m.update(ScriptVersionEntity, { id: versionId }, { codeState: 'done' });
      outcome.code = 'done';
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      await m.update(ScriptVersionEntity, { id: versionId }, { codeState: 'failed' });
      outcome.code = `failed: ${errMsg(err)}`;
    }

    await this.audit.record({ actorType: 'worker', workspaceId, action: 'script.checks_finished', subjectType: 'script_version', subjectId: versionId, outcome: 'success', details: outcome });
    return outcome;
  }

  /** Marks still-running check states failed (job ran out of attempts). */
  async markChecksFailed(versionId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE script_version SET
         fact_check_state = CASE WHEN fact_check_state IN ('pending','running') THEN 'failed' ELSE fact_check_state END,
         quality_state = CASE WHEN quality_state IN ('pending','running') THEN 'failed' ELSE quality_state END,
         code_state = CASE WHEN code_state IN ('pending','running') THEN 'failed' ELSE code_state END
       WHERE id = $1`,
      [versionId],
    );
  }

  private async sourcesForTopic(topicId: string): Promise<SourceItem[]> {
    const signals = await this.dataSource.manager
      .createQueryBuilder(RawSignalEntity, 's')
      .innerJoin('trend_topic_signal', 'ts', 'ts.signal_id = s.id')
      .where('ts.topic_id = :topicId', { topicId })
      .orderBy('s.published_at', 'DESC', 'NULLS LAST')
      .limit(8)
      .getMany();
    return signals.map((s) => ({
      signalId: s.id,
      url: s.url,
      title: s.title,
      source: s.sourceKey,
      text: `${s.title} (${Object.entries(s.metrics).map(([k, v]) => `${k}: ${v}`).join(', ')})`,
    }));
  }
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : 'error').slice(0, 200);
}
