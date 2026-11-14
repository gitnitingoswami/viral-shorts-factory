import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { isApiUrl } from '../http/api-error';
import { AUTH_URLS, AuthService } from './auth.service';

/** Endpoints that must never carry the bearer token or trigger a refresh-and-retry. */
const NO_BEARER_URLS: readonly string[] = [AUTH_URLS.login, AUTH_URLS.refresh];

function withBearer<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const path = pathOf(req.url);
  if (!isApiUrl(path) || NO_BEARER_URLS.includes(path)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  return next(withBearer(req, auth.accessToken())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || path === AUTH_URLS.logout) {
        return throwError(() => err);
      }
      return auth.refresh().pipe(
        catchError(() => {
          auth.clearSession();
          const returnUrl = router.url;
          void router.navigate(['/login'], {
            queryParams: returnUrl && returnUrl !== '/' && !returnUrl.startsWith('/login') ? { returnUrl } : {},
          });
          return throwError(() => err);
        }),
        switchMap((res) => next(withBearer(req, res.accessToken))),
      );
    }),
  );
};
