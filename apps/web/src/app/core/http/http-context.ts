import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * When true, the global error interceptor will not show a snackbar for this request.
 * Use it when the calling component renders the error itself (inline error state).
 */
export const SUPPRESS_ERROR_NOTIFICATION = new HttpContextToken<boolean>(() => false);

/** When true, the request does not drive the global progress bar (e.g. background polling). */
export const SILENT_LOADING = new HttpContextToken<boolean>(() => false);

export function handledErrorsContext(silent = false): HttpContext {
  const ctx = new HttpContext().set(SUPPRESS_ERROR_NOTIFICATION, true);
  return silent ? ctx.set(SILENT_LOADING, true) : ctx;
}
