/** The single MVP workspace, created by the initial migration. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export const REFRESH_COOKIE_NAME = 'vsf_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const CORRELATION_HEADER = 'x-correlation-id';

export const QUEUE_MAINTENANCE = 'maintenance';
export const JOB_TYPE_PING = 'maintenance.ping';

/** Login lockout policy. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Each successive lockout doubles, up to this cap (backoff). */
export const MAX_LOCKOUT_MINUTES = 24 * 60;

/** Background reconciliation of jobs whose queue message was lost or whose worker died. */
export const STALE_QUEUED_MS = 30_000;
export const STALE_RUNNING_MS = 15 * 60_000;
