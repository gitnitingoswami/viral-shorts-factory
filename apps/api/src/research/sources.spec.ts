import { scrub } from './adapters.provider';
import { assertSafeUrl, HttpGet, isPrivateAddress, SafeFetchOptions, SourceHttpError } from './http';
import { buildReport, mdText } from './report';
import { clusterSignals, scoreClusters } from './scoring';
import { GitHubAdapter, HackerNewsAdapter, parseFeed, RssAdapter, StackExchangeAdapter, YouTubeCompetitionClient } from './sources';

const NOW = new Date('2026-11-15T12:00:00Z');
const ctx = { keywords: ['typescript', 'node.js'], windowStart: new Date('2026-11-08T12:00:00Z'), windowEnd: NOW, now: NOW };

function fakeHttp(routes: Record<string, string | Error>): HttpGet & { calls: Array<{ url: string; opts: SafeFetchOptions }> } {
  const calls: Array<{ url: string; opts: SafeFetchOptions }> = [];
  const fn = (url: string, opts: SafeFetchOptions) => {
    calls.push({ url, opts });
    const host = new URL(url).hostname;
    const hit = routes[url] ?? routes[host];
    if (hit === undefined) return Promise.reject(new Error(`no route for ${url}`));
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit);
  };
  return Object.assign(fn, { calls });
}

describe('SSRF guard', () => {
  const base = { allowedHosts: new Set(['feeds.example.org']), timeoutMs: 1000 };

  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(['93.184.216.34', '140.82.112.3', '2606:4700::1111'])('treats %s as public', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('accepts an allowlisted https host resolving to public IPs', async () => {
    await expect(assertSafeUrl('https://feeds.example.org/rss', { ...base, resolve: () => Promise.resolve(['93.184.216.34']) })).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ['http://feeds.example.org/rss', /https/],
    ['https://evil.example.com/rss', /not allowlisted/],
    ['https://user:pw@feeds.example.org/', /Credentials/],
    ['not a url', /Invalid URL/],
  ])('rejects %s', async (url, msg) => {
    await expect(assertSafeUrl(url, { ...base, resolve: () => Promise.resolve(['93.184.216.34']) })).rejects.toThrow(msg);
  });

  it('rejects an allowlisted host that resolves to a private address (DNS rebinding / internal service)', async () => {
    await expect(assertSafeUrl('https://feeds.example.org/', { ...base, resolve: () => Promise.resolve(['10.0.0.5']) })).rejects.toThrow(
      SourceHttpError,
    );
  });
});

describe('parseFeed', () => {
  it('parses RSS 2.0 with CDATA and categories', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
      <item><title><![CDATA[Node.js 24.1 & friends]]></title><link>https://nodejs.org/en/blog/a</link>
      <pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate><category>release</category><guid>g1</guid></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      { id: 'g1', title: 'Node.js 24.1 & friends', link: 'https://nodejs.org/en/blog/a', published: new Date('2026-11-13T10:00:00Z'), categories: ['release'] },
    ]);
  });

  it('parses Atom entries with alternate links', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>e1</id><title>TypeScript 6.1</title>
      <link rel="alternate" href="https://devblogs.example/ts61"/><updated>2026-11-12T00:00:00Z</updated>
      <category term="TypeScript"/></entry></feed>`;
    const [e] = parseFeed(xml);
    expect(e).toMatchObject({ id: 'e1', title: 'TypeScript 6.1', link: 'https://devblogs.example/ts61', categories: ['TypeScript'] });
  });

  it('rejects unknown formats', () => {
    expect(() => parseFeed('<html><body>nope</body></html>')).toThrow(/Unrecognized/);
  });
});

describe('adapters', () => {
  const deps = (http: HttpGet) => ({ http, timeoutMs: 1000 });

  it('Hacker News: maps hits, restricts the host, never tags by query keyword', async () => {
    const http = fakeHttp({
      'hn.algolia.com': JSON.stringify({
        hits: [
          { objectID: '1', title: 'TypeScript 6 is out', url: 'https://ts.example/6', points: 300, num_comments: 120, created_at_i: 1794400000 },
          { objectID: '2', title: null },
        ],
      }),
    });
    const out = await new HackerNewsAdapter(deps(http)).fetch(ctx);
    expect(out).toHaveLength(1); // hit without title dropped; duplicate across keywords collapsed
    expect(out[0]).toMatchObject({ externalId: '1', tags: [], metrics: { points: 300, comments: 120 } });
    expect(http.calls[0].opts.allowedHosts).toEqual(new Set(['hn.algolia.com']));
    expect(http.calls).toHaveLength(2); // one query per keyword
  });

  it('Stack Exchange: decodes entities and uses real tags', async () => {
    const http = fakeHttp({
      'api.stackexchange.com': JSON.stringify({
        items: [{ question_id: 9, title: 'Why &quot;never&quot; &amp; unknown?', link: 'https://stackoverflow.com/q/9', tags: ['typescript'], score: 5, answer_count: 2, view_count: 400, creation_date: 1794400000 }],
      }),
    });
    const [q] = await new StackExchangeAdapter(deps(http)).fetch(ctx);
    expect(q).toMatchObject({ title: 'Why "never" & unknown?', tags: ['typescript'], metrics: { score: 5, answers: 2, views: 400 } });
    expect(http.calls[1].url).toContain('tagged=node.js');
  });

  it('GitHub: excludes forks, de-duplicates clones by description, ignores language as relevance, sends token', async () => {
    const repo = (id: number, name: string, desc: string, stars: number) => ({
      id, full_name: `o${id}/${name}`, html_url: `https://github.com/o${id}/${name}`, description: desc, stargazers_count: stars, created_at: '2026-11-12T00:00:00Z', topics: ['cli'], language: 'TypeScript',
    });
    const http = fakeHttp({
      'api.github.com': JSON.stringify({
        items: [repo(1, 'agent', 'A general-purpose AI agent system that runs tools', 900), repo(2, 'agent-copy', 'A general-purpose AI agent system that runs tools', 800), repo(3, 'ts-tips', 'Tiny TypeScript tips', 50)],
      }),
    });
    const out = await new GitHubAdapter(deps(http), 'ghp_test_token_1234567890').fetch(ctx);
    expect(out.map((r) => r.externalId)).toEqual(['1', '3']);
    expect(out[0].tags).toEqual(['cli']);
    expect(decodeURIComponent(http.calls[0].url)).toContain('fork:false');
    expect(http.calls[0].opts.headers?.authorization).toBe('Bearer ghp_test_token_1234567890');
  });

  it('RSS: keeps items inside the window, survives one broken feed, fails only if all feeds fail', async () => {
    const xml = (title: string, date: string) =>
      `<rss version="2.0"><channel><item><title>${title}</title><link>https://nodejs.org/x/${encodeURIComponent(title)}</link><pubDate>${date}</pubDate></item></channel></rss>`;
    const ok = fakeHttp({
      'https://nodejs.org/feed.xml': xml('Node.js 27 alpha', 'Fri, 13 Nov 2026 10:00:00 GMT'),
      'https://old.example/feed': xml('Old news', 'Fri, 01 Nov 2024 10:00:00 GMT'),
      'https://broken.example/feed': new Error('HTTP 500'),
    });
    const adapter = new RssAdapter(deps(ok), ['https://nodejs.org/feed.xml', 'https://old.example/feed', 'https://broken.example/feed']);
    const out = await adapter.fetch(ctx);
    expect(out.map((s) => s.title)).toEqual(['Node.js 27 alpha']);

    const allBroken = new RssAdapter(deps(fakeHttp({ 'https://broken.example/feed': new Error('HTTP 500') })), ['https://broken.example/feed']);
    await expect(allBroken.fetch(ctx)).rejects.toThrow(/broken.example: HTTP 500/);
  });

  it('YouTube: counts results with part=id only, and is unconfigured without a key', async () => {
    const http = fakeHttp({ 'www.googleapis.com': JSON.stringify({ items: [{}, {}, {}] }) });
    const yt = new YouTubeCompetitionClient(deps(http), 'AIzaTestKey_abcdefghijklmnop');
    await expect(yt.countShorts('typescript generics', ctx.windowStart)).resolves.toBe(3);
    expect(http.calls[0].url).toContain('part=id');
    expect(http.calls[0].url).toContain('videoDuration=short');
    expect(new YouTubeCompetitionClient(deps(http)).isConfigured()).toBe(false);
  });
});

