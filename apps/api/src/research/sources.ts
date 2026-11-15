import { XMLParser } from 'fast-xml-parser';
import type { ResearchSourceKey } from '@vsf/contracts';
import { HttpGet, SafeFetchOptions } from './http';
import type { SignalInput } from './scoring';

/** A signal as produced by a source adapter (ids are assigned when persisted). */
export type FetchedSignal = Omit<SignalInput, 'id'> & { externalId: string };

export interface SourceContext {
  keywords: string[];
  windowStart: Date;
  windowEnd: Date;
  now: Date;
}

export interface ResearchSourceAdapter {
  readonly key: ResearchSourceKey;
  /** False when a required credential is missing; the run records the source as `skipped`. */
  isConfigured(): boolean;
  fetch(ctx: SourceContext): Promise<FetchedSignal[]>;
}

export interface AdapterDeps {
  http: HttpGet;
  timeoutMs: number;
}

const MAX_KEYWORD_QUERIES = 10;
const epoch = (d: Date) => Math.floor(d.getTime() / 1000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function opts(deps: AdapterDeps, hosts: string[], headers?: Record<string, string>): SafeFetchOptions {
  return { allowedHosts: new Set(hosts), timeoutMs: deps.timeoutMs, headers };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function compact(m: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as Record<string, number>;
}

/** Runs per-keyword queries sequentially and de-duplicates by external id. */
async function perKeyword(
  keywords: string[],
  run: (kw: string) => Promise<FetchedSignal[]>,
): Promise<FetchedSignal[]> {
  const byId = new Map<string, FetchedSignal>();
  for (const kw of keywords.slice(0, MAX_KEYWORD_QUERIES)) {
    for (const s of await run(kw)) if (!byId.has(s.externalId)) byId.set(s.externalId, s);
  }
  return [...byId.values()];
}

// ------------------------------------------------------------------ Hacker News (Algolia)

interface HnHit {
  objectID: string;
  title?: string;
  url?: string | null;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
  _tags?: string[];
}

export class HackerNewsAdapter implements ResearchSourceAdapter {
  readonly key = 'hackernews' as const;
  constructor(private readonly deps: AdapterDeps) {}

  isConfigured(): boolean {
    return true;
  }

  fetch(ctx: SourceContext): Promise<FetchedSignal[]> {
    return perKeyword(ctx.keywords, async (kw) => {
      const q = new URLSearchParams({
        query: kw,
        tags: 'story',
        numericFilters: `created_at_i>${epoch(ctx.windowStart)},created_at_i<${epoch(ctx.windowEnd)},points>10`,
        hitsPerPage: '50',
      });
      const body = await this.deps.http(`https://hn.algolia.com/api/v1/search?${q}`, opts(this.deps, ['hn.algolia.com']));
      const hits = (JSON.parse(body) as { hits?: HnHit[] }).hits ?? [];
      return hits
        .filter((h) => h.title)
        .map((h) => ({
          externalId: h.objectID,
          source: this.key,
          title: h.title!,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          // No tags: Algolia also matches URLs and story text (e.g. "git" matches every github.com link), so
          // relevance must come from the title itself, not from the query that found it.
          tags: [],
          publishedAt: h.created_at_i ? new Date(h.created_at_i * 1000) : null,
          retrievedAt: ctx.now,
          metrics: compact({ points: num(h.points), comments: num(h.num_comments) }),
        }));
    });
  }
}

// ------------------------------------------------------------------ Stack Exchange

interface SeQuestion {
  question_id: number;
  title: string;
  link: string;
  tags?: string[];
  score?: number;
  answer_count?: number;
  view_count?: number;
  creation_date?: number;
}

/** Decodes the few HTML entities Stack Exchange uses in titles (output is treated as text, never HTML). */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export class StackExchangeAdapter implements ResearchSourceAdapter {
  readonly key = 'stackexchange' as const;
  constructor(private readonly deps: AdapterDeps) {}

  isConfigured(): boolean {
    return true;
  }

  fetch(ctx: SourceContext): Promise<FetchedSignal[]> {
    return perKeyword(ctx.keywords, async (kw) => {
      const q = new URLSearchParams({
        order: 'desc',
        sort: 'votes',
        site: 'stackoverflow',
        tagged: kw.trim().replace(/\s+/g, '-'),
        fromdate: String(epoch(ctx.windowStart)),
        todate: String(epoch(ctx.windowEnd)),
        pagesize: '30',
      });
      const body = await this.deps.http(`https://api.stackexchange.com/2.3/questions?${q}`, opts(this.deps, ['api.stackexchange.com']));
      const items = (JSON.parse(body) as { items?: SeQuestion[] }).items ?? [];
      return items.map((it) => ({
        externalId: String(it.question_id),
        source: this.key,
        title: decodeEntities(it.title),
        url: it.link,
        tags: it.tags ?? [],
        publishedAt: it.creation_date ? new Date(it.creation_date * 1000) : null,
        retrievedAt: ctx.now,
        metrics: compact({ score: num(it.score), answers: num(it.answer_count), views: num(it.view_count) }),
      }));
    });
  }
}

// ------------------------------------------------------------------ GitHub search

interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  created_at?: string;
  topics?: string[];
  language?: string | null;
}

export class GitHubAdapter implements ResearchSourceAdapter {
  readonly key = 'github' as const;
  constructor(
    private readonly deps: AdapterDeps,
    private readonly token?: string,
  ) {}

  isConfigured(): boolean {
    return true; // works unauthenticated (lower rate limit); the token is optional
  }

  async fetch(ctx: SourceContext): Promise<FetchedSignal[]> {
    // Unauthenticated search allows ~10 requests/minute: batch keywords (GitHub allows up to 5 OR operators).
    const groups: string[][] = [];
    const kws = ctx.keywords.slice(0, MAX_KEYWORD_QUERIES);
    for (let i = 0; i < kws.length; i += 5) groups.push(kws.slice(i, i + 5));
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const byId = new Map<string, FetchedSignal>();
    const byDescription = new Map<string, string>();
    for (const group of groups) {
      const terms = group.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' OR ');
      // fork:false drops forks; star-farmed clones are de-duplicated by description below.
      const q = `${terms} in:name,description,topics created:>=${isoDate(ctx.windowStart)} stars:>20 fork:false`;
      const params = new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: '50' });
      const body = await this.deps.http(`https://api.github.com/search/repositories?${params}`, opts(this.deps, ['api.github.com'], headers));
      for (const r of (JSON.parse(body) as { items?: GhRepo[] }).items ?? []) {
        const id = String(r.id);
        if (byId.has(id)) continue;
        // Mass-produced clones share a description; keep only the most-starred (results are sorted by stars).
        const descKey = (r.description ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (descKey.length > 20) {
          if (byDescription.has(descKey)) continue;
          byDescription.set(descKey, id);
        }
        byId.set(id, {
          externalId: id,
          source: this.key,
          title: [r.full_name.split('/')[1]?.replace(/[-_]/g, ' '), r.description].filter(Boolean).join(': ').slice(0, 300),
          url: r.html_url,
          // Repository language is deliberately not a tag: "written in TypeScript" is not topical relevance.
          tags: r.topics ?? [],
          publishedAt: r.created_at ? new Date(r.created_at) : null,
          retrievedAt: ctx.now,
          metrics: compact({ stars: num(r.stargazers_count), forks: num(r.forks_count) }),
        });
      }
    }
    return [...byId.values()];
  }
}

