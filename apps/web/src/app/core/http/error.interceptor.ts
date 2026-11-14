import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { apiErrorMessage } from './api-error';
import { SUPPRESS_ERROR_NOTIFICATION } from './http-context';
import { NotificationService } from './notification.service';

/**
 * Shows a snackbar for HTTP errors that callers did not opt to handle themselves.
 * 401s are excluded: the auth interceptor redirects to the login page instead.
 */
export const errorNotificationInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status !== 401 &&
        !req.context.get(SUPPRESS_ERROR_NOTIFICATION)
      ) {
        notifications.error(apiErrorMessage(err));
      }
      return throwError(() => err);
    }),
  );
};
