/**
 * E2E environment. Points every test at the disposable `vsf_test` database and a test bucket.
 * Real process.env values (e.g. from CI) take precedence for connection settings only.
 */
import { randomBytes } from 'node:crypto';

const env = process.env;
env.NODE_ENV = 'test';
env.LOG_LEVEL = 'silent';
env.DB_HOST ??= 'localhost';
env.DB_PORT ??= '55432';
env.DB_USER ??= 'vsf';
env.DB_PASSWORD ??= 'vsf_local_only';
env.DB_NAME = 'vsf_test';
env.REDIS_HOST ??= 'localhost';
env.REDIS_PORT ??= '56379';
env.QUEUE_PREFIX = 'vsf-test';
env.STORAGE_ENDPOINT ??= 'http://localhost:8333';
env.STORAGE_ACCESS_KEY ??= 'vsf_local_access';
env.STORAGE_SECRET_KEY ??= 'vsf_local_secret_only';
env.STORAGE_BUCKET = 'vsf-test';
env.STORAGE_AUTO_CREATE_BUCKET = 'true';
env.STORAGE_FORCE_PATH_STYLE = 'true';
env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
env.COOKIE_SECURE = 'false';
env.THROTTLE_ENABLED = 'false';
env.TRUST_PROXY = '1';
env.JOB_RECONCILE_INTERVAL_MS = '500';
// Fake credentials so the YouTube/GitHub code paths run against fixture HTTP (never the network).
env.YOUTUBE_API_KEY = 'AIzaFAKE-test-key-0123456789';
env.GITHUB_RESEARCH_TOKEN = '';
env.RESEARCH_RSS_FEEDS = 'https://nodejs.org/en/feed/blog.xml';
env.RESEARCH_CRON = '0 6 * * 1';
// Never call a real LLM from tests, even if a developer has ANTHROPIC_API_KEY in .env.
env.ANTHROPIC_API_KEY = '';
env.LLM_FORCE_MOCK = 'true';
env.CODE_SANDBOX = 'docker';
env.CODE_SANDBOX_TIMEOUT_MS = '8000';
env.SWAGGER_ENABLED = 'false';
env.BOOTSTRAP_OWNER_EMAIL = '';
env.BOOTSTRAP_OWNER_PASSWORD = '';
env.CORS_ORIGINS = 'http://localhost:4200';
