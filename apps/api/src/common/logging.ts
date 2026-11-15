import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/config';
import { ConfigService } from '@nestjs/config';
import { CORRELATION_HEADER } from './constants';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Reuses a well-formed inbound correlation ID, otherwise generates one; echoes it on the response. */
export function correlationId(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers[CORRELATION_HEADER];
  const id = typeof inbound === 'string' && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

/** Strips the query (exp/sig) from signed media URLs before logging. */
export function redactMediaQuery(url: string | undefined): string | undefined {
  return url?.startsWith('/api/video/media/') ? url.replace(/\?.*$/, '?[REDACTED]') : url;
}

/** pino-http request serializer: signed media requests lose both the raw query and the parsed `query` object. */
export function serializeRequest(req: { url?: string; query?: unknown } & Record<string, unknown>): Record<string, unknown> {
  const media = req.url?.startsWith('/api/video/media/') ?? false;
  return { ...req, url: redactMediaQuery(req.url), ...(media ? { query: undefined } : {}) };
}

/** pino-pretty is a devDependency; production images don't include it. */
function isInstalled(pkg: string): boolean {
  try {
    require.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/** Structured JSON logs; secrets and cookies are redacted. Pretty output only in development. */
export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: AppConfigService) => {
    const pretty = config.get('NODE_ENV', { infer: true }) === 'development' && isInstalled('pino-pretty');
    return {
      pinoHttp: {
        level: config.get('LOG_LEVEL', { infer: true }),
        genReqId: correlationId,
        customProps: () => ({ service: 'vsf-api' }),
        // Signed media URLs carry a capability in the query string: never log it.
        serializers: { req: serializeRequest },
        redact: {
          paths: [
            'req.query.sig',
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.accessToken',
            '*.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false },
        transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    };
  },
});
