import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { EnqueuePingRequest, JobDto, Page } from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

@Injectable({ providedIn: 'root' })
export class JobsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/jobs`;

  list(): Observable<Page<JobDto>> {
    return this.http.get<Page<JobDto>>(this.url, { context: handledErrorsContext() });
  }

  /** `background` requests (polling) do not drive the global progress bar. */
  get(id: string, options: { background?: boolean } = {}): Observable<JobDto> {
    return this.http.get<JobDto>(`${this.url}/${encodeURIComponent(id)}`, {
      context: handledErrorsContext(options.background ?? false),
    });
  }

  /** Owner only. Idempotent per key, so retries must reuse the same key. */
  enqueuePing(idempotencyKey: string): Observable<JobDto> {
    const body: EnqueuePingRequest = { idempotencyKey };
    return this.http.post<JobDto>(`${this.url}/maintenance/ping`, body);
  }
}
