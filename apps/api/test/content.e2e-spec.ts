import { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { ScriptVersionDto, StoryboardSceneDto } from '@vsf/contracts';
import { createTestApp, createUser, createWorker, resetTestDatabase, waitFor } from './helpers';

const OWNER = { email: 'owner@content.test', password: 'owner-password-123' };
const REVIEWER = { email: 'reviewer@content.test', password: 'reviewer-password-123' };
const WS = '00000000-0000-4000-8000-000000000001';

describe('Content strategy and scripts (e2e, mock LLM + real sandbox)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let http: App;
  let ds: DataSource;
  let owner: string;
  let reviewer: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Inserts an approved-able topic with one evidence signal whose title equals the topic title. */
  async function seedTopic(title: string, status: 'new' | 'approved' = 'approved'): Promise<string> {
    const [niche] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO niche (workspace_id, name, slug, keywords) VALUES ($1, $2, $3, '{typescript}')
       ON CONFLICT (workspace_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [WS, 'Coding tips', 'coding-tips'],
    );
    const [col] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO trend_collection (workspace_id, niche_id, trigger, status, run_key, window_start, window_end)
       VALUES ($1, $2, 'manual', 'completed', $3, now() - interval '7 days', now()) RETURNING id`,
      [WS, niche.id, `seed:${title}:${Math.random()}`],
    );
    const [sig] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO raw_signal (collection_id, source_key, external_id, url, title, retrieved_at, metrics)
       VALUES ($1, 'hackernews', $2, 'https://news.example.com/ts', $3, now(), '{"points": 300}') RETURNING id`,
      [col.id, `ext-${Math.random()}`, title],
    );
    const [topic] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO trend_topic (workspace_id, collection_id, niche_id, title, slug, score, confidence, breakdown, sources, signal_count, status)
       VALUES ($1, $2, $3, $4, $5, 0.8, 0.85, '[]', '{hackernews}', 1, $6) RETURNING id`,
      [WS, col.id, niche.id, title, `slug-${Math.random()}`, status],
    );
    await ds.query(`INSERT INTO trend_topic_signal (topic_id, signal_id) VALUES ($1, $2)`, [topic.id, sig.id]);
    return topic.id;
  }

  async function waitJob(jobId: string) {
    return waitFor(async () => {
      const r = await request(http).get(`/api/jobs/${jobId}`).set(auth(owner)).expect(200);
      return ['completed', 'failed'].includes(r.body.status) ? (r.body as { status: string; error: string | null }) : undefined;
    }, 30_000);
  }

  async function waitChecks(scriptId: string, version: number): Promise<ScriptVersionDto> {
    return waitFor(async () => {
      const r = await request(http).get(`/api/content/scripts/${scriptId}/versions/${version}`).set(auth(owner)).expect(200);
      const c = r.body.checks;
      return [c.factCheck, c.quality, c.code].every((s: string) => s === 'done' || s === 'failed') ? (r.body as ScriptVersionDto) : undefined;
    }, 60_000);
  }

  async function ideasFor(topicId: string, key: string) {
    const job = await request(http).post(`/api/research/topics/${topicId}/ideas`).set(auth(owner)).send({ idempotencyKey: key }).expect(202);
    return waitJob(job.body.id);
  }

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createTestApp();
    worker = await createWorker();
    http = app.getHttpServer() as App;
    ds = app.get(DataSource);
    await createUser(app, OWNER.email, OWNER.password, 'owner');
    await createUser(app, REVIEWER.email, REVIEWER.password, 'reviewer');
    owner = (await request(http).post('/api/auth/login').send(OWNER)).body.accessToken;
    reviewer = (await request(http).post('/api/auth/login').send(REVIEWER)).body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  let topicId: string;
  let scriptId: string;
  let v1: ScriptVersionDto;

  it('reports the mock provider when no API key is configured', async () => {
    const r = await request(http).get('/api/content/llm-status').set(auth(reviewer)).expect(200);
    expect(r.body).toEqual({ provider: 'mock', model: 'mock', configured: false });
  });

  it('generates five ideas only for approved topics, with provenance and sources from the evidence', async () => {
    const unapproved = await seedTopic('TypeScript 6.1 released', 'new');
    await request(http).post(`/api/research/topics/${unapproved}/ideas`).set(auth(owner)).send({ idempotencyKey: 'ideas-key-0000' }).expect(409);
    topicId = await seedTopic('TypeScript 6.1 released');
    await request(http).post(`/api/research/topics/${topicId}/ideas`).set(auth(reviewer)).send({ idempotencyKey: 'ideas-key-0001' }).expect(403);

    expect((await ideasFor(topicId, 'ideas-key-0001')).status).toBe('completed');
    const r = await request(http).get(`/api/content/ideas?topicId=${topicId}`).set(auth(owner)).expect(200);
    expect(r.body.total).toBe(5);
    const idea = r.body.items[0];
    expect(idea.llm).toEqual({ model: 'mock', promptRef: 'ideas@1', mock: true });
    expect(idea.topicTitle).toBe('TypeScript 6.1 released');
    for (const i of r.body.items) for (const s of i.sourceRefs) expect(s.url).toBe('https://news.example.com/ts');
    expect(new Set(r.body.items.map((i: { format: string }) => i.format)).size).toBe(5);
  });

  it('flags duplicate ideas against earlier ones (flag only, not rejected)', async () => {
    expect((await ideasFor(topicId, 'ideas-key-0002')).status).toBe('completed');
    const r = await request(http).get(`/api/content/ideas?topicId=${topicId}&limit=10`).set(auth(owner)).expect(200);
    const second = r.body.items.slice(0, 5);
    expect(second.every((i: { similarityScore: number; duplicateOfId: string | null }) => i.similarityScore >= 0.6 && i.duplicateOfId)).toBe(true);
    expect(r.body.total).toBe(10);
  });

  it('selecting an idea creates one script (idempotent) and runs generation and all checks', async () => {
    const ideas = await request(http).get(`/api/content/ideas?topicId=${topicId}&status=proposed&limit=1`).set(auth(owner)).expect(200);
    const ideaId = ideas.body.items[0].id;
    const a = await request(http).post(`/api/content/ideas/${ideaId}/select`).set(auth(owner)).expect(202);
    const b = await request(http).post(`/api/content/ideas/${ideaId}/select`).set(auth(owner)).expect(202);
    expect(b.body.scriptId).toBe(a.body.scriptId);
    scriptId = a.body.scriptId;
    await request(http).post(`/api/content/ideas/${ideaId}/discard`).set(auth(owner)).expect(409);
    expect((await waitJob(a.body.job.id)).status).toBe('completed');

    v1 = await waitChecks(scriptId, 1);
    expect(v1).toMatchObject({ version: 1, authorType: 'ai', checks: { factCheck: 'done', quality: 'done', code: 'done' }, llm: { promptRef: 'script@1', mock: true } });
    expect(v1.estDurationSec).toBeGreaterThanOrEqual(20);
    expect(v1.claims.find((c) => c.verdict === 'supported')).toMatchObject({ evidence: 'TypeScript 6.1 released', sourceRef: { url: 'https://news.example.com/ts' } });
    expect(v1.codeChecks).toEqual([expect.objectContaining({ language: 'typescript', status: 'passed', stdout: expect.stringContaining('[ 1, 2, 3 ]') })]);
    expect(v1.reviews.find((r) => r.kind === 'ai_quality')?.scores).toMatchObject({ clarity: 4, policyRisk: 5 });
    expect(v1.approvalBlockers).toEqual([]);
  }, 120_000);

  it('keeps versions immutable at the database level', async () => {
    await expect(ds.query(`UPDATE script_version SET title = 'tampered' WHERE id = $1`, [v1.id])).rejects.toThrow(/immutable/);
  });

  it('human edits create new versions with optimistic concurrency and re-run checks', async () => {
    const scenes = v1.scenes.map(({ index: _i, ...s }) => s);
    scenes[1] = { ...scenes[1], narration: 'This makes every build 10x faster, guaranteed.' };
    const v2 = await request(http).post(`/api/content/scripts/${scriptId}/versions`).set(auth(reviewer)).send({ baseVersion: 1, title: v1.title, scenes }).expect(201);
    expect(v2.body).toMatchObject({ version: 2, authorType: 'human', llm: null });
    expect(v2.body.hash).not.toBe(v1.hash);
    await request(http).post(`/api/content/scripts/${scriptId}/versions`).set(auth(owner)).send({ baseVersion: 1, title: v1.title, scenes }).expect(409);
    await request(http).post(`/api/content/scripts/${scriptId}/versions`).set(auth(owner)).send({ baseVersion: 2, title: 'x', scenes: [] }).expect(400);

    const checked = await waitChecks(scriptId, 2);
    const bad = checked.claims.find((c) => c.text.includes('10x'));
    expect(bad?.verdict).toBe('unsupported');
    expect(checked.approvalBlockers.join(' ')).toMatch(/unsupported/);
  }, 120_000);

  it('blocks approval with listed reasons until gates pass; overrides need a reason and are audited', async () => {
    const res = await request(http).post(`/api/content/scripts/${scriptId}/decision`).set(auth(reviewer)).send({ version: 2, decision: 'approved' }).expect(409);
    expect(JSON.stringify(res.body.message)).toMatch(/unsupported/);
    await request(http).post(`/api/content/scripts/${scriptId}/decision`).set(auth(reviewer)).send({ version: 1, decision: 'approved' }).expect(409);

    const v2 = (await request(http).get(`/api/content/scripts/${scriptId}/versions/2`).set(auth(owner))).body as ScriptVersionDto;
    const claim = v2.claims.find((c) => c.verdict === 'unsupported')!;
    await request(http).post(`/api/content/claims/${claim.id}/override`).set(auth(owner)).send({ reason: 'short' }).expect(400);
    await request(http).post(`/api/content/claims/${claim.id}/override`).set(auth(reviewer)).send({ reason: 'Reviewer cannot override claims' }).expect(403);
    await request(http).post(`/api/content/claims/${claim.id}/override`).set(auth(owner)).send({ reason: 'Phrased as opinion in the voice-over' }).expect(200);

    const ok = await request(http).post(`/api/content/scripts/${scriptId}/decision`).set(auth(reviewer)).send({ version: 2, decision: 'approved', note: 'Good to go' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'approved', approvedVersion: 2 });
    const [rev] = await ds.query<Array<{ approved_hash: string }>>(`SELECT approved_hash FROM script_review WHERE kind = 'human' AND decision = 'approved'`);
    expect(rev.approved_hash).toBe(v2.hash);
    const actions = (await ds.query<Array<{ action: string }>>(`SELECT action FROM audit_event`)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['script.claim_overridden', 'script.decision', 'script.version_created', 'content.idea_selected']));
  });

  it('requires a note to reject or request changes', async () => {
    await request(http).post(`/api/content/scripts/${scriptId}/decision`).set(auth(owner)).send({ version: 2, decision: 'rejected' }).expect(400);
  });

  it('sandbox: failing code, network access and infinite loops fail; overrides allowed with reason', async () => {
    const detail = await request(http).get(`/api/content/scripts/${scriptId}`).set(auth(owner)).expect(200);
    const base = (await request(http).get(`/api/content/scripts/${scriptId}/versions/${detail.body.currentVersion}`).set(auth(owner))).body as ScriptVersionDto;
    const codeScene = (source: string): Omit<StoryboardSceneDto, 'index'> => ({ durationSec: 8, narration: 'Run this code.', onScreenText: 'Code', visualConcept: 'Code frame', code: { language: 'typescript', source, highlightLines: [] }, transition: 'cut', assetBrief: 'frame' });
    const scenes = [
      { ...base.scenes[0], index: undefined },
      codeScene("throw new Error('boom');"),
      codeScene("await fetch('https://example.com'); console.log('net ok');"),
      codeScene('while (true) {}'),
      { durationSec: 5, narration: 'Done.', onScreenText: 'Done', visualConcept: 'Card', code: { language: 'shell', source: 'git status', highlightLines: [] }, transition: 'cut', assetBrief: 'card' },
    ].map(({ index: _i, ...s }) => s as Omit<StoryboardSceneDto, 'index'>);
    const v = await request(http).post(`/api/content/scripts/${scriptId}/versions`).set(auth(owner)).send({ baseVersion: detail.body.currentVersion, title: base.title, scenes }).expect(201);
    const checked = await waitChecks(scriptId, v.body.version);
    const byScene = new Map(checked.codeChecks.map((c) => [c.sceneIndex, c]));
    expect(byScene.get(1)?.status).toBe('failed');
    expect(byScene.get(1)?.stderr).toMatch(/boom/);
    expect(byScene.get(2)?.status).toBe('failed'); // no network in the sandbox
    expect(byScene.get(2)?.stdout).not.toMatch(/net ok/);
    expect(byScene.get(3)).toMatchObject({ status: 'failed', stderr: expect.stringMatching(/Timed out/) });
    expect(byScene.get(4)?.status).toBe('not_executable');
    const r = await request(http).post(`/api/content/code-checks/${byScene.get(1)!.id}/override`).set(auth(owner)).send({ reason: 'Intentional error demo for the video' }).expect(200);
    expect(r.body.status).toBe('overridden');
    await request(http).post(`/api/content/code-checks/${byScene.get(4)!.id}/override`).set(auth(owner)).send({ reason: 'Nothing to override here' }).expect(409);
  }, 120_000);

  it('fails fast (no retries) on malformed output and refusals; nothing partial is stored', async () => {
    for (const marker of ['[mock:malformed]', '[mock:refusal]']) {
      const t = await seedTopic(`Broken topic ${marker}`);
      const job = await ideasFor(t, `ideas-${marker.replace(/\W/g, '')}-0001`);
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(marker.includes('malformed') ? /malformed/ : /refusal/);
      const [{ attempt }] = await ds.query<Array<{ attempt: number }>>(`SELECT attempt FROM job WHERE input->>'topicId' = $1`, [t]);
      expect(attempt).toBe(1);
      const [{ n }] = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM content_idea WHERE topic_id = $1`, [t]);
      expect(n).toBe(0);
    }
  });

  it('pauses generation when the monthly budget is exhausted', async () => {
    await ds.query(`UPDATE budget SET limit_minor = 0`);
    try {
      const t = await seedTopic('Budget topic');
      const job = await ideasFor(t, 'ideas-budget-0001');
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/budget/);
    } finally {
      await ds.query(`UPDATE budget SET limit_minor = 10000`);
    }
  });
});
