import type { LlmUsage } from './llm.types';

/**
 * USD per million tokens. Versioned config, never hard-coded in logic (docs/AI_ARCHITECTURE.md §8).
 * Source: Anthropic model table as of 2026-11-03; re-verify against the pricing page before changing.
 */
export const PRICING_VERSION = '2026-11-03';
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  // Server-side refusal fallbacks may serve a response from another model; price it at that model's rate.
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Exact id first, then the longest matching prefix; unknown models get the highest known rate (errs safe). */
function priceFor(model: string) {
  if (PRICES[model]) return PRICES[model];
  const prefix = Object.keys(PRICES)
    .filter((id) => model.startsWith(id))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return PRICES[prefix];
  return Object.values(PRICES).reduce((max, p) => (p.output > max.output ? p : max));
}

/** Cost in US cents (minor units), rounded up. */
export function costMinor(model: string, u: LlmUsage): number {
  const p = priceFor(model);
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
  return Math.ceil(usd * 100);
}

/** Upper-bound estimate before a call: ~4 chars/token for input, full max_tokens for output (thinking included). */
export function estimateMinor(model: string, inputChars: number, maxTokens: number): number {
  return costMinor(model, { inputTokens: Math.ceil(inputChars / 4), outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
}