// ------------------------------------------------------------------ RSS / Atom (allowlisted official feeds)

type XmlNode = Record<string, unknown>;

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) return text((v as XmlNode)['#text']);
  return '';
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export function parseFeed(xml: string): Array<{ id: string; title: string; link: string; published: Date | null; categories: string[] }> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: true, htmlEntities: true });
  const doc = parser.parse(xml) as XmlNode;
  const rss = (doc.rss as XmlNode | undefined)?.channel as XmlNode | undefined;
  if (rss) {
    return asArray(rss.item as XmlNode[] | XmlNode | undefined).map((it) => {
      const link = text(it.link);
      const date = text(it.pubDate);
      return {
        id: text(it.guid) || link,
        title: text(it.title).trim(),
        link,
        published: date ? new Date(date) : null,
        categories: asArray(it.category).map(text).filter(Boolean),
      };
    });
  }
  const feed = doc.feed as XmlNode | undefined;
  if (feed) {
    return asArray(feed.entry as XmlNode[] | XmlNode | undefined).map((e) => {
      const links = asArray(e.link as XmlNode[] | XmlNode | undefined);
      const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
      const link = alt ? text(alt['@href']) : '';
      const date = text(e.published) || text(e.updated);
      return {
        id: text(e.id) || link,
        title: text(e.title).trim(),
        link,
        published: date ? new Date(date) : null,
        categories: asArray(e.category as XmlNode[] | XmlNode | undefined).map((c) => text(c['@term'])).filter(Boolean),
      };
    });
  }
  throw new Error('Unrecognized feed format');
}

