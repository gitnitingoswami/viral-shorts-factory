import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { NicheDto, UpsertNicheRequest } from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

@Injectable({ providedIn: 'root' })
export class NichesApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/niches`;

  list(): Observable<NicheDto[]> {
    return this.http.get<NicheDto[]>(this.url, { context: handledErrorsContext() });
  }

  /** Owner only. Errors are left to the global error notification. */
  create(body: UpsertNicheRequest): Observable<NicheDto> {
    return this.http.post<NicheDto>(this.url, body);
  }

  /** Owner only. Accepts any subset of the upsert fields. */
  update(id: string, body: Partial<UpsertNicheRequest>): Observable<NicheDto> {
    return this.http.patch<NicheDto>(`${this.url}/${encodeURIComponent(id)}`, body);
  }
}
