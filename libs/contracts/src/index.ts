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
