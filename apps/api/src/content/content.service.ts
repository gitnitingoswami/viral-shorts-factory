import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type {
  CodeVerificationDto,
  ContentIdeaDto,
  CreateScriptVersionRequest,
  JobDto,
  Page,
  ScriptClaimDto,
  ScriptDecisionRequest,
  ScriptDetailDto,
  ScriptDto,
  ScriptReviewDto,
  ScriptVersionDto,
  SelectIdeaResponse,
} from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_CONTENT_IDEAS, JOB_TYPE_CONTENT_SCRIPT, QUEUE_CONTENT } from '../common/constants';
import {
  CodeVerificationEntity,
  ContentIdeaEntity,
  ScriptClaimEntity,
  ScriptReviewEntity,
  ScriptVersionEntity,
  VideoScriptEntity,
} from '../database/content.entities';
import { TrendTopicEntity } from '../database/research.entities';
import { JobsService } from '../jobs/jobs.service';
import { approvalBlockers, normalizeScenes, scriptMetrics, versionHash } from './content-utils';
import { ContentPipeline } from './content.pipeline';

export interface Actor {
  userId: string;
  workspaceId: string;
  correlationId: string | null;
}

function toIdeaDto(i: ContentIdeaEntity, topicTitle: string): ContentIdeaDto {
  return {
    id: i.id,
    topicId: i.topicId,
    topicTitle,
    title: i.title,
    audience: i.audience,
    angle: i.angle,
    hook: i.hook,
    valueProposition: i.valueProposition,
    format: i.format,
    targetDurationSec: i.targetDurationSec,
    sourceRefs: i.sourceRefs,
    similarityScore: i.similarityScore,
    duplicateOfId: i.duplicateOfId,
    status: i.status,
    llm: { model: i.llmModel, promptRef: i.promptRef, mock: i.llmMock },
    createdAt: i.createdAt.toISOString(),
  };
}

