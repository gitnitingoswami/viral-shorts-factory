import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '@vsf/contracts';

/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: UserRole;
  workspaceId: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  /** Set by AuditInterceptor when it has already audited this request's failure. */
  auditRecorded?: boolean;
}

export const IS_PUBLIC_KEY = 'vsf:isPublic';
/** Marks a route as not requiring authentication. Everything else is protected by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'vsf:roles';
/** Restricts a route to the given roles (checked after authentication). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});

/** Correlation ID assigned by the request logger (pino-http genReqId). */
export function correlationIdOf(req: AuthedRequest): string | null {
  const id = (req as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}
