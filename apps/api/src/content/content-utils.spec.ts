import type { StoryboardSceneDto } from '@vsf/contracts';
import { approvalBlockers, canonicalJson, closestIdea, evidenceFound, normalizeScenes, scriptMetrics, versionHash } from './content-utils';
import { sandboxArgs } from './sandbox.service';

const scene = (p: Partial<StoryboardSceneDto> = {}): StoryboardSceneDto => ({
  index: 0,
  durationSec: 10,
  narration: 'one two three four five',
  onScreenText: 'x',
  visualConcept: 'card',
  code: null,
  transition: 'cut',
  assetBrief: 'brief',
  ...p,
});

describe('hashing', () => {
  it('is independent of key order and changes with any edit', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const s = [scene()];
    expect(versionHash('T', s)).toBe(versionHash('T', [{ ...s[0] }]));
    expect(versionHash('T', s)).not.toBe(versionHash('T', [scene({ narration: 'changed' })]));
    expect(versionHash('T', s)).not.toBe(versionHash('T2', s));
  });
});

describe('metrics and normalization', () => {
  it('estimates duration as max(scene seconds, words / 2.5)', () => {
    expect(scriptMetrics([scene({ durationSec: 4 }), scene({ durationSec: 4 })])).toEqual({ wordCount: 10, estDurationSec: 8 });
    const wordy = scene({ durationSec: 2, narration: Array(100).fill('w').join(' ') });
    expect(scriptMetrics([wordy]).estDurationSec).toBe(40);
  });

  it('reindexes scenes, trims text and keeps only valid highlight lines', () => {
    const [s] = normalizeScenes([{ ...scene(), narration: '  hi  ', code: { language: 'typescript', source: 'a\nb\n', highlightLines: [2, 2, 9, 0] } }]);
    expect(s).toMatchObject({ index: 0, narration: 'hi', code: { source: 'a\nb', highlightLines: [2] } });
  });
});

describe('approvalBlockers', () => {
  const ok = {
    isCurrent: true,
    estDurationSec: 30,
    scenes: [scene()],
    checks: { factCheck: 'done' as const, quality: 'done' as const, code: 'done' as const },
    claims: [{ verdict: 'supported' as const }, { verdict: 'overridden' as const }],
    codeChecks: [{ sceneIndex: 0, status: 'passed' as const }, { sceneIndex: 1, status: 'not_executable' as const }],
  };

  it('is empty when every gate passes (overrides and non-executable code allowed)', () => {
    expect(approvalBlockers(ok)).toEqual([]);
  });

  it('lists every failing gate', () => {
    const b = approvalBlockers({
      ...ok,
      isCurrent: false,
      estDurationSec: 75,
      checks: { factCheck: 'failed', quality: 'running', code: 'done' },
      claims: [{ verdict: 'unsupported' }, { verdict: 'contradicted' }],
      codeChecks: [{ sceneIndex: 0, status: 'failed' }, { sceneIndex: 1, status: 'unavailable' }],
      scenes: [scene({ code: { language: 'typescript', source: Array(13).fill('x').join('\n'), highlightLines: [] } })],
    });
    expect(b.join('\n')).toMatch(/current version/);
    expect(b.join('\n')).toMatch(/Fact-check is failed/);
    expect(b.join('\n')).toMatch(/Quality review is running/);
    expect(b.join('\n')).toMatch(/2 claim\(s\) unsupported/);
    expect(b.join('\n')).toMatch(/scene 1 is failed/);
    expect(b.join('\n')).toMatch(/scene 2 is unavailable/);
    expect(b.join('\n')).toMatch(/75s is outside 20–60s/);
    expect(b.join('\n')).toMatch(/exceeds 12 lines/);
  });
});

describe('ideas and evidence', () => {
  it('finds the closest earlier idea', () => {
    const r = closestIdea({ title: 'TypeScript satisfies explained', hook: 'satisfies keeps types' }, [
      { id: 'a', title: 'Docker layers', hook: 'cache layers' },
      { id: 'b', title: 'TypeScript satisfies explained fast', hook: 'satisfies keeps types' },
    ]);
    expect(r.id).toBe('b');
    expect(r.score).toBeGreaterThan(0.6);
  });

  it('accepts evidence only if it literally appears in a source', () => {
    expect(evidenceFound('TypeScript 6.1  released', ['Announcing typescript 6.1 released today'])).toBe(true);
    expect(evidenceFound('10x faster builds', ['TypeScript 6.1 released'])).toBe(false);
    expect(evidenceFound(null, ['x'])).toBe(false);
    expect(evidenceFound('ab', ['ab'])).toBe(false);
  });
});

describe('sandboxArgs', () => {
  it('locks the container down', () => {
    const a = sandboxArgs('n', 'img', '/tmp/s.mts').join(' ');
    for (const flag of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 1000:1000', '--pids-limit 64', '--memory 256m', 'noexec']) {
      expect(a).toContain(flag);
    }
    expect(a).not.toMatch(/docker\.sock|--privileged|-v /);
  });
});