function toScriptDto(s: VideoScriptEntity): ScriptDto {
  return {
    id: s.id,
    ideaId: s.ideaId,
    title: s.title,
    status: s.status,
    currentVersion: s.currentVersion,
    approvedVersion: s.approvedVersion,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const toClaimDto = (c: ScriptClaimEntity): ScriptClaimDto => ({
  id: c.id,
  sceneIndex: c.sceneIndex,
  text: c.text,
  verdict: c.verdict,
  evidence: c.evidence,
  sourceRef: c.sourceRef,
  overrideReason: c.overrideReason,
});

const toCodeDto = (c: CodeVerificationEntity): CodeVerificationDto => ({
  id: c.id,
  sceneIndex: c.sceneIndex,
  language: c.language,
  status: c.status,
  stdout: c.stdout,
  stderr: c.stderr,
  durationMs: c.durationMs,
  overrideReason: c.overrideReason,
});

const toReviewDto = (r: ScriptReviewEntity): ScriptReviewDto => ({
  id: r.id,
  kind: r.kind,
  scores: r.scores,
  issues: r.issues,
  decision: r.decision,
  note: r.note,
  reviewerId: r.reviewerId,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class ContentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: JobsService,
    private readonly pipeline: ContentPipeline,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ ideas

  async requestIdeas(topicId: string, idempotencyKey: string, actor: Actor): Promise<JobDto> {
    const topic = await this.dataSource.manager.findOneBy(TrendTopicEntity, { id: topicId, workspaceId: actor.workspaceId });
    if (!topic) throw new NotFoundException('Topic not found');
    if (topic.status !== 'approved') throw new ConflictException('Ideas can only be generated for approved topics');
    const { job } = await this.jobs.enqueue({
      type: JOB_TYPE_CONTENT_IDEAS,
      queue: QUEUE_CONTENT,
      idempotencyKey: `${JOB_TYPE_CONTENT_IDEAS}:${actor.workspaceId}:${idempotencyKey}`,
      input: { topicId },
      maxAttempts: 3,
      workspaceId: actor.workspaceId,
      createdBy: actor.userId,
      correlationId: actor.correlationId,
    });
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'content.ideas_requested', subjectType: 'trend_topic', subjectId: topicId, outcome: 'success', correlationId: actor.correlationId, details: { jobId: job.id } });
    return job;
  }

  async listIdeas(workspaceId: string, q: { topicId?: string; status?: string; limit: number; offset: number }): Promise<Page<ContentIdeaDto>> {
    const qb = this.dataSource.manager
      .createQueryBuilder(ContentIdeaEntity, 'i')
      .innerJoin(TrendTopicEntity, 't', 't.id = i.topic_id')
      .addSelect('t.title', 'topic_title')
      .where('i.workspace_id = :workspaceId', { workspaceId });
    if (q.topicId) qb.andWhere('i.topic_id = :topicId', { topicId: q.topicId });
    if (q.status) qb.andWhere('i.status = :status', { status: q.status });
    qb.orderBy('i.created_at', 'DESC').addOrderBy('i.id', 'ASC').offset(q.offset).limit(q.limit);
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    return {
      items: entities.map((e, i) => toIdeaDto(e, String((raw[i] as { topic_title: string }).topic_title))),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  /** Selecting an idea creates its script (one per idea) and enqueues generation. Idempotent. */
  async selectIdea(ideaId: string, actor: Actor): Promise<SelectIdeaResponse> {
    const m = this.dataSource.manager;
    const idea = await m.findOneBy(ContentIdeaEntity, { id: ideaId, workspaceId: actor.workspaceId });
    if (!idea) throw new NotFoundException('Idea not found');
    // Atomic transition: a concurrent discard can't win after this succeeds (and vice versa).
    const moved = await m.query<[unknown[], number]>(
      `UPDATE content_idea SET status = 'selected', updated_at = now() WHERE id = $1 AND status IN ('proposed', 'selected') RETURNING id`,
      [ideaId],
    );
    if (!moved[1]) throw new ConflictException('Idea was discarded');
    await m.createQueryBuilder().insert().into(VideoScriptEntity).values({ workspaceId: actor.workspaceId, ideaId, title: idea.title, status: 'drafting' }).orIgnore().execute();
    const script = await m.findOneByOrFail(VideoScriptEntity, { ideaId });
    const { job } = await this.jobs.enqueue({
      type: JOB_TYPE_CONTENT_SCRIPT,
      queue: QUEUE_CONTENT,
      idempotencyKey: `${JOB_TYPE_CONTENT_SCRIPT}:${script.id}`,
      input: { scriptId: script.id },
      maxAttempts: 3,
      workspaceId: actor.workspaceId,
      createdBy: actor.userId,
      correlationId: actor.correlationId,
    });
    if (script.jobId !== job.id) await m.update(VideoScriptEntity, { id: script.id }, { jobId: job.id });
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'content.idea_selected', subjectType: 'content_idea', subjectId: ideaId, outcome: 'success', correlationId: actor.correlationId, details: { scriptId: script.id } });
    return { scriptId: script.id, job };
  }

  async discardIdea(ideaId: string, actor: Actor): Promise<ContentIdeaDto> {
    const m = this.dataSource.manager;
    const idea = await m.findOneBy(ContentIdeaEntity, { id: ideaId, workspaceId: actor.workspaceId });
    if (!idea) throw new NotFoundException('Idea not found');
    const moved = await m.query<[unknown[], number]>(
      `UPDATE content_idea SET status = 'discarded', updated_at = now() WHERE id = $1 AND status IN ('proposed', 'discarded') RETURNING id`,
      [ideaId],
    );
    if (!moved[1]) throw new ConflictException('A selected idea cannot be discarded');
    idea.status = 'discarded';
    const topic = await m.findOneByOrFail(TrendTopicEntity, { id: idea.topicId });
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'content.idea_discarded', subjectType: 'content_idea', subjectId: ideaId, outcome: 'success', correlationId: actor.correlationId });
    return toIdeaDto(idea, topic.title);
  }

  // ------------------------------------------------------------------ scripts

  async listScripts(workspaceId: string, q: { status?: string; limit: number; offset: number }): Promise<Page<ScriptDto>> {
    const [rows, total] = await this.dataSource.manager.findAndCount(VideoScriptEntity, {
      where: { workspaceId, ...(q.status ? { status: q.status as ScriptDto['status'] } : {}) },
      order: { updatedAt: 'DESC' },
      take: q.limit,
      skip: q.offset,
    });
    return { items: rows.map(toScriptDto), total, limit: q.limit, offset: q.offset };
  }

  async getScript(workspaceId: string, id: string): Promise<ScriptDetailDto> {
    const script = await this.script(workspaceId, id);
    const versions = await this.dataSource.manager.find(ScriptVersionEntity, {
      where: { scriptId: id },
      order: { version: 'ASC' },
      select: { id: true, version: true, authorType: true, createdAt: true },
    });
    return { ...toScriptDto(script), versions: versions.map((v) => ({ version: v.version, authorType: v.authorType, createdAt: v.createdAt.toISOString() })) };
  }

  async getVersion(workspaceId: string, scriptId: string, version: number): Promise<ScriptVersionDto> {
    const script = await this.script(workspaceId, scriptId);
    const v = await this.dataSource.manager.findOneBy(ScriptVersionEntity, { scriptId, version });
    if (!v) throw new NotFoundException('Version not found');
    return this.versionDto(script, v);
  }

  /** Human edit → new immutable version (optimistic concurrency on current_version), then re-run checks. */
  async createVersion(scriptId: string, body: CreateScriptVersionRequest, actor: Actor): Promise<ScriptVersionDto> {
    await this.script(actor.workspaceId, scriptId);
    const scenes = normalizeScenes(body.scenes);
    const { wordCount, estDurationSec } = scriptMetrics(scenes);
    const title = body.title.trim();
    const saved = await this.dataSource.transaction(async (tx) => {
      const bumped = await tx.query<[Array<{ current_version: number }>, number]>(
        `UPDATE video_script SET current_version = current_version + 1, status = 'in_review', approved_version = NULL, title = $3, updated_at = now()
         WHERE id = $1 AND current_version = $2 AND current_version >= 1 RETURNING current_version`,
        [scriptId, body.baseVersion, title],
      );
      if (!bumped[1]) throw new ConflictException('This script changed since you started editing (stale baseVersion); reload and try again');
      return tx.save(
        tx.create(ScriptVersionEntity, {
          scriptId,
          version: bumped[0][0].current_version,
          authorType: 'human',
          authorId: actor.userId,
          title,
          body: { scenes },
          contentHash: versionHash(title, scenes),
          wordCount,
          estDurationSec,
          llmModel: null,
          promptRef: null,
          llmMock: null,
        }),
      );
    });
    await this.pipeline.enqueueChecks(saved.id, actor.workspaceId, `${saved.id}:initial`, actor.userId);
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'script.version_created', subjectType: 'video_script', subjectId: scriptId, outcome: 'success', correlationId: actor.correlationId, details: { version: saved.version, hash: saved.contentHash } });
    return this.getVersion(actor.workspaceId, scriptId, saved.version);
  }

  async rerunChecks(scriptId: string, version: number, nonce: string, actor: Actor): Promise<JobDto> {
    await this.script(actor.workspaceId, scriptId);
    const v = await this.dataSource.manager.findOneBy(ScriptVersionEntity, { scriptId, version });
    if (!v) throw new NotFoundException('Version not found');
    const revoked = await this.dataSource.transaction(async (tx) => {
      // Same lock order as decide(): script row, then version row.
      const [s] = await tx.query<Array<{ status: string; approved_version: number | null }>>(
        `SELECT status, approved_version FROM video_script WHERE id = $1 FOR UPDATE`,
        [scriptId],
      );
      await tx.query(`SELECT id FROM script_version WHERE id = $1 FOR UPDATE`, [v.id]);
      // Atomic claim of a new check run: refused while one is queued or running (no overlapping runs).
      const claimed = await tx.query<[unknown[], number]>(
        `UPDATE script_version SET fact_check_state = 'pending', quality_state = 'pending', code_state = 'pending'
         WHERE id = $1 AND fact_check_state NOT IN ('pending', 'running') AND quality_state NOT IN ('pending', 'running')
           AND code_state NOT IN ('pending', 'running') RETURNING id`,
        [v.id],
      );
      if (!claimed[1]) throw new ConflictException('Checks are already queued or running for this version');
      // Re-checking an approved version revokes the approval until it passes again.
      if (s.status === 'approved' && s.approved_version === version) {
        await tx.query(`UPDATE video_script SET status = 'in_review', approved_version = NULL, updated_at = now() WHERE id = $1`, [scriptId]);
        return true;
      }
      return false;
    });
    const { job } = await this.pipeline.enqueueChecks(v.id, actor.workspaceId, `${v.id}:${nonce}`, actor.userId);
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'script.checks_requested', subjectType: 'script_version', subjectId: v.id, outcome: 'success', correlationId: actor.correlationId, details: { approvalRevoked: revoked } });
    return job;
  }

  async overrideClaim(claimId: string, reason: string, actor: Actor): Promise<ScriptClaimDto> {
    const claim = await this.dataSource.manager.findOneBy(ScriptClaimEntity, { id: claimId });
    if (!claim) throw new NotFoundException('Claim not found');
    await this.assertVersionInWorkspace(claim.scriptVersionId, actor.workspaceId);
    if (claim.verdict !== 'unsupported' && claim.verdict !== 'contradicted') throw new ConflictException('Only unsupported or contradicted claims can be overridden');
    const previous = claim.verdict;
    claim.verdict = 'overridden';
    claim.overrideReason = reason.trim();
    claim.overriddenBy = actor.userId;
    await this.dataSource.manager.save(claim);
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'script.claim_overridden', subjectType: 'script_claim', subjectId: claimId, outcome: 'success', correlationId: actor.correlationId, details: { previous, reason: claim.overrideReason.slice(0, 500) } });
    return toClaimDto(claim);
  }

  async overrideCode(checkId: string, reason: string, actor: Actor): Promise<CodeVerificationDto> {
    const check = await this.dataSource.manager.findOneBy(CodeVerificationEntity, { id: checkId });
    if (!check) throw new NotFoundException('Code check not found');
    await this.assertVersionInWorkspace(check.scriptVersionId, actor.workspaceId);
    if (check.status !== 'failed' && check.status !== 'unavailable') throw new ConflictException('Only failed or unavailable code checks can be overridden');
    const previous = check.status;
    check.status = 'overridden';
    check.overrideReason = reason.trim();
    check.overriddenBy = actor.userId;
    await this.dataSource.manager.save(check);
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'script.code_check_overridden', subjectType: 'code_verification', subjectId: checkId, outcome: 'success', correlationId: actor.correlationId, details: { previous, reason: check.overrideReason.slice(0, 500) } });
    return toCodeDto(check);
  }

  /** Human decision bound to the current version's content hash; approval requires all gates (409 with blockers). */
  async decide(scriptId: string, body: ScriptDecisionRequest, actor: Actor): Promise<ScriptDto> {
    const script = await this.script(actor.workspaceId, scriptId);
    if (body.version !== script.currentVersion) throw new ConflictException(`Only the current version (${script.currentVersion}) can be decided`);
    const note = body.note?.trim() || null;
    if (body.decision !== 'approved' && !note) throw new BadRequestException('A note is required when rejecting or requesting changes');

    const v = await this.dataSource.transaction(async (tx) => {
      // Lock the script and version rows, then re-evaluate every gate inside the transaction, so a concurrent
      // edit, check re-run or override cannot slip between the gate check and the status change (T4).
      const [s] = await tx.query<Array<{ current_version: number }>>(`SELECT current_version FROM video_script WHERE id = $1 FOR UPDATE`, [scriptId]);
      if (s.current_version !== body.version) throw new ConflictException(`Only the current version (${s.current_version}) can be decided`);
      const locked = await tx.findOneOrFail(ScriptVersionEntity, { where: { scriptId, version: body.version }, lock: { mode: 'pessimistic_write' } });
      if (body.decision === 'approved') {
        const [claims, codeChecks] = await Promise.all([
          tx.find(ScriptClaimEntity, { where: { scriptVersionId: locked.id } }),
          tx.find(CodeVerificationEntity, { where: { scriptVersionId: locked.id } }),
        ]);
        const blockers = approvalBlockers({
          isCurrent: true,
          estDurationSec: locked.estDurationSec,
          scenes: locked.body.scenes,
          checks: { factCheck: locked.factCheckState, quality: locked.qualityState, code: locked.codeState },
          claims,
          codeChecks,
        });
        if (blockers.length) throw new ConflictException(blockers);
      }
      await tx.insert(ScriptReviewEntity, {
        scriptVersionId: locked.id,
        kind: 'human',
        scores: null,
        issues: [],
        decision: body.decision,
        note,
        reviewerId: actor.userId,
        approvedHash: body.decision === 'approved' ? locked.contentHash : null,
      });
      const status = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : 'in_review';
      // Invariant: approved_version is set only while status = 'approved'.
      await tx.query(
        `UPDATE video_script SET status = $3, approved_version = CASE WHEN $3 = 'approved' THEN $2::int ELSE NULL END, updated_at = now() WHERE id = $1`,
        [scriptId, body.version, status],
      );
      return locked;
    });
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId: actor.workspaceId, action: 'script.decision', subjectType: 'video_script', subjectId: scriptId, outcome: 'success', correlationId: actor.correlationId, details: { version: body.version, decision: body.decision, hash: v.contentHash, note } });
    return toScriptDto(await this.script(actor.workspaceId, scriptId));
  }

  // ------------------------------------------------------------------ helpers

  private async script(workspaceId: string, id: string): Promise<VideoScriptEntity> {
    const s = await this.dataSource.manager.findOneBy(VideoScriptEntity, { id, workspaceId });
    if (!s) throw new NotFoundException('Script not found');
    return s;
  }

  private async assertVersionInWorkspace(versionId: string, workspaceId: string): Promise<void> {
    const rows = await this.dataSource.query<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM script_version v JOIN video_script s ON s.id = v.script_id WHERE v.id = $1 AND s.workspace_id = $2`,
      [versionId, workspaceId],
    );
    if (!rows.length) throw new NotFoundException('Not found');
  }

  private async versionDto(script: VideoScriptEntity, v: ScriptVersionEntity): Promise<ScriptVersionDto> {
    const m = this.dataSource.manager;
    const [claims, codeChecks, reviews] = await Promise.all([
      m.find(ScriptClaimEntity, { where: { scriptVersionId: v.id }, order: { sceneIndex: 'ASC', createdAt: 'ASC' } }),
      m.find(CodeVerificationEntity, { where: { scriptVersionId: In([v.id]) }, order: { sceneIndex: 'ASC' } }),
      m.find(ScriptReviewEntity, { where: { scriptVersionId: v.id }, order: { createdAt: 'ASC' } }),
    ]);
    const checks = { factCheck: v.factCheckState, quality: v.qualityState, code: v.codeState };
    return {
      id: v.id,
      scriptId: v.scriptId,
      version: v.version,
      authorType: v.authorType,
      hash: v.contentHash,
      title: v.title,
      scenes: v.body.scenes,
      wordCount: v.wordCount,
      estDurationSec: v.estDurationSec,
      claims: claims.map(toClaimDto),
      codeChecks: codeChecks.map(toCodeDto),
      reviews: reviews.map(toReviewDto),
      checks,
      approvalBlockers: approvalBlockers({
        isCurrent: v.version === script.currentVersion,
        estDurationSec: v.estDurationSec,
        scenes: v.body.scenes,
        checks,
        claims,
        codeChecks,
      }),
      llm: v.llmModel ? { model: v.llmModel, promptRef: v.promptRef ?? '', mock: Boolean(v.llmMock) } : null,
      createdAt: v.createdAt.toISOString(),
    };
  }
}
