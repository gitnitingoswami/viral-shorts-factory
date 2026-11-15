import type { HttpGet } from '../src/research/http';

/** Fixture-backed research HTTP. Dates are relative to now so items fall inside the 7-day window. */
export interface FixtureOptions {
  failHosts?: string[];
  /** Error message thrown for YouTube (used to verify secrets are scrubbed). */
  youtubeError?: string;
  youtubeCounts?: Record<string, number>;
}

const hoursAgo = (h: number) => Math.floor(Date.now() / 1000) - h * 3600;

export const SHARED_URL = 'https://devblogs.example.com/typescript-6-1';

export function fixtureHttp(o: FixtureOptions = {}): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const fn: HttpGet = (url) => {
    calls.push(url);
    const u = new URL(url);
    if (o.failHosts?.includes(u.hostname)) return Promise.reject(new Error('HTTP 503'));
    switch (u.hostname) {
      case 'hn.algolia.com':
        return Promise.resolve(
          JSON.stringify({
            hits: [
              { objectID: '101', title: 'TypeScript 6.1 released with faster builds', url: SHARED_URL, points: 640, num_comments: 210, created_at_i: hoursAgo(10) },
              { objectID: '102', title: 'Node.js permission model in practice', url: 'https://blog.example.com/node-perms', points: 120, num_comments: 40, created_at_i: hoursAgo(50) },
              { objectID: '103', title: 'Gardening for programmers', url: 'https://garden.example.com/', points: 900, num_comments: 300, created_at_i: hoursAgo(5) },
            ],
          }),
        );
      case 'api.stackexchange.com':
        return Promise.resolve(
          JSON.stringify({
            items: [
              { question_id: 501, title: 'TypeScript satisfies vs as const?', link: 'https://stackoverflow.com/q/501', tags: ['typescript'], score: 12, answer_count: 3, view_count: 2400, creation_date: hoursAgo(30) },
              { question_id: 502, title: 'Node.js stream backpressure explained', link: 'https://stackoverflow.com/q/502', tags: ['node.js', 'stream'], score: 4, answer_count: 1, view_count: 300, creation_date: hoursAgo(70) },
            ],
          }),
        );
      case 'api.github.com':
        return Promise.resolve(
          JSON.stringify({
            items: [
              { id: 9001, full_name: 'acme/ts-tips', html_url: 'https://github.com/acme/ts-tips', description: 'Bite-sized TypeScript tips', stargazers_count: 450, forks_count: 12, created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), topics: ['typescript'] },
            ],
          }),
        );
      case 'nodejs.org':
        return Promise.resolve(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Node.js Blog</title>
            <item><title>Announcing TypeScript 6.1 released: faster builds</title><link>${SHARED_URL}</link>
            <pubDate>${new Date(Date.now() - 12 * 3600_000).toUTCString()}</pubDate><guid>n1</guid></item>
            <item><title>Node.js 24.12 (LTS)</title><link>https://nodejs.org/en/blog/release/v24.12</link>
            <pubDate>${new Date(Date.now() - 24 * 3600_000).toUTCString()}</pubDate><guid>n2</guid><category>release</category></item>
          </channel></rss>`,
        );
      case 'www.googleapis.com': {
        if (o.youtubeError) return Promise.reject(new Error(o.youtubeError));
        const q = u.searchParams.get('q') ?? '';
        const n = Object.entries(o.youtubeCounts ?? {}).find(([k]) => q.includes(k))?.[1] ?? 5;
        return Promise.resolve(JSON.stringify({ items: Array.from({ length: Math.min(n, 50) }, () => ({})), pageInfo: { totalResults: n } }));
      }
      default:
        return Promise.reject(new Error(`unexpected host ${u.hostname}`));
    }
  };
  return Object.assign(fn, { calls });
}
