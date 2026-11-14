import { runCheck } from './health.service';

describe('runCheck', () => {
  it('reports up with latency when the probe resolves', async () => {
    const r = await runCheck(() => Promise.resolve('ok'), true);
    expect(r.status).toBe('up');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.error).toBeUndefined();
  });

  it('reports down with the error when exposure is allowed', async () => {
    const r = await runCheck(() => Promise.reject(new Error('connection refused')), true);
    expect(r).toMatchObject({ status: 'down', error: 'connection refused' });
  });

  it('hides error details when exposure is not allowed (production)', async () => {
    const r = await runCheck(
      () => Promise.reject(new Error('password authentication failed for user vsf at 10.0.0.5')),
      false,
    );
    expect(r).toMatchObject({ status: 'down', error: 'unavailable' });
  });

  it('times out a hanging probe', async () => {
    const r = await runCheck(() => new Promise(() => undefined), true, 50);
    expect(r.status).toBe('down');
    expect(r.error).toMatch(/timed out/);
  });
});