describe('scrub', () => {
  it('removes configured secrets and key= query values from error text', () => {
    const msg = 'GET https://www.googleapis.com/youtube/v3/search?q=x&key=AIzaSECRET failed; token ghp_SECRET1234567890abcdef';
    const out = scrub(msg, ['ghp_SECRET1234567890abcdef']);
    expect(out).not.toContain('AIzaSECRET');
    expect(out).not.toContain('ghp_SECRET');
  });
});

describe('report', () => {
  it('neutralizes markdown/HTML from untrusted titles and lists limitations', () => {
    expect(mdText('<script>alert(1)</script> [x](javascript:y) **b**')).not.toMatch(/[<>[\]*]/);
    const signals = [
      { id: 'a', source: 'hackernews' as const, title: '<img src=x onerror=alert(1)> TypeScript tips', url: 'javascript:alert(1)', tags: [], publishedAt: NOW, retrievedAt: NOW, metrics: { points: 10 } },
    ];
    const topics = scoreClusters(clusterSignals(signals), { now: NOW, rules: { keywords: ['typescript'], excludeKeywords: [] } });
    const { markdown, limitations } = buildReport({
      nicheName: 'Coding <b>tips</b>',
      windowStart: ctx.windowStart,
      windowEnd: NOW,
      sourceResults: [
        { source: 'hackernews', status: 'ok', signals: 1, durationMs: 5 },
        { source: 'stackexchange', status: 'failed', signals: 0, durationMs: 5, message: 'HTTP 503' },
        { source: 'youtube', status: 'skipped', signals: 0, durationMs: 0, message: 'YouTube API key not configured' },
      ],
      topics,
      totalSignals: 1,
      relevantSignals: 1,
    });
    expect(markdown).not.toContain('<img');
    expect(markdown).not.toContain('<b>');
    expect(markdown).not.toContain('javascript:');
    expect(limitations.join(' ')).toMatch(/stackexchange.*failed/);
    expect(limitations.join(' ')).toMatch(/competition was not measured/);
    expect(limitations.join(' ')).toMatch(/not predictions of views/);
  });
});
