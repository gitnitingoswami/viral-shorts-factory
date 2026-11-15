import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  NicheDto,
  Page,
  ResearchSourceDto,
  StartResearchRunRequest,
  TopicDecisionRequest,
  TopicStatus,
  TrendCollectionDto,
  TrendTopicDetailDto,
  TrendTopicDto,
  WeeklyTrendReportDto,
} from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

export type TopicSort = 'score' | 'freshness' | 'confidence';

export interface TopicQuery {
  status?: TopicStatus | null;
  minScore?: number | null;
  q?: string | null;
  sort?: TopicSort | null;
  limit?: number;
  offset?: number;
}

export interface CollectionQuery {
  nicheId?: NicheDto['id'] | null;
  limit?: number;
  offset?: number;
}

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/** Builds topic list params, omitting empty/default filters. */
export function topicQueryParams(query: TopicQuery): HttpParams {
  let params = new HttpParams();
  if (query.status) {
    params = params.set('status', query.status);
  }
  if (typeof query.minScore === 'number' && query.minScore > 0) {
    params = params.set('minScore', String(Math.min(1, query.minScore)));
  }
  const q = query.q?.trim();
  if (q) {
    params = params.set('q', q);
  }
  if (query.sort) {
    params = params.set('sort', query.sort);
  }
  if (query.limit !== undefined) {
    params = params.set('limit', query.limit);
  }
  if (query.offset !== undefined) {
    params = params.set('offset', query.offset);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ResearchApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/research`;

  listSources(): Observable<ResearchSourceDto[]> {
    return this.http.get<ResearchSourceDto[]>(`${this.url}/sources`, { context: handledErrorsContext() });
  }

  /** Owner only. Idempotent per key, so retries must reuse the same key. Answers 202. */
  startRun(nicheId: string, idempotencyKey: string): Observable<TrendCollectionDto> {
    const body: StartResearchRunRequest = { nicheId, idempotencyKey };
    return this.http.post<TrendCollectionDto>(`${this.url}/runs`, body);
  }

  /** Newest first. */
  listCollections(query: CollectionQuery = {}): Observable<Page<TrendCollectionDto>> {
    let params = new HttpParams();
    if (query.nicheId) {
      params = params.set('nicheId', query.nicheId);
    }
    if (query.limit !== undefined) {
      params = params.set('limit', query.limit);
    }
    if (query.offset !== undefined) {
      params = params.set('offset', query.offset);
    }
    return this.http.get<Page<TrendCollectionDto>>(`${this.url}/collections`, {
      params,
      context: handledErrorsContext(),
    });
  }

  /** `background` requests (polling) do not drive the global progress bar. */
  getCollection(id: string, options: { background?: boolean } = {}): Observable<TrendCollectionDto> {
    return this.http.get<TrendCollectionDto>(`${this.url}/collections/${encodeURIComponent(id)}`, {
      context: handledErrorsContext(options.background ?? false),
    });
  }

  listTopics(collectionId: string, query: TopicQuery = {}): Observable<Page<TrendTopicDto>> {
    return this.http.get<Page<TrendTopicDto>>(
      `${this.url}/collections/${encodeURIComponent(collectionId)}/topics`,
      { params: topicQueryParams(query), context: handledErrorsContext() },
    );
  }

  /** 404 until the collection has finished. */
  getReport(collectionId: string): Observable<WeeklyTrendReportDto> {
    return this.http.get<WeeklyTrendReportDto>(
      `${this.url}/collections/${encodeURIComponent(collectionId)}/report`,
      { context: handledErrorsContext() },
    );
  }

  getTopic(id: string): Observable<TrendTopicDetailDto> {
    return this.http.get<TrendTopicDetailDto>(`${this.url}/topics/${encodeURIComponent(id)}`, {
      context: handledErrorsContext(),
    });
  }

  /** 2–4 topic ids. */
  compareTopics(ids: readonly string[]): Observable<TrendTopicDetailDto[]> {
    const params = new HttpParams().set('ids', ids.join(','));
    return this.http.get<TrendTopicDetailDto[]>(`${this.url}/topics/compare`, {
      params,
      context: handledErrorsContext(),
    });
  }

  /** Owner or reviewer. Errors are left to the global error notification. */
  decide(topicId: string, body: TopicDecisionRequest): Observable<TrendTopicDto> {
    return this.http.post<TrendTopicDto>(`${this.url}/topics/${encodeURIComponent(topicId)}/decision`, body);
  }
}
