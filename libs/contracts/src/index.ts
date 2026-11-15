/**
 * Shared HTTP contract for the Viral Shorts Factory API.
 * Both the NestJS API and the Angular dashboard import these types.
 * All routes are prefixed with `/api`.
 */

// ---------- Health ----------
export type DependencyName = 'database' | 'redis' | 'storage';
export type DependencyStatus = 'up' | 'down';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs?: number;
  error?: string;
}

/** GET /api/health/live */
export interface LivenessResponse {
  status: 'ok';
  timestamp: string;
}

/** GET /api/health/ready — HTTP 200 when all up, 503 otherwise. */
export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  checks: Record<DependencyName, DependencyCheck>;
  version: string;
  timestamp: string;
}

// ---------- Auth ----------
export type UserRole = 'owner' | 'reviewer';

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

/** POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Returned by POST /api/auth/login and POST /api/auth/refresh.
 * The refresh token is set as an HttpOnly cookie (`vsf_refresh`, path `/api/auth`), never in the body.
 * POST /api/auth/refresh and /api/auth/logout require the header `X-Requested-With: vsf-web` (CSRF guard).
 */
export interface AuthTokenResponse {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: UserDto;
}

export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'vsf-web';

// ---------- Users (owner only) ----------
/** POST /api/users */
export interface CreateUserRequest {
  email: string;
  password: string;
  role: UserRole;
}

// ---------- Channels ----------
export type Platform = 'youtube';

export interface ChannelDto {
  id: string;
  platform: Platform;
  handle: string;
  title: string;
  defaultPrivacy: 'private' | 'unlisted';
  createdAt: string;
}

/** POST /api/channels (owner) */
export interface CreateChannelRequest {
  platform: Platform;
  handle: string;
  title: string;
}

// ---------- Integrations ----------
export interface ConnectedAccountDto {
  id: string;
  provider: 'youtube';
  externalAccountId: string;
  displayName: string;
  scopes: string[];
  status: 'connected' | 'expired' | 'revoked';
  connectedAt: string;
}

// ---------- Jobs ----------
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobDto {
  id: string;
  type: string;
  queue: string;
  idempotencyKey: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  progress: number;
  error: string | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/jobs/maintenance/ping (owner) — idempotent per key. */
export interface EnqueuePingRequest {
  idempotencyKey: string;
}

// ---------- Audit ----------
export interface AuditEventDto {
  id: string;
  occurredAt: string;
  actorType: 'user' | 'system' | 'worker';
  actorId: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  outcome: 'success' | 'failure';
  correlationId: string | null;
}

// ---------- Common ----------
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Error body for every non-2xx response. */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
  correlationId?: string;
}

// ======================= Phase 02: trend research =======================

export type ResearchSourceKey = 'hackernews' | 'stackexchange' | 'github' | 'rss' | 'youtube';

export interface ResearchSourceDto {
  key: ResearchSourceKey;
  name: string;
  enabled: boolean;
  /** False when a required credential (e.g. YouTube API key) is not configured; the source is then skipped. */
  configured: boolean;
  termsUrl: string;
  termsNotes: string;
}

export interface NicheDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Lower-case keywords/tags that define relevance (e.g. "typescript", "node.js", "git"). */
  keywords: string[];
  excludeKeywords: string[];
  active: boolean;
  createdAt: string;
}

/** POST /api/niches (owner); PATCH /api/niches/:id (owner) accepts any subset. */
export interface UpsertNicheRequest {
  name: string;
  description?: string;
  keywords: string[];
  excludeKeywords?: string[];
  active?: boolean;
}

export type CollectionStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface SourceRunResult {
  source: ResearchSourceKey;
  status: 'ok' | 'failed' | 'skipped';
  signals: number;
  durationMs: number;
  /** Short, non-sensitive reason when failed/skipped. */
  message?: string;
}

export interface TrendCollectionDto {
  id: string;
  nicheId: string;
  trigger: 'manual' | 'scheduled';
  status: CollectionStatus;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  finishedAt: string | null;
  sourceResults: SourceRunResult[];
  topicCount: number;
  jobId: string | null;
  createdAt: string;
}

/** POST /api/research/runs (owner) → 202 with the collection (idempotent per idempotencyKey). */
export interface StartResearchRunRequest {
  nicheId: string;
  idempotencyKey: string;
}

export type ScoreComponent = 'freshness' | 'growth' | 'relevance' | 'competition' | 'demand' | 'repeatability';

export interface ScoreComponentDetail {
  component: ScoreComponent;
  weight: number;
  /** Normalized 0..1 value, or null when the data was unavailable (component excluded, weights renormalized). */
  value: number | null;
  /** Plain-language explanation of the inputs, e.g. "142 HN points/day (max in collection 310)". */
  explanation: string;
}

export type TopicStatus = 'new' | 'approved' | 'rejected';

export interface TrendTopicDto {
  id: string;
  collectionId: string;
  title: string;
  /** Final score 0..1 (weighted over available components). */
  score: number;
  /** Sum of weights of available components (0..1): how much of the model had data. */
  confidence: number;
  breakdown: ScoreComponentDetail[];
  missingComponents: ScoreComponent[];
  /** True when the newest supporting signal is older than 14 days. */
  stale: boolean;
  sources: ResearchSourceKey[];
  signalCount: number;
  status: TopicStatus;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface TrendSignalDto {
  id: string;
  source: ResearchSourceKey;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  /** Raw metrics exactly as returned by the source (e.g. points, comments, stars). */
  metrics: Record<string, number>;
}

export interface TrendMetricDto {
  name: string;
  value: number;
  unit: string;
  source: ResearchSourceKey;
  observedAt: string;
  retrievedAt: string;
}

/** GET /api/research/topics/:id — evidence for one topic. */
export interface TrendTopicDetailDto extends TrendTopicDto {
  signals: TrendSignalDto[];
  metrics: TrendMetricDto[];
}

/**
 * GET /api/research/collections/:id/topics?status=&minScore=&q=&sort=score|freshness|confidence&limit=&offset=
 * returns Page<TrendTopicDto>. GET /api/research/topics/compare?ids=a,b,c returns TrendTopicDetailDto[] (2–4 ids).
 */

/** POST /api/research/topics/:id/decision (owner or reviewer). */
export interface TopicDecisionRequest {
  decision: 'approved' | 'rejected';
  note?: string;
}

/** GET /api/research/collections/:id/report */
export interface WeeklyTrendReportDto {
  collectionId: string;
  generatedAt: string;
  /** Markdown report: top topics with evidence links, source coverage, limitations. Render as text, never as HTML. */
  markdown: string;
  limitations: string[];
}

/** GET /api/budget/summary (owner) — month-to-date spend vs. budget. */
export interface BudgetSummaryDto {
  period: string; // YYYY-MM
  currency: 'USD';
  limitMinor: number;
  spentMinor: number;
  warnPct: number;
  status: 'ok' | 'warning' | 'exceeded';
}
