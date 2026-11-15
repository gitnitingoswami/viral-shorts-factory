import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  AuthTokenResponse,
  ContentIdeaDto,
  JobDto,
  LlmStatusDto,
  ScriptDetailDto,
  ScriptVersionDto,
  NicheDto,
  ResearchSourceDto,
  TrendCollectionDto,
  TrendTopicDetailDto,
  TrendTopicDto,
  UserDto,
  UserRole,
} from '@vsf/contracts';
import { AUTH_URLS, AuthService } from '../core/auth/auth.service';

export function makeUser(role: UserRole = 'owner'): UserDto {
  return { id: `u-${role}`, email: `${role}@example.test`, role, createdAt: '2026-01-01T00:00:00.000Z' };
}

export function makeTokenResponse(token = 'access-1', role: UserRole = 'owner'): AuthTokenResponse {
  return { accessToken: token, expiresIn: 900, user: makeUser(role) };
}

/** Signs in through the real AuthService using the testing backend. */
export function signInAs(role: UserRole): void {
  TestBed.inject(AuthService).login(`${role}@example.test`, 'pw').subscribe();
  TestBed.inject(HttpTestingController).expectOne(AUTH_URLS.login).flush(makeTokenResponse('t', role));
}

export function makeNiche(overrides: Partial<NicheDto> = {}): NicheDto {
  return {
    id: 'n1',
    name: 'TypeScript tips',
    slug: 'typescript-tips',
    description: 'Short TS tips',
    keywords: ['typescript', 'node.js'],
    excludeKeywords: [],
    active: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSource(overrides: Partial<ResearchSourceDto> = {}): ResearchSourceDto {
  return {
    key: 'hackernews',
    name: 'Hacker News',
    enabled: true,
    configured: true,
    termsUrl: 'https://example.test/terms',
    termsNotes: 'Public API',
    ...overrides,
  };
}

export function makeCollection(overrides: Partial<TrendCollectionDto> = {}): TrendCollectionDto {
  return {
    id: 'c1',
    nicheId: 'n1',
    trigger: 'manual',
    status: 'completed',
    windowStart: '2026-11-08T00:00:00.000Z',
    windowEnd: '2026-11-15T00:00:00.000Z',
    startedAt: '2026-11-15T00:00:01.000Z',
    finishedAt: '2026-11-15T00:01:00.000Z',
    sourceResults: [
      { source: 'hackernews', status: 'ok', signals: 42, durationMs: 1200 },
      { source: 'youtube', status: 'skipped', signals: 0, durationMs: 0, message: 'API key not configured' },
    ],
    topicCount: 12,
    jobId: 'j1',
    createdAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  };
}

export function makeTopic(overrides: Partial<TrendTopicDto> = {}): TrendTopicDto {
  return {
    id: 't1',
    collectionId: 'c1',
    title: 'Node.js 24 permission model',
    score: 0.72,
    confidence: 0.8,
    breakdown: [
      { component: 'freshness', weight: 0.2, value: 0.9, explanation: 'Newest signal 1 day old' },
      { component: 'growth', weight: 0.2, value: 0.6, explanation: '142 HN points/day (max 310)' },
      { component: 'competition', weight: 0.2, value: null, explanation: 'YouTube not configured' },
    ],
    missingComponents: ['competition'],
    stale: false,
    sources: ['hackernews', 'github'],
    signalCount: 5,
    status: 'new',
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  };
}

export function makeTopicDetail(overrides: Partial<TrendTopicDetailDto> = {}): TrendTopicDetailDto {
  return {
    ...makeTopic(),
    signals: [
      {
        id: 's1',
        source: 'hackernews',
        title: 'Show HN: permission model',
        url: 'https://news.ycombinator.com/item?id=1',
        publishedAt: '2026-11-14T00:00:00.000Z',
        retrievedAt: '2026-11-15T00:00:00.000Z',
        metrics: { points: 142, comments: 37 },
      },
    ],
    metrics: [
      {
        name: 'points',
        value: 142,
        unit: 'points',
        source: 'hackernews',
        observedAt: '2026-11-14T12:00:00.000Z',
        retrievedAt: '2026-11-15T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function makeJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: 'j1',
    type: 'content.ideas',
    queue: 'content',
    idempotencyKey: 'k1',
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    progress: 0,
    error: null,
    correlationId: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  };
}

export function makeLlmStatus(provider: LlmStatusDto['provider'] = 'claude'): LlmStatusDto {
  return { provider, model: provider === 'mock' ? 'mock-1' : 'claude-sonnet', configured: provider !== 'mock' };
}

export function makeIdea(overrides: Partial<ContentIdeaDto> = {}): ContentIdeaDto {
  return {
    id: 'i1',
    topicId: 't1',
    topicTitle: 'Node.js 24 permission model',
    title: 'Lock down fs access in 30 seconds',
    audience: 'Node.js backend devs',
    angle: 'Security by default',
    hook: 'Your script can read ~/.ssh. Here is the fix.',
    valueProposition: 'One flag blocks surprise file access',
    format: 'quick-tip',
    targetDurationSec: 40,
    sourceRefs: [{ signalId: 's1', url: 'https://nodejs.org/api/permissions.html', title: 'Node docs' }],
    similarityScore: 0.2,
    duplicateOfId: null,
    status: 'proposed',
    llm: { model: 'claude-sonnet', promptRef: 'ideas@1', mock: false },
    createdAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  };
}

export function makeScriptDetail(overrides: Partial<ScriptDetailDto> = {}): ScriptDetailDto {
  return {
    id: 'sc1',
    ideaId: 'i1',
    title: 'Lock down fs access',
    status: 'in_review',
    currentVersion: 2,
    approvedVersion: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T01:00:00.000Z',
    versions: [
      { version: 1, authorType: 'ai', createdAt: '2026-11-15T00:00:00.000Z' },
      { version: 2, authorType: 'human', createdAt: '2026-11-15T01:00:00.000Z' },
    ],
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<ScriptVersionDto> = {}): ScriptVersionDto {
  return {
    id: 'v2',
    scriptId: 'sc1',
    version: 2,
    authorType: 'human',
    hash: 'abcdef0123456789abcdef',
    title: 'Lock down fs access',
    scenes: [
      {
        index: 0,
        durationSec: 8,
        narration: 'Your script can read your SSH keys.',
        onScreenText: 'Danger!',
        visualConcept: 'Terminal with ~/.ssh listing',
        code: null,
        transition: 'cut',
        assetBrief: 'Dark terminal',
      },
      {
        index: 1,
        durationSec: 20,
        narration: 'Run node with the permission flag.',
        onScreenText: '--permission',
        visualConcept: 'Code close-up',
        code: { language: 'shell', source: 'node --permission app.js\necho done', highlightLines: [1] },
        transition: 'fade',
        assetBrief: 'Code card',
      },
    ],
    wordCount: 80,
    estDurationSec: 32,
    claims: [
      {
        id: 'cl1',
        sceneIndex: 1,
        text: 'Node 24 ships a stable permission model.',
        verdict: 'unsupported',
        evidence: null,
        sourceRef: { signalId: 's1', url: 'https://nodejs.org/api/permissions.html', title: 'Node docs' },
        overrideReason: null,
      },
    ],
    codeChecks: [
      {
        id: 'cc1',
        sceneIndex: 1,
        language: 'shell',
        status: 'not_executable',
        stdout: '',
        stderr: '',
        durationMs: null,
        overrideReason: null,
      },
    ],
    reviews: [
      {
        id: 'r1',
        kind: 'ai_quality',
        scores: { originality: 4, repetition: 5, clarity: 4, pacing: 3, accessibility: 4, platform: 5, policyRisk: 5 },
        issues: ['Pacing dips in scene 2'],
        decision: null,
        note: null,
        reviewerId: null,
        createdAt: '2026-11-15T01:00:00.000Z',
      },
    ],
    checks: { factCheck: 'done', quality: 'done', code: 'done' },
    approvalBlockers: [],
    llm: null,
    createdAt: '2026-11-15T01:00:00.000Z',
    ...overrides,
  };
}
