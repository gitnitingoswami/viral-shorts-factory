import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateProductionRequest,
  CreateProductionResponse,
  MediaAssetDto,
  MediaKind,
  Page,
  ProductionStatus,
  RenderCapabilityDto,
  SignedMediaUrlDto,
  VideoProductionDetailDto,
  VideoProductionDto,
  VoiceProfileDto,
} from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

export interface ProductionQuery {
  status?: ProductionStatus | null;
  limit?: number;
  offset?: number;
}

export interface AssetQuery {
  kind?: MediaKind | null;
  limit?: number;
  offset?: number;
}

/** `background` requests (polling, media URL refreshes) do not drive the global progress bar. */
export interface BackgroundOption {
  background?: boolean;
}

function pageParams(filters: Record<string, string | null | undefined>, limit?: number, offset?: number): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params = params.set(key, value);
    }
  }
  if (limit !== undefined) {
    params = params.set('limit', limit);
  }
  if (offset !== undefined) {
    params = params.set('offset', offset);
  }
  return params;
}

const enc = encodeURIComponent;

/**
 * Phase 04 video production endpoints. Reads and mutations whose errors the caller renders inline
 * (create 409/400) suppress the global notification; cancel/retry use the global notification.
 */
@Injectable({ providedIn: 'root' })
export class VideoApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/video`;

  status(): Observable<RenderCapabilityDto> {
    return this.http.get<RenderCapabilityDto>(`${this.url}/status`, { context: handledErrorsContext(true) });
  }

  voices(): Observable<VoiceProfileDto[]> {
    return this.http.get<VoiceProfileDto[]>(`${this.url}/voices`, { context: handledErrorsContext() });
  }

  /** Owner only → 202. `created: false` when an identical production already existed. 409 when not approved. */
  createProduction(body: CreateProductionRequest): Observable<CreateProductionResponse> {
    return this.http.post<CreateProductionResponse>(`${this.url}/productions`, body, {
      context: handledErrorsContext(),
    });
  }

  listProductions(query: ProductionQuery = {}, options: BackgroundOption = {}): Observable<Page<VideoProductionDto>> {
    return this.http.get<Page<VideoProductionDto>>(`${this.url}/productions`, {
      params: pageParams({ status: query.status }, query.limit, query.offset),
      context: handledErrorsContext(options.background ?? false),
    });
  }

  getProduction(id: string, options: BackgroundOption = {}): Observable<VideoProductionDetailDto> {
    return this.http.get<VideoProductionDetailDto>(`${this.url}/productions/${enc(id)}`, {
      context: handledErrorsContext(options.background ?? false),
    });
  }

  /** Owner only; 409 unless queued/rendering. */
  cancelProduction(id: string): Observable<VideoProductionDto> {
    return this.http.post<VideoProductionDto>(`${this.url}/productions/${enc(id)}/cancel`, {});
  }

  /** Owner only; allowed for failed, quality_failed and cancelled → 202. */
  retryProduction(id: string): Observable<CreateProductionResponse> {
    return this.http.post<CreateProductionResponse>(`${this.url}/productions/${enc(id)}/retry`, {});
  }

  listAssets(query: AssetQuery = {}): Observable<Page<MediaAssetDto>> {
    return this.http.get<Page<MediaAssetDto>>(`${this.url}/assets`, {
      params: pageParams({ kind: query.kind }, query.limit, query.offset),
      context: handledErrorsContext(),
    });
  }

  /** Short-lived relative signed URL usable directly as a media element `src` (no auth header). */
  assetUrl(id: string): Observable<SignedMediaUrlDto> {
    return this.http.get<SignedMediaUrlDto>(`${this.url}/assets/${enc(id)}/url`, {
      context: handledErrorsContext(true),
    });
  }
}
