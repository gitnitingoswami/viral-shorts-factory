import type { LlmUsage } from './llm.types';

/**
 * USD per million tokens. Versioned config, never hard-coded in logic (docs/AI_ARCHITECTURE.md §8).
 * Source: Anthropic model table as of 2026-11-03; re-verify against the pricing page before changing.
 */
export const PRICING_VERSION = '2026-11-03';
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Unknown models are priced at the most expensive known rate so the budget guard errs on the safe side. */
function priceFor(model: string) {
  const known = Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1];
  return known ?? PRICES['claude-opus-5-5'];
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
