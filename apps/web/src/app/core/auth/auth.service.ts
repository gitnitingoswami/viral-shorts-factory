import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  type AuthTokenResponse,
  type LoginRequest,
  type UserDto,
  type UserRole,
} from '@vsf/contracts';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  map,
  of,
  share,
  tap,
  throwError,
} from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

export const AUTH_URLS = {
  login: `${API_BASE}/auth/login`,
  refresh: `${API_BASE}/auth/refresh`,
  logout: `${API_BASE}/auth/logout`,
} as const;

const csrfHeaders = (): HttpHeaders => new HttpHeaders({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE });

/**
 * Session state. The access token lives in memory only (a private signal) and is never
 * written to localStorage/sessionStorage. Reloads restore the session through the
 * HttpOnly refresh cookie via {@link AuthService.restoreSession}.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly token = signal<string | null>(null);
  private readonly user = signal<UserDto | null>(null);
  private refreshInFlight: Observable<AuthTokenResponse> | null = null;

  readonly currentUser = this.user.asReadonly();
  readonly isAuthenticated = computed(() => this.user() !== null && this.token() !== null);
  readonly isOwner = computed(() => this.user()?.role === 'owner');

  accessToken(): string | null {
    return this.token();
  }

  hasRole(roles: readonly UserRole[]): boolean {
    const role = this.user()?.role;
    return role !== undefined && roles.includes(role);
  }

  login(email: string, password: string): Observable<UserDto> {
    const body: LoginRequest = { email, password };
    return this.http
      .post<AuthTokenResponse>(AUTH_URLS.login, body, {
        withCredentials: true,
        context: handledErrorsContext(),
      })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.user),
      );
  }

  /**
   * Exchanges the HttpOnly refresh cookie for a new access token.
   * Single-flight: concurrent callers share one in-flight request.
   */
  refresh(): Observable<AuthTokenResponse> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.http
        .post<AuthTokenResponse>(
          AUTH_URLS.refresh,
          {},
          { headers: csrfHeaders(), withCredentials: true, context: handledErrorsContext(true) },
        )
        .pipe(
          tap((res) => this.setSession(res)),
          catchError((err: unknown) => {
            this.clearSession();
            return throwError(() => err);
          }),
          finalize(() => {
            this.refreshInFlight = null;
          }),
          share(),
        );
    }
    return this.refreshInFlight;
  }

  /** Revokes the server-side session (best effort) and always clears local state. */
  logout(): Observable<void> {
    return this.http
      .post<void>(
        AUTH_URLS.logout,
        {},
        { headers: csrfHeaders(), withCredentials: true, context: handledErrorsContext() },
      )
      .pipe(
        map(() => undefined),
        catchError(() => of(undefined)),
        finalize(() => this.clearSession()),
      );
  }

  /** Attempts one silent refresh at startup. Never rejects. */
  restoreSession(): Promise<void> {
    return firstValueFrom(
      this.refresh().pipe(
        map(() => undefined),
        catchError(() => of(undefined)),
      ),
    );
  }

  clearSession(): void {
    this.token.set(null);
    this.user.set(null);
  }

  private setSession(res: AuthTokenResponse): void {
    this.token.set(res.accessToken);
    this.user.set(res.user);
  }
}
