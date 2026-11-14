import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ReadinessResponse } from '@vsf/contracts';
import { Observable, catchError, of, throwError } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

export function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Partial<ReadinessResponse>;
  return (v.status === 'ok' || v.status === 'degraded') && typeof v.checks === 'object' && v.checks !== null;
}

@Injectable({ providedIn: 'root' })
export class HealthApiService {
  private readonly http = inject(HttpClient);

  /**
   * GET /api/health/ready. The API answers 503 with a `ReadinessResponse` body when degraded;
   * that body is returned as data rather than surfaced as an error.
   */
  getReadiness(options: { background?: boolean } = {}): Observable<ReadinessResponse> {
    return this.http
      .get<ReadinessResponse>(`${API_BASE}/health/ready`, {
        context: handledErrorsContext(options.background ?? false),
      })
      .pipe(
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && err.status === 503 && isReadinessResponse(err.error)) {
            return of(err.error);
          }
          return throwError(() => err);
        }),
      );
  }
}
