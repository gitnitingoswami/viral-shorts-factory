import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceHttpError';
  }
}

export interface SafeFetchOptions {
  /** Exact host names this request (and any redirect) may reach. */
  allowedHosts: ReadonlySet<string>;
  timeoutMs: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Injected for tests; defaults to real DNS. */
  resolve?: (host: string) => Promise<string[]>;
}

/** Fetch function signature used by every adapter (real or fixture-backed in tests). */
export type HttpGet = (url: string, opts: SafeFetchOptions) => Promise<string>;

const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('ff');
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/** Validates a URL against the SSRF policy. Throws SourceHttpError when not allowed. */
export async function assertSafeUrl(raw: string, opts: SafeFetchOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceHttpError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new SourceHttpError('Only https URLs are allowed');
  if (url.username || url.password) throw new SourceHttpError('Credentials in URL are not allowed');
  if (!opts.allowedHosts.has(url.hostname)) throw new SourceHttpError(`Host not allowlisted: ${url.hostname}`);
  if (isIP(url.hostname)) throw new SourceHttpError('IP-literal hosts are not allowed');
  const addresses = await (opts.resolve ?? defaultResolve)(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new SourceHttpError(`Host resolves to a non-public address: ${url.hostname}`);
  }
  return url;
}

/**
 * GET with SSRF protection (https only, host allowlist, public IPs only, re-checked on every redirect),
 * a timeout and a response size cap. Returns the body as text.
 */
export const safeGet: HttpGet = async (raw, opts) => {
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeUrl(current, opts);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { 'user-agent': 'vsf-research/0.1', accept: '*/*', ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new SourceHttpError('Redirect without location', res.status);
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new SourceHttpError(`HTTP ${res.status}`, res.status);
    return readCapped(res, maxBytes);
  }
  throw new SourceHttpError('Too many redirects');
};

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new SourceHttpError('Response too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SourceHttpError('Response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
