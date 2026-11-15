import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  AuthTokenResponse,
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
