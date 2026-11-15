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

// ======================= Phase 03: content strategy and scripts =======================

/** Which model produced an AI artifact. `mock: true` means no real LLM was called (no API key configured). */
export interface LlmProvenance {
  model: string;
  promptRef: string; // e.g. "ideas@1"
  mock: boolean;
}

/** GET /api/content/llm-status */
export interface LlmStatusDto {
  provider: 'claude' | 'mock';
  model: string;
  configured: boolean;
}

export type IdeaFormat = 'quick-tip' | 'how-to' | 'myth-vs-fact' | 'comparison' | 'quick-fix' | 'explainer';
export type IdeaStatus = 'proposed' | 'selected' | 'discarded';

export interface SourceRef {
  signalId: string | null;
  url: string;
  title: string;
}

export interface ContentIdeaDto {
  id: string;
  topicId: string;
  topicTitle: string;
  title: string;
  audience: string;
  angle: string;
  hook: string;
  valueProposition: string;
  format: IdeaFormat;
  targetDurationSec: number;
  sourceRefs: SourceRef[];
  /** 0..1 similarity to the closest earlier idea; flagged when >= 0.6 (flag only, never auto-rejected). */
  similarityScore: number;
  duplicateOfId: string | null;
  status: IdeaStatus;
  llm: LlmProvenance;
  createdAt: string;
}

/** POST /api/research/topics/:id/ideas (owner) — topic must be approved → 202 JobDto. Idempotent per key. */
export interface GenerateIdeasRequest {
  idempotencyKey: string;
}

/** POST /api/content/ideas/:id/select (owner) → 202 { scriptId, job }. */
export interface SelectIdeaResponse {
  scriptId: string;
  job: JobDto;
}

export type ScriptStatus = 'drafting' | 'in_review' | 'approved' | 'rejected';

