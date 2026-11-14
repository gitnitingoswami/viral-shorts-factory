import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage, isApiUrl } from './api-error';

describe('api-error helpers', () => {
  it('uses ApiError.message (string or array)', () => {
    const single = new HttpErrorResponse({ status: 400, error: { statusCode: 400, error: 'Bad', message: 'nope' } });
    const multi = new HttpErrorResponse({ status: 400, error: { statusCode: 400, error: 'Bad', message: ['a', 'b'] } });
    expect(apiErrorMessage(single)).toBe('nope');
    expect(apiErrorMessage(multi)).toBe('a; b');
  });

  it('falls back for network and unknown errors', () => {
    expect(apiErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Cannot reach the server');
    expect(apiErrorMessage(new Error('x'), 'fallback')).toBe('fallback');
  });

  it('recognises API URLs', () => {
    expect(isApiUrl('/api/jobs')).toBe(true);
    expect(isApiUrl('/api')).toBe(true);
    expect(isApiUrl('/apiary')).toBe(false);
    expect(isApiUrl('https://other.test/api/jobs')).toBe(false);
  });
});
