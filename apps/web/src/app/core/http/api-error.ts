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

/**
 * All messages from an `ApiError` (array messages stay separate, e.g. approval blockers).
 * Falls back to {@link apiErrorMessage} when the body has no usable message.
 */
export function apiErrorMessages(err: unknown, fallback?: string): string[] {
  if (err instanceof HttpErrorResponse && isApiError(err.error)) {
    const { message } = err.error;
    const list = (Array.isArray(message) ? message : [message]).map((m) => String(m).trim()).filter(Boolean);
    if (list.length > 0) {
      return list;
    }
  }
  return [apiErrorMessage(err, fallback)];
}

/** HTTP status of an error, or null when it is not an HTTP error. */
export function httpStatus(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}

/** True for same-origin API URLs (relative `/api` or `/api/...`). */
export function isApiUrl(url: string): boolean {
  return url === API_BASE || url.startsWith(`${API_BASE}/`) || url.startsWith(`${API_BASE}?`);
}
