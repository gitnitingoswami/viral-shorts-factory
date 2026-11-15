import {
  clusterSignals,
  isRelevant,
  jaccard,
  makeNormalizer,
  matchedKeywords,
  normalizeUrl,
  scoreClusters,
  SignalInput,
  tokenize,
  scoreFromBreakdown,
  SPARSE_FLOOR,
  WEIGHTS,
} from './scoring';

const NOW = new Date('2026-11-15T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const rules = { keywords: ['typescript', 'node.js', 'github actions'], excludeKeywords: ['hiring'] };

let n = 0;
function sig(p: Partial<SignalInput> & Pick<SignalInput, 'source' | 'title'>): SignalInput {
  n++;
  return {
    id: `s${n}`,
    url: `https://example.com/${n}`,
    tags: [],
    publishedAt: daysAgo(1),
    retrievedAt: NOW,
    metrics: {},
    ...p,
  };
}

describe('text helpers', () => {
  it('tokenizes keeping tech punctuation and dropping stopwords', () => {
    expect(tokenize('Show HN: The new Node.js 24 release, with C# and C++!')).toEqual(['node.js', '24', 'release', 'c#', 'c++']);
  });

  it('matches multi-word keywords in titles and tags', () => {
    expect(matchedKeywords({ title: 'Speed up GitHub Actions caches', tags: [] }, rules.keywords)).toEqual(['github actions']);
    expect(matchedKeywords({ title: 'Generics deep dive', tags: ['TypeScript'] }, rules.keywords)).toEqual(['typescript']);
  });

  it('drops excluded and irrelevant signals', () => {
    expect(isRelevant(sig({ source: 'hackernews', title: 'TypeScript 6 is out' }), rules)).toBe(true);
    expect(isRelevant(sig({ source: 'hackernews', title: 'We are hiring TypeScript devs' }), rules)).toBe(false);
    expect(isRelevant(sig({ source: 'hackernews', title: 'Gardening tips' }), rules)).toBe(false);
  });

  it('normalizes URLs (www, trailing slash, utm params, fragments)', () => {
    expect(normalizeUrl('https://www.example.com/a/?utm_source=x&id=2#top')).toBe('example.com/a?id=2');
  });

  it('computes Jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('makeNormalizer', () => {
  it('maps to 0..1 after winsorizing outliers', () => {
    const norm = makeNormalizer([1, 2, 3, 4, 1000]);
    expect(norm(1)).toBeGreaterThanOrEqual(0);
    expect(norm(1000)).toBe(1);
    expect(norm(3)).toBeGreaterThan(0);
    expect(norm(3)).toBeLessThan(0.1); // dominated by the winsorized upper bound, but not flattened to 0
  });

  it('returns 0.5 when there is no spread or no data', () => {
    expect(makeNormalizer([5, 5, 5])(5)).toBe(0.5);
    expect(makeNormalizer([])(7)).toBe(0.5);
  });
});

describe('clusterSignals', () => {
  it('merges near-duplicate titles and identical URLs across sources; keeps distinct topics apart', () => {
    const a = sig({ source: 'hackernews', title: 'TypeScript 6.0 released', metrics: { points: 500 } });
    const b = sig({ source: 'rss', title: 'Announcing TypeScript 6.0 released today' });
    const c = sig({ source: 'github', title: 'unrelated repo name', url: a.url, metrics: { stars: 10 } });
    const d = sig({ source: 'stackexchange', title: 'Node.js streams backpressure explained', metrics: { score: 3 } });
    const clusters = clusterSignals([b, c, d, a]);
    expect(clusters).toHaveLength(2);
    const ts = clusters.find((x) => x.signals.includes(a))!;
    expect(ts.signals.map((s) => s.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(ts.title).toBe('TypeScript 6.0 released'); // named by the most engaged signal
  });

  it('is deterministic regardless of input order and gives unique slugs', () => {
    const s1 = sig({ source: 'hackernews', title: 'Node.js release', metrics: { points: 1 } });
    const s2 = sig({ source: 'hackernews', title: 'Node.js release', url: 'https://other.example/x', metrics: { points: 1 } });
    const s3 = sig({ source: 'github', title: 'TypeScript tips', metrics: { stars: 5 } });
    const x = clusterSignals([s1, s2, s3]).map((c) => c.slug);
    const y = clusterSignals([s3, s2, s1]).map((c) => c.slug);
    expect(x).toEqual(y);
    expect(new Set(x).size).toBe(x.length);
  });
});

describe('scoreClusters', () => {
  const hot = sig({ source: 'hackernews', title: 'TypeScript 6 released', publishedAt: daysAgo(0.5), metrics: { points: 800, comments: 300 } });
  const warm = sig({ source: 'hackernews', title: 'Node.js permission model', publishedAt: daysAgo(3), metrics: { points: 100, comments: 20 } });
  const rssOnly = sig({ source: 'rss', title: 'Node.js 27 alpha notes', publishedAt: daysAgo(20) });

  it('explains every component and renormalizes over available ones', () => {
    const [t] = scoreClusters(clusterSignals([hot, warm, rssOnly]), { now: NOW, rules }).filter((x) => x.signals.includes(hot));
    expect(t.breakdown.map((b) => b.component)).toEqual(['freshness', 'growth', 'relevance', 'competition', 'demand', 'repeatability']);
    expect(t.missingComponents).toEqual(['competition', 'repeatability']);
    expect(t.confidence).toBeCloseTo(WEIGHTS.freshness + WEIGHTS.growth + WEIGHTS.relevance + WEIGHTS.demand, 3);
    const weighted =
      t.breakdown.filter((b) => b.value !== null).reduce((a, b) => a + b.weight * (b.value as number), 0) / t.confidence;
    expect(t.score).toBeCloseTo(weighted * (SPARSE_FLOOR + (1 - SPARSE_FLOOR) * t.confidence), 3);
    for (const b of t.breakdown) expect(b.explanation.length).toBeGreaterThan(10);
  });

  it('ranks a hotter topic above a cooler one', () => {
    const scored = scoreClusters(clusterSignals([hot, warm]), { now: NOW, rules });
    const sHot = scored.find((x) => x.signals.includes(hot))!.score;
    const sWarm = scored.find((x) => x.signals.includes(warm))!.score;
    expect(sHot).toBeGreaterThan(sWarm);
  });

  it('flags stale topics and marks growth/demand missing for metric-less sources', () => {
    const [t] = scoreClusters(clusterSignals([rssOnly]), { now: NOW, rules });
    expect(t.stale).toBe(true);
    expect(t.missingComponents).toEqual(expect.arrayContaining(['growth', 'demand']));
    expect(t.score).toBeGreaterThan(0);
  });

  it('uses competition (inverse) and repeatability when data exists', () => {
    const clusters = clusterSignals([hot, warm]);
    const slugHot = clusters.find((c) => c.signals.includes(hot))!.slug;
    const slugWarm = clusters.find((c) => c.signals.includes(warm))!.slug;
    const scored = scoreClusters(clusters, {
      now: NOW,
      rules,
      youtubeCompetition: new Map([
        [slugHot, 40],
        [slugWarm, 2],
      ]),
      history: { previousCollections: 4, slugCounts: new Map([[slugHot, 2]]) },
    });
    const h = scored.find((x) => x.slug === slugHot)!;
    const w = scored.find((x) => x.slug === slugWarm)!;
    expect(h.missingComponents).toEqual([]);
    expect(h.confidence).toBe(1);
    expect(h.breakdown.find((b) => b.component === 'competition')!.value).toBe(0); // most competition
    expect(w.breakdown.find((b) => b.component === 'competition')!.value).toBe(1); // least competition
    expect(h.breakdown.find((b) => b.component === 'repeatability')!.value).toBe(0.5);
    expect(w.breakdown.find((b) => b.component === 'repeatability')!.value).toBe(0);
  });

  it('does not let a data-poor topic outrank an equally strong, well-evidenced one', () => {
    const rich = sig({ source: 'hackernews', title: 'TypeScript 6 deep dive', publishedAt: daysAgo(0.5), metrics: { points: 800, comments: 300 } });
    const peer = sig({ source: 'hackernews', title: 'Node.js something else', publishedAt: daysAgo(6), metrics: { points: 1, comments: 0 } });
    const sparse = sig({ source: 'rss', title: 'TypeScript 6 notes', publishedAt: daysAgo(0.5) });
    const scored = scoreClusters(clusterSignals([rich, peer, sparse]), { now: NOW, rules });
    const r = scored.find((x) => x.signals.includes(rich))!;
    const s = scored.find((x) => x.signals.includes(sparse))!;
    expect(s.confidence).toBeLessThan(r.confidence);
    expect(r.score).toBeGreaterThan(s.score);
  });

  it('recomputes score and confidence when a component is redacted (YouTube retention)', () => {
    const clusters = clusterSignals([hot]);
    const [t] = scoreClusters(clusters, { now: NOW, rules, youtubeCompetition: new Map([[clusters[0].slug, 3]]) });
    expect(t.missingComponents).not.toContain('competition');
    const redacted = t.breakdown.map((b) => (b.component === 'competition' ? { ...b, value: null } : b));
    const r = scoreFromBreakdown(redacted);
    expect(r.missingComponents).toContain('competition');
    expect(r.confidence).toBeCloseTo(t.confidence - WEIGHTS.competition, 3);
  });

  it('produces scores within 0..1 for empty-metric edge cases', () => {
    const odd = sig({ source: 'stackexchange', title: 'TypeScript enum question', metrics: {} , publishedAt: null });
    const [t] = scoreClusters(clusterSignals([odd]), { now: NOW, rules });
    expect(t.score).toBeGreaterThanOrEqual(0);
    expect(t.score).toBeLessThanOrEqual(1);
  });
});
