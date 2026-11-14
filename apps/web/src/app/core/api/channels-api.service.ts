import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ChannelDto, CreateChannelRequest } from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

@Injectable({ providedIn: 'root' })
export class ChannelsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/channels`;

  list(): Observable<ChannelDto[]> {
    return this.http.get<ChannelDto[]>(this.url, { context: handledErrorsContext() });
  }

  /** Owner only. Errors are left to the global error notification. */
  create(body: CreateChannelRequest): Observable<ChannelDto> {
    return this.http.post<ChannelDto>(this.url, body);
  }
}
