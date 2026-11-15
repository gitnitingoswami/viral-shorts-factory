import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CodeVerificationDto,
  ContentIdeaDto,
  CreateScriptVersionRequest,
  GenerateIdeasRequest,
  IdeaStatus,
  JobDto,
  LlmStatusDto,
  OverrideRequest,
  Page,
  ScriptClaimDto,
  ScriptDecisionRequest,
  ScriptDetailDto,
  ScriptDto,
  ScriptStatus,
  ScriptVersionDto,
  SelectIdeaResponse,
} from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

export interface IdeaQuery {
  topicId?: string | null;
  status?: IdeaStatus | null;
  limit?: number;
  offset?: number;
}

export interface ScriptQuery {
  status?: ScriptStatus | null;
  limit?: number;
  offset?: number;
}

/** Minimum override reason length (enforced by the API as well). */
export const MIN_OVERRIDE_REASON = 10;

function pageParams(
  filters: Record<string, string | null | undefined>,
  limit: number | undefined,
  offset: number | undefined,
): HttpParams {
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
 * Phase 03 content endpoints. Reads render their own inline error states (notification suppressed);
 * mutations whose errors the caller renders inline (decision 409s, stale edits, overrides) are also
 * suppressed, while fire-and-forget actions use the global notification.
 */
@Injectable({ providedIn: 'root' })
export class ContentApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/content`;

  llmStatus(): Observable<LlmStatusDto> {
    return this.http.get<LlmStatusDto>(`${this.url}/llm-status`, { context: handledErrorsContext(true) });
  }

  /** Owner only; the topic must be approved. Idempotent per key → 202 job. */
  generateIdeas(topicId: string, idempotencyKey: string): Observable<JobDto> {
    const body: GenerateIdeasRequest = { idempotencyKey };
    return this.http.post<JobDto>(`${API_BASE}/research/topics/${enc(topicId)}/ideas`, body, {
      context: handledErrorsContext(),
    });
  }

  listIdeas(query: IdeaQuery = {}): Observable<Page<ContentIdeaDto>> {
    return this.http.get<Page<ContentIdeaDto>>(`${this.url}/ideas`, {
      params: pageParams({ topicId: query.topicId, status: query.status }, query.limit, query.offset),
      context: handledErrorsContext(),
    });
  }

  /** Owner only → 202 with the new script id and its generation job. */
  selectIdea(id: string): Observable<SelectIdeaResponse> {
    return this.http.post<SelectIdeaResponse>(`${this.url}/ideas/${enc(id)}/select`, {});
  }

  /** Owner only. */
  discardIdea(id: string): Observable<ContentIdeaDto> {
    return this.http.post<ContentIdeaDto>(`${this.url}/ideas/${enc(id)}/discard`, {});
  }

  listScripts(query: ScriptQuery = {}): Observable<Page<ScriptDto>> {
    return this.http.get<Page<ScriptDto>>(`${this.url}/scripts`, {
      params: pageParams({ status: query.status }, query.limit, query.offset),
      context: handledErrorsContext(),
    });
  }

  getScript(id: string, options: { background?: boolean } = {}): Observable<ScriptDetailDto> {
    return this.http.get<ScriptDetailDto>(`${this.url}/scripts/${enc(id)}`, {
      context: handledErrorsContext(options.background ?? false),
    });
  }

  getVersion(id: string, version: number, options: { background?: boolean } = {}): Observable<ScriptVersionDto> {
    return this.http.get<ScriptVersionDto>(`${this.url}/scripts/${enc(id)}/versions/${version}`, {
      context: handledErrorsContext(options.background ?? false),
    });
  }

  /** Owner or reviewer. 409 when `baseVersion` is stale (rendered inline by the editor). */
  createVersion(id: string, body: CreateScriptVersionRequest): Observable<ScriptVersionDto> {
    return this.http.post<ScriptVersionDto>(`${this.url}/scripts/${enc(id)}/versions`, body, {
      context: handledErrorsContext(),
    });
  }

  /** Owner only. Re-runs fact-check, quality review and code verification → 202 job. */
  rerunChecks(id: string, version: number): Observable<JobDto> {
    return this.http.post<JobDto>(`${this.url}/scripts/${enc(id)}/versions/${version}/checks`, {});
  }

  /** Owner only; reason ≥ {@link MIN_OVERRIDE_REASON} chars. */
  overrideClaim(id: string, reason: string): Observable<ScriptClaimDto> {
    const body: OverrideRequest = { reason };
    return this.http.post<ScriptClaimDto>(`${this.url}/claims/${enc(id)}/override`, body, {
      context: handledErrorsContext(),
    });
  }

  /** Owner only; reason ≥ {@link MIN_OVERRIDE_REASON} chars. */
  overrideCodeCheck(id: string, reason: string): Observable<CodeVerificationDto> {
    const body: OverrideRequest = { reason };
    return this.http.post<CodeVerificationDto>(`${this.url}/code-checks/${enc(id)}/override`, body, {
      context: handledErrorsContext(),
    });
  }

  /** Owner or reviewer. `approved` answers 409 with the blocker list when gates fail. */
  decide(id: string, body: ScriptDecisionRequest): Observable<ScriptDto> {
    return this.http.post<ScriptDto>(`${this.url}/scripts/${enc(id)}/decision`, body, {
      context: handledErrorsContext(),
    });
  }
}
