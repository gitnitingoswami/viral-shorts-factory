import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { errorNotificationInterceptor } from './core/http/error.interceptor';
import { loadingInterceptor } from './core/http/loading.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Order matters: loading wraps everything; error notification sees the final outcome
    // after the auth interceptor's refresh-and-retry.
    provideHttpClient(
      withInterceptors([loadingInterceptor, errorNotificationInterceptor, authInterceptor]),
    ),
    // One silent refresh on startup so a reload keeps the session via the HttpOnly cookie.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};
