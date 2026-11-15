import Anthropic from '@anthropic-ai/sdk';
import { toWireSchema } from './json-schema';
import { LlmNonRetryableError, LlmProvider, LlmRequest, LlmResponse, userMessage } from './llm.types';

/**
 * Claude via the official SDK (docs/AI_ARCHITECTURE.md §3):
 * - structured JSON output (`output_config.format`), validated again with zod;
 * - explicit effort per task (Opus 5.5 always thinks; effort is the depth/cost control);
 * - server-side refusal fallbacks (`fallbacks: "default"`), refusals and truncation handled before parsing;
 * - stable system prompt cached; untrusted input only in the user turn.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    /** Injectable for tests; production always builds the official client. */
    client?: Anthropic,
  ) {
    // One SDK retry; the job retry policy handles the rest (each attempt is metered, so retries stay bounded).
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: 180_000 });
  }

  async generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage(req.input) }],
        output_config: { effort: req.effort, format: { type: 'json_schema', schema: toWireSchema(req.schema) } },
      });
    } catch (err) {
      // Retryable classes (429, 5xx, connection) propagate unchanged so the job retry policy handles them.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new LlmNonRetryableError(`LLM authentication failed (${err.status})`, 'auth');
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) {
        throw new LlmNonRetryableError(`LLM rejected the request (${err.status}): ${err.message.slice(0, 200)}`, 'bad_request');
      }
      throw err;
    }

    const usage = {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    if (response.stop_reason === 'refusal') {
      throw Object.assign(new LlmNonRetryableError('The model declined this request', 'refusal'), { usage, model: response.model });
    }
    if (response.stop_reason === 'max_tokens') {
      throw Object.assign(new LlmNonRetryableError('The response was truncated (max_tokens)', 'truncated'), { usage, model: response.model });
    }

    const text = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw Object.assign(new LlmNonRetryableError('The response was not valid JSON', 'malformed'), { usage, model: response.model });
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw Object.assign(new LlmNonRetryableError(`The response did not match the schema: ${issues}`, 'malformed'), { usage, model: response.model });
    }
    return { data: parsed.data, model: response.model, mock: false, usage };
  }
}
