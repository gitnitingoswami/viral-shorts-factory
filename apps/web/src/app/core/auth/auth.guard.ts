import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from '@vsf/contracts';
import { AuthService } from './auth.service';

/** Allows navigation only with an active session; otherwise redirects to /login?returnUrl=... */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) {
    return true;
  }
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Keeps signed-in users away from the login page. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? inject(Router).createUrlTree(['/dashboard']) : true;
};

/**
 * Restricts a route to the roles listed in `route.data.roles`.
 * UI-only convenience: the API enforces authorization on every endpoint.
 */
export const roleGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  const roles = (route.data['roles'] as readonly UserRole[] | undefined) ?? [];
  return auth.hasRole(roles) ? true : router.createUrlTree(['/dashboard']);
};

/** Accepts only internal, absolute app paths to prevent open redirects. */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/dashboard';
  }
  return value.startsWith('/login') ? '/dashboard' : value;
}
