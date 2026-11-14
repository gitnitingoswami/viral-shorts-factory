import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { catchError, concatMap, from, map, Observable, throwError } from 'rxjs';
import { AuthedRequest, correlationIdOf } from '../common/auth-user';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Audits every authenticated mutating request (method + route pattern + status).
 * Request bodies are never recorded. Auth endpoints record their own, richer events.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!MUTATING.has(req.method) || !req.user) return next.handle();

    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const user = req.user;
    const base = {
      actorType: 'user' as const,
      actorId: user.id,
      workspaceId: user.workspaceId,
      action: `http.${req.method} ${route}`,
      correlationId: correlationIdOf(req),
      ip: req.ip ?? null,
    };

    // The audit row is written before the response is sent, so an acknowledged change is always audited.
    return next.handle().pipe(
      concatMap((body: unknown) => {
        const res = ctx.switchToHttp().getResponse<Response>();
        const subjectId = body && typeof body === 'object' && 'id' in body ? String(body.id) : null;
        return from(
          this.audit.record({ ...base, subjectId, outcome: 'success', details: { statusCode: res.statusCode } }),
        ).pipe(map(() => body));
      }),
      catchError((err: unknown) => {
        req.auditRecorded = true;
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        return from(this.audit.record({ ...base, outcome: 'failure', details: { statusCode } })).pipe(
          concatMap(() => throwError(() => err)),
        );
      }),
    );
  }
}
