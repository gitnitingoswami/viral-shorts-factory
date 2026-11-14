import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuditEventDto, Page } from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(HttpClient);

  /** Owner only. */
  list(limit: number, offset: number): Observable<Page<AuditEventDto>> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<Page<AuditEventDto>>(`${API_BASE}/audit-events`, {
      params,
      context: handledErrorsContext(),
    });
  }
}