export class RssAdapter implements ResearchSourceAdapter {
  readonly key = 'rss' as const;
  private readonly hosts: string[];

  constructor(
    private readonly deps: AdapterDeps,
    private readonly feeds: string[],
  ) {
    this.hosts = [...new Set(feeds.map((f) => new URL(f).hostname))];
  }

  isConfigured(): boolean {
    return this.feeds.length > 0;
  }

  async fetch(ctx: SourceContext): Promise<FetchedSignal[]> {
    const out: FetchedSignal[] = [];
    const errors: string[] = [];
    for (const feed of this.feeds) {
      try {
        const xml = await this.deps.http(feed, opts(this.deps, this.hosts));
        for (const item of parseFeed(xml)) {
          if (!item.title || !/^https?:\/\//.test(item.link)) continue;
          if (item.published && (item.published < ctx.windowStart || item.published > ctx.windowEnd)) continue;
          out.push({
            externalId: `${new URL(feed).hostname}:${item.id}`.slice(0, 500),
            source: this.key,
            title: item.title,
            url: item.link,
            tags: item.categories.map((c) => c.toLowerCase()),
            publishedAt: item.published,
            retrievedAt: ctx.now,
            metrics: {},
          });
        }
      } catch (err) {
        errors.push(`${new URL(feed).hostname}: ${err instanceof Error ? err.message : 'error'}`);
      }
    }
    // One broken feed must not hide the others; only fail when every feed failed.
    if (errors.length === this.feeds.length && this.feeds.length > 0) throw new Error(errors.join('; '));
    return out;
  }
}

// ------------------------------------------------------------------ YouTube competition (enrichment, not discovery)

export class YouTubeCompetitionClient {
  constructor(
    private readonly deps: AdapterDeps,
    private readonly apiKey?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Counts short videos published in the window that match the query (search.list, part=id: no titles or
   * channel data are retrieved or stored). Costs one call from the search.list quota bucket.
   */
  async countShorts(query: string, windowStart: Date): Promise<number> {
    if (!this.apiKey) throw new Error('YouTube API key not configured');
    const params = new URLSearchParams({
      part: 'id',
      type: 'video',
      videoDuration: 'short',
      q: query,
      publishedAfter: windowStart.toISOString(),
      maxResults: '50',
      key: this.apiKey,
    });
    const body = await this.deps.http(`https://www.googleapis.com/youtube/v3/search?${params}`, opts(this.deps, ['www.googleapis.com']));
    return asArray((JSON.parse(body) as { items?: unknown[] }).items).length;
  }
}
