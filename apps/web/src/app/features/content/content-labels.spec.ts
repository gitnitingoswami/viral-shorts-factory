import { durationWarning, checksActive, isSimilar, lineCount, parseHighlightLines } from './content-labels';

describe('content labels', () => {
  it('flags similarity at or above 0.6', () => {
    expect(isSimilar({ similarityScore: 0.59 })).toBe(false);
    expect(isSimilar({ similarityScore: 0.6 })).toBe(true);
  });

  it('warns outside the 20–60 s window', () => {
    expect(durationWarning(19)).toContain('below');
    expect(durationWarning(20)).toBeNull();
    expect(durationWarning(60)).toBeNull();
    expect(durationWarning(61)).toContain('exceeds');
  });

  it('parses highlight lines', () => {
    expect(parseHighlightLines('')).toEqual([]);
    expect(parseHighlightLines(' 3, 1,3 ')).toEqual([1, 3]);
    expect(parseHighlightLines('1-3')).toBeNull();
    expect(parseHighlightLines('0')).toBeNull();
    expect(parseHighlightLines('a,2')).toBeNull();
  });

  it('counts lines ignoring one trailing newline', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('a\nb\n')).toBe(2);
  });

  it('detects active checks', () => {
    expect(checksActive({ factCheck: 'done', quality: 'failed', code: 'done' })).toBe(false);
    expect(checksActive({ factCheck: 'done', quality: 'running', code: 'done' })).toBe(true);
    expect(checksActive({ factCheck: 'pending', quality: 'done', code: 'done' })).toBe(true);
  });
});
