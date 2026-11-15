import { LlmNonRetryableError, LlmProvider, LlmRequest, LlmResponse } from './llm.types';

/**
 * Deterministic stand-in for the LLM (tests, CI, and local runs without ANTHROPIC_API_KEY). Every output is
 * labelled `mock: true` and carries model "mock". Test markers in the input text trigger failure paths:
 * "[mock:malformed]", "[mock:refusal]", "[mock:truncated]".
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';

  generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const text = JSON.stringify(req.input);
    if (text.includes('[mock:refusal]')) return Promise.reject(new LlmNonRetryableError('The model declined this request', 'refusal'));
    if (text.includes('[mock:truncated]')) return Promise.reject(new LlmNonRetryableError('The response was truncated (max_tokens)', 'truncated'));
    const raw = text.includes('[mock:malformed]') ? { unexpected: true } : this.build(req.task, req.input as Record<string, unknown>);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      return Promise.reject(new LlmNonRetryableError('The response did not match the schema (mock)', 'malformed'));
    }
    return Promise.resolve({ data: parsed.data, model: this.model, mock: true, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  }

  private build(task: LlmRequest<unknown>['task'], input: Record<string, unknown>): unknown {
    switch (task) {
      case 'ideas':
        return this.ideas(input);
      case 'script':
        return this.script(input);
      case 'factcheck':
        return this.factcheck(input);
      case 'quality':
        return { scores: { originality: 4, repetition: 4, clarity: 4, pacing: 4, accessibility: 4, platform: 4, policyRisk: 5 }, issues: [] };
    }
  }

  private ideas(input: Record<string, unknown>) {
    const topic = String((input.topic as { title?: string } | undefined)?.title ?? 'the topic');
    const sources = (input.sources as Array<{ url: string }> | undefined) ?? [];
    const formats = ['quick-tip', 'myth-vs-fact', 'comparison', 'quick-fix', 'explainer'] as const;
    const angles = ['the one setting most people miss', 'a common misconception', 'old way vs new way', 'fixing the error in 30 seconds', 'how it works under the hood'];
    return {
      ideas: formats.map((format, i) => ({
        title: `${topic.slice(0, 60)}: ${angles[i]}`.slice(0, 90),
        audience: 'Working web developers',
        angle: angles[i],
        hook: `Stop scrolling: ${angles[i]} in ${topic.slice(0, 50)}`.slice(0, 140),
        valueProposition: `Learn ${angles[i]} quickly`,
        format,
        targetDurationSec: 30 + i * 5,
        sourceUrls: sources.slice(0, 2).map((s) => s.url),
      })),
    };
  }

  private script(input: Record<string, unknown>) {
    const idea = (input.idea as { title?: string; hook?: string } | undefined) ?? {};
    const topic = String((input.topic as { title?: string } | undefined)?.title ?? 'the topic');
    return {
      title: String(idea.title ?? topic).slice(0, 100).padEnd(5, '.'),
      scenes: [
        { durationSec: 5, narration: String(idea.hook ?? `Here is a quick tip about ${topic}.`).slice(0, 400), onScreenText: 'Quick tip', visualConcept: 'Title card with the hook', code: null, transition: 'cut', assetBrief: 'Bold title card, brand colors' },
        { durationSec: 10, narration: `${topic} is in the news this week. Here is what it means for your code.`, onScreenText: 'Why it matters', visualConcept: 'Code frame with highlighted lines', code: null, transition: 'slide', assetBrief: 'Dark code frame' },
        {
          durationSec: 12,
          narration: 'Run this snippet and look at the output: it shows the behavior in two lines.',
          onScreenText: 'Try it',
          visualConcept: 'Typing animation in a code frame',
          code: { language: 'typescript', source: "const items: number[] = [3, 1, 2];\nconsole.log([...items].sort((a, b) => a - b));", highlightLines: [2] },
          transition: 'fade',
          assetBrief: 'Syntax-highlighted TypeScript frame',
        },
        { durationSec: 6, narration: 'Save this for later and follow for more quick tips.', onScreenText: 'Save it', visualConcept: 'Recap card', code: null, transition: 'zoom', assetBrief: 'Recap card with the key line' },
      ],
    };
  }

  /** Marks a claim supported only when the topic title appears verbatim in a source title (quoted as evidence). */
  private factcheck(input: Record<string, unknown>) {
    const scenes = (input.scenes as Array<{ narration: string }> | undefined) ?? [];
    const sources = (input.sources as Array<{ url: string; text: string }> | undefined) ?? [];
    const topic = String((input.topic as { title?: string } | undefined)?.title ?? '');
    const claims = scenes.flatMap((s, i) => {
      if (!/is in the news|released|faster|\d+x/i.test(s.narration)) return [];
      // Supported only when the claim itself contains the quoted evidence (the topic title) and a source states it.
      const src = topic && s.narration.includes(topic) ? sources.find((x) => x.text.includes(topic)) : undefined;
      return [
        src
          ? { sceneIndex: i, text: s.narration.slice(0, 300), verdict: 'supported' as const, evidence: topic, sourceUrl: src.url }
          : { sceneIndex: i, text: s.narration.slice(0, 300), verdict: 'unsupported' as const, evidence: null, sourceUrl: null },
      ];
    });
    return { claims };
  }
}
