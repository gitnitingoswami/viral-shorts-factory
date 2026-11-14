import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ApiError } from '@vsf/contracts';
import { AuthedRequest, correlationIdOf } from './auth-user';

/**
 * Normalizes every error to the `ApiError` contract and never leaks internals (stack traces,
 * SQL, provider messages) for unexpected errors.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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
    } else {
      this.logger.error({ err: exception, correlationId }, 'Unhandled exception');
    }

    const payload: ApiError = { statusCode: status, error, message, correlationId };
    res.status(status).json(payload);
  }
}
