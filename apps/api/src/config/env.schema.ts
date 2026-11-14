import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const PLACEHOLDER_SECRET = 'replace-with-at-least-32-random-characters';

/**
 * Environment contract. The process fails fast at boot if any value is invalid.
 * Secrets are only ever read from the environment (never from source or docs).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    APP_VERSION: z.string().default('0.1.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:4200'),

    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().default(55432),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),

    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().default(56379),
    /** Isolates BullMQ queues per environment sharing one Redis (e.g. dev vs. tests). */
    QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]{1,32}$/).default('vsf'),

    STORAGE_ENDPOINT: z.url().optional(),
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_BUCKET: z.string().min(3),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: bool.default(true),
    STORAGE_AUTO_CREATE_BUCKET: bool.default(false),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
      .refine((v) => v !== PLACEHOLDER_SECRET, 'JWT_ACCESS_SECRET is still the .env.example placeholder'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    COOKIE_SECURE: bool.default(true),

    BOOTSTRAP_OWNER_EMAIL: z.union([z.literal(''), z.email()]).optional(),
    BOOTSTRAP_OWNER_PASSWORD: z.union([z.literal(''), z.string().min(12)]).optional(),

    SWAGGER_ENABLED: bool.default(false),
    /** Rate limiting; disable only in automated tests. */
    THROTTLE_ENABLED: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.THROTTLE_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['THROTTLE_ENABLED'], message: 'must be true in production' });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
    }
    if (Boolean(env.BOOTSTRAP_OWNER_EMAIL) !== Boolean(env.BOOTSTRAP_OWNER_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_OWNER_PASSWORD'],
        message: 'BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD must be set together',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/** Used by @nestjs/config `validate`. Throws a readable error listing every invalid key (values are never echoed). */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
