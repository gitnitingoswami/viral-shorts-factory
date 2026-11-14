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
env.SWAGGER_ENABLED = 'false';
env.BOOTSTRAP_OWNER_EMAIL = '';
env.BOOTSTRAP_OWNER_PASSWORD = '';
env.CORS_ORIGINS = 'http://localhost:4200';
