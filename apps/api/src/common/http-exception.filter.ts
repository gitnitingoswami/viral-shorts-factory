import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import type { ApiError } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { AuthedRequest, correlationIdOf } from './auth-user';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(e: unknown): boolean {
  return e instanceof QueryFailedError && (e.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION;
}

/**
 * Normalizes every error to the `ApiError` contract and never leaks internals (stack traces, SQL,
 * provider messages). Also audits authorization denials (401/403) and rate-limit hits, which never
 * reach the audit interceptor because guards reject them first.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly audit: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();
    const correlationId = correlationIdOf(req) ?? undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      message = 'Too many requests';
      error = 'Too Many Requests';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
      }
      if (typeof body === 'string' || !(body as { error?: string }).error) {
        error = HttpStatus[status] ?? 'Error';
      }
    } else if (isUniqueViolation(exception)) {
      // A concurrent create lost the race against a unique constraint.
      status = HttpStatus.CONFLICT;
      message = 'Resource already exists';
      error = 'Conflict';
    } else {
      this.logger.error({ err: exception, correlationId }, 'Unhandled exception');
    }

    let auditDone: Promise<void> = Promise.resolve();
    // Audit denials only for authenticated principals (e.g. a reviewer hitting an owner-only route).
    // Unauthenticated 401/403/429 are logged, not audited: anyone could otherwise flood the append-only
    // table. Mutating requests by an authenticated user are already audited by AuditInterceptor.
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const isDenial = status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN || status === HttpStatus.TOO_MANY_REQUESTS;
    if (isDenial && !req.user) {
      this.logger.warn({ correlationId, status, route, ip: req.ip }, 'Request denied');
    }
    if (isDenial && req.user) {
      // Guard denials never reach the interceptor; errors thrown inside handlers were already audited there.
      if (!req.auditRecorded) {
        auditDone = this.audit.record({
          actorType: 'user',
          actorId: req.user.id,
          workspaceId: req.user.workspaceId,
          action: 'http.denied',
          subjectType: 'route',
          subjectId: `${req.method} ${route}`,
          outcome: 'failure',
          correlationId: correlationId ?? null,
          ip: req.ip ?? null,
          details: { statusCode: status },
        });
      }
    }

    const payload: ApiError = { statusCode: status, error, message, correlationId };
    // AuditService.record never rejects; respond once the denial is recorded.
    void auditDone.then(() => res.status(status).json(payload));
  }
}