export interface ScriptDto {
  id: string;
  ideaId: string;
  title: string;
  status: ScriptStatus;
  currentVersion: number;
  approvedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptVersionSummary {
  version: number;
  authorType: 'ai' | 'human';
  createdAt: string;
}

/** GET /api/content/scripts/:id */
export interface ScriptDetailDto extends ScriptDto {
  versions: ScriptVersionSummary[];
}

export type CodeLanguage = 'javascript' | 'typescript' | 'shell' | 'sql' | 'other';

export interface SceneCode {
  language: CodeLanguage;
  source: string;
  highlightLines: number[];
}

export interface StoryboardSceneDto {
  index: number;
  durationSec: number;
  narration: string;
  onScreenText: string;
  visualConcept: string;
  code: SceneCode | null;
  transition: 'cut' | 'fade' | 'slide' | 'zoom';
  assetBrief: string;
}

export type ClaimVerdict = 'pending' | 'supported' | 'unsupported' | 'contradicted' | 'overridden';

export interface ScriptClaimDto {
  id: string;
  sceneIndex: number;
  text: string;
  verdict: ClaimVerdict;
  /** Quoted span from a supplied source supporting/contradicting the claim. */
  evidence: string | null;
  sourceRef: SourceRef | null;
  overrideReason: string | null;
}

/**
 * passed/failed: executed in the sandbox. not_executable: language is not run (e.g. shell, sql) — shown, not blocking.
 * unavailable: sandbox could not run — blocks approval unless overridden.
 */
export type CodeCheckStatus = 'pending' | 'passed' | 'failed' | 'not_executable' | 'unavailable' | 'overridden';

export interface CodeVerificationDto {
  id: string;
  sceneIndex: number;
  language: CodeLanguage;
  status: CodeCheckStatus;
  stdout: string;
  stderr: string;
  durationMs: number | null;
  overrideReason: string | null;
}

export type QualityDimension = 'originality' | 'repetition' | 'clarity' | 'pacing' | 'accessibility' | 'platform' | 'policyRisk';

export interface ScriptReviewDto {
  id: string;
  kind: 'ai_quality' | 'human';
  /** 1..5 per dimension (policyRisk: 5 = lowest risk). Null for human reviews. */
  scores: Record<QualityDimension, number> | null;
  issues: string[];
  decision: 'approved' | 'rejected' | 'changes_requested' | null;
  note: string | null;
  reviewerId: string | null;
  createdAt: string;
}

export type CheckState = 'pending' | 'running' | 'done' | 'failed';

/** GET /api/content/scripts/:id/versions/:version */
export interface ScriptVersionDto {
  id: string;
  scriptId: string;
  version: number;
  authorType: 'ai' | 'human';
  /** SHA-256 of the canonical version content; approvals are bound to it. */
  hash: string;
  title: string;
  scenes: StoryboardSceneDto[];
  wordCount: number;
  estDurationSec: number;
  claims: ScriptClaimDto[];
  codeChecks: CodeVerificationDto[];
  reviews: ScriptReviewDto[];
  checks: { factCheck: CheckState; quality: CheckState; code: CheckState };
  /** Reasons approval is currently blocked (empty = approvable). */
  approvalBlockers: string[];
  llm: LlmProvenance | null;
  createdAt: string;
}

/** POST /api/content/scripts/:id/versions (owner or reviewer): human edit → new version (409 if baseVersion is stale). */
export interface CreateScriptVersionRequest {
  baseVersion: number;
  title: string;
  scenes: Omit<StoryboardSceneDto, 'index'>[];
}

/** POST /api/content/claims/:id/override and /api/content/code-checks/:id/override (owner). */
export interface OverrideRequest {
  reason: string;
}

/**
 * POST /api/content/scripts/:id/decision (owner or reviewer). `approved` fails with 409 + ApiError listing blockers
 * when gates are not met. The decision is bound to `version` (must be the current version).
 */
export interface ScriptDecisionRequest {
  version: number;
  decision: 'approved' | 'rejected' | 'changes_requested';
  note?: string;
}

// ======================= Phase 04: video production =======================

export type MediaKind = 'image' | 'audio' | 'font' | 'music' | 'code_frame' | 'video' | 'captions';

/** Rights and provenance are mandatory for every stored asset (license NOT NULL). */
export interface MediaAssetDto {
  id: string;
  kind: MediaKind;
  generated: boolean;
  mime: string;
  bytes: number;
  sha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Where it came from, e.g. "generated:frame-renderer@1", "tts:espeak-ng", "bundled:fonts". */
  source: string;
  creatorOrProvider: string;
  license: string;
  licenseUrl: string | null;
  usageRights: string;
  generationParams: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  createdAt: string;
}

export type TtsProviderName = 'espeak' | 'mock';

export interface VoiceProfileDto {
  id: string;
  name: string;
  provider: TtsProviderName;
  voiceId: string;
  language: string;
  rateWpm: number;
  /** Draft/placeholder voices are flagged by the quality report and are not publishable. */
  quality: 'draft' | 'mock' | 'production';
  isDefault: boolean;
  /** Whether the provider can run on this worker host right now (e.g. eSpeak NG installed). */
  available: boolean;
}

/** Output settings. Aspect ratio is always 9:16. */
export interface RenderSettings {
  width: number;
  height: number;
  fps: 24 | 25 | 30 | 60;
  codec: 'h264';
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  minDurationSec: number;
  maxDurationSec: number;
  burnCaptions: boolean;
}

export type ProductionStatus = 'queued' | 'rendering' | 'ready' | 'quality_failed' | 'failed' | 'cancelled';
export type RenderStage = 'queued' | 'narration' | 'frames' | 'compose' | 'quality' | 'done';

export interface VideoProductionDto {
  id: string;
  scriptId: string;
  scriptTitle: string;
  scriptVersion: number;
  /** Hash of the approved script version this production renders. */
  scriptHash: string;
  voiceProfileId: string;
  voiceName: string;
  settings: RenderSettings;
  status: ProductionStatus;
  stage: RenderStage;
  progress: number;
  error: string | null;
  cancelRequested: boolean;
  renderAttempt: number;
  jobId: string | null;
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  /** Rendered lines after wrapping (validated against the caption safe area). */
  lines: string[];
}

export interface VideoSceneDto {
  index: number;
  startMs: number;
  endMs: number;
  narration: string;
  onScreenText: string;
  transition: 'cut' | 'fade' | 'slide' | 'zoom';
  audioAssetId: string | null;
  frameAssetIds: string[];
  captions: CaptionCue[];
}

export type QualityCheckStatus = 'pass' | 'warn' | 'fail';

export interface QualityCheckDto {
  id: string;
  label: string;
  status: QualityCheckStatus;
  detail: string;
  measured: string | null;
  expected: string | null;
}

export interface QualityReportDto {
  id: string;
  /** No failing check: the render is technically sound. */
  passed: boolean;
  /**
   * passed AND narrated by a production voice. The only gate publishing may use: draft (eSpeak) and mock voices
   * are never publishable even when every technical check passes.
   */
  publishable: boolean;
  checks: QualityCheckDto[];
  failures: string[];
  createdAt: string;
}

export interface VideoVersionDto {
  id: string;
  version: number;
  videoAssetId: string;
  captionsAssetId: string | null;
  thumbnailAssetId: string | null;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  codec: string;
  bitrateKbps: number;
  sha256: string;
  bytes: number;
  quality: QualityReportDto | null;
  createdAt: string;
}

/** GET /api/video/productions/:id */
export interface VideoProductionDetailDto extends VideoProductionDto {
  scenes: VideoSceneDto[];
  versions: VideoVersionDto[];
  assets: Array<MediaAssetDto & { role: string; sceneIndex: number | null }>;
}

/** POST /api/video/productions (owner): script must be approved. Idempotent per (version, settings, voice). */
export interface CreateProductionRequest {
  scriptId: string;
  voiceProfileId?: string;
  settings?: Partial<RenderSettings>;
}

export interface CreateProductionResponse {
  production: VideoProductionDto;
  job: JobDto | null;
  /** false when an identical production already existed (no new record, no new job). */
  created: boolean;
}

/** GET /api/video/assets/:id/url → short-lived signed URL for <video>/<img> (no Authorization header needed). */
export interface SignedMediaUrlDto {
  url: string;
  expiresAt: string;
}

/** GET /api/video/status */
export interface RenderCapabilityDto {
  ffmpeg: { available: boolean; version: string | null };
  espeak: { available: boolean; version: string | null };
  defaults: RenderSettings;
  concurrency: number;
}
