import { HttpErrorResponse } from '@angular/common/http';
import type { ApiError } from '@vsf/contracts';

export const API_BASE = '/api';

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' || Array.isArray(message);
}

/** Extracts a human-readable message from an HTTP error, preferring `ApiError.message`. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof HttpErrorResponse) {
    if (isApiError(err.error)) {
      const { message } = err.error;
      const text = Array.isArray(message) ? message.join('; ') : message;
      if (text.trim().length > 0) {
        return text;
      }
    }
    if (err.status === 0) {
      return 'Cannot reach the server. Check your connection.';
    }
  }
  return fallback;
}

/** True for same-origin API URLs (relative `/api` or `/api/...`). */
export function isApiUrl(url: string): boolean {
  return url === API_BASE || url.startsWith(`${API_BASE}/`) || url.startsWith(`${API_BASE}?`);
}
