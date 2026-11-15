/** The single MVP workspace, created by the initial migration. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export const REFRESH_COOKIE_NAME = 'vsf_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const CORRELATION_HEADER = 'x-correlation-id';

export const QUEUE_MAINTENANCE = 'maintenance';
export const QUEUE_RESEARCH = 'research';
export const QUEUE_CONTENT = 'content';
export const QUEUE_RENDER = 'render';
export const JOB_TYPE_VIDEO_RENDER = 'video.render';
export const JOB_TYPE_CONTENT_IDEAS = 'content.ideas';
export const JOB_TYPE_CONTENT_SCRIPT = 'content.script';
export const JOB_TYPE_CONTENT_CHECKS = 'content.checks';
export const JOB_TYPE_RESEARCH_COLLECT = 'research.collect';
export const JOB_NAME_RESEARCH_SCHEDULE = 'research.schedule';
/** YouTube API Services policy: data about other channels must be refreshed or deleted within 30 days. */
export const YOUTUBE_DATA_TTL_DAYS = 30;
export const STALE_SIGNAL_DAYS = 14;
export const JOB_TYPE_PING = 'maintenance.ping';

/** Login lockout policy. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Each successive lockout doubles, up to this cap (backoff). */
export const MAX_LOCKOUT_MINUTES = 24 * 60;

/** Background reconciliation of jobs whose queue message was lost or whose worker died. */
export const STALE_QUEUED_MS = 30_000;
export const STALE_RUNNING_MS = 15 * 60_000;
