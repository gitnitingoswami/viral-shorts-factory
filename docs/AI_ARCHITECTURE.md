# AI Architecture

**Version:** 0.1 (Phase 00) · **Date:** 2026-11-14 · **Owner:** backend-engineer

## 1. Principles
1. **AI drafts, humans decide.** Every AI output is a draft with a review state; nothing AI-generated is published without an approval record.
2. **Grounded, not invented.** Factual claims must cite supplied sources; trend metrics come only from source APIs, never from the model.
3. **Verify code by running it.** On-screen code is executed or type-checked in a sandbox before approval.
4. **Structured outputs everywhere.** LLM responses are schema-validated JSON; malformed output is a handled error, not a crash.
5. **Provider-agnostic, cost-metered.** All calls go through interfaces that log tokens, cost, latency, and model.

## 2. Provider interfaces (`libs/providers`)
```ts
interface LlmProvider {
  generate<T>(req: {
    task: LlmTask;                   // 'idea' | 'script' | 'storyboard' | 'factcheck' | 'review' | 'insight' | 'classify'
    promptId: string; promptVersion: string;
    system: string; input: unknown;
    schema: JsonSchema;              // structured output contract
    effort?: 'low' | 'medium' | 'high';
    maxOutputTokens: number;
    idempotencyKey: string;
  }): Promise<LlmResult<T>>;         // { data, usage:{inTok,outTok,cacheRead}, costUsd, model, latencyMs, raw ref }
}
interface TtsProvider   { synthesize(req: { text|ssml, voiceId, format }): Promise<{ audioRef, durationMs, wordTimings?, chars, costUsd }>; }
interface ImageProvider { generate(req): Promise<{ assetRef, license, params, costUsd }>; }   // optional
interface ResearchSource{ fetch(niche, window): Promise<RawSignal[]>; describe(): SourceInfo; }
interface SocialPublisher { upload(req): Promise<UploadResult>; getStatus(remoteId): Promise<RemoteStatus>; findByMarker(marker): Promise<RemoteVideo|null>; }
interface ObjectStorage { put/get/signedUrl/delete }
```
Each interface has a **mock implementation** used in unit tests, CI, and local demo mode (`PROVIDERS_MODE=mock`).

## 3. LLM provider: Claude
- **Default model:** `claude-opus-5-5` for all tasks (per the project default). The operator can switch per task in config to `claude-sonnet-5-5` or `claude-haiku-5-5` for cost; changes are recorded in the audit log.
- **SDK:** official `@anthropic-ai/sdk` (TypeScript). No OpenAI-compatible shims.
- **Thinking/effort:** Opus 5.5 always uses adaptive thinking (it cannot be disabled). Set `output_config.effort` explicitly: `low` for classification/dedup, `medium` for ideas/storyboards, `high` for scripts and fact-check.
- **Structured outputs:** `output_config.format` with a JSON schema per task. Forced `tool_choice` is unsupported on Opus 5.5, so do not use tool-forcing for JSON.
- **Refusals:** check `stop_reason` (`refusal`, `max_tokens`) before parsing. Enable the server-side fallback beta (`fallbacks: "default"`) so refusals route automatically; log and surface remaining refusals as `needs_human`.
- **Streaming** for requests with large `max_tokens` (scripts, reports), using `finalMessage()`.
- **Prompt caching:** stable system prompts + niche style guide + few-shot examples first, with a cache breakpoint; volatile input after it.
- **Batch API** (50% cheaper, async) for the weekly research summarization and idea generation, where latency doesn't matter.
- **Error handling:** typed SDK errors. Retry 429/5xx/connection errors via the job retry policy; fail fast on 400/401/404.

## 4. AI tasks and pipelines
| Task | Input | Output (schema) | Guardrails |
|---|---|---|---|
| **Topic synthesis** (Phase 02, optional) | Normalized raw signals with provenance | Clustered topics with `sourceSignalIds[]`, a short rationale | Deterministic clustering (normalized title + `pg_trgm` similarity) is the default and works without an API key; the LLM only refines labels/rationales when a key is configured, under the budget guard. Model **never** outputs metric numbers; scores are computed in code (§5) |
| **Idea generation** (03) | Approved topic + sources + past ideas summary + channel style guide | 5 ideas: audience, angle, hook, value prop, format, duration, `sourceRefs[]` | Dedup vs. history; diversity check (different angles) |
| **Script + storyboard** (03) | Chosen idea + sources | Scenes: narration, on-screen code, highlight lines, caption, duration, transition, asset brief; `claims[]` each with `sourceRef` or `null` | 20–60 s word budget (~2.5 words/s); code ≤ 12 lines/scene |
| **Code verification** (03) | Code blocks + language + expected output | Pass/fail, stdout, errors | Sandbox: no network, 10 s timeout, 256 MB, read-only FS |
| **Fact-check** (03) | Claims + source texts | Per claim: `supported` / `unsupported` / `contradicted` + quoted evidence span | Unsupported claims block approval unless overridden with a reason |
| **Script review** (03) | Script | Scores (originality, clarity, pacing, accessibility, policy risk) + issues | Advisory only; the human decides |
| **Metadata** (05) | Approved script | Title (≤ 100 chars), description, tags, hashtags | No clickbait claims beyond the script content; disclosure footer |
| **Performance insights** (06) | Metric snapshots (with IDs) | Insights each citing `metricSnapshotIds[]`, confidence, "correlation, not causation" caveat | Numbers are copied from inputs, and a code check validates them against the DB |

## 5. Trend scoring (deterministic, explainable — Phase 02)
`score = Σ wᵢ · normᵢ` over the available components, renormalized over available weights.
| Component | Signal examples | Default weight |
|---|---|---|
| Freshness | Age of first signal (exponential decay, 7-day half-life) | 0.20 |
| Growth | Points/stars/questions velocity vs. trailing 4 weeks | 0.25 |
| Relevance | Keyword/tag match to the niche definition (embeddings optional later) | 0.25 |
| Competition (inverse) | Count/recency of YouTube Shorts on the topic (`search.list`) | 0.15 |
| Demand | Stack Overflow question volume, HN comments | 0.10 |
| Repeatability | Evergreen-ness (topic recurs across weeks) | 0.05 |
Normalization: min-max within a weekly collection with winsorization at p5/p95. **Missing data:** the component is excluded and the weights renormalized; the score carries `confidence = Σ available weights` and lists the missing components. Signals older than 14 days are flagged as stale.

### 5a. As implemented in Phase 02 (`apps/api/src/research/scoring.ts`)
- **Relevance filter:** a signal is kept only if a niche keyword appears in its *title or real source tags* (Stack Overflow tags, GitHub topics, feed categories). The query that found it, and a GitHub repo's language, never count: Algolia matches URLs and body text, and "written in TypeScript" is not topical. Exclude keywords drop a signal.
- **Clustering:** deterministic greedy single pass in TypeScript, joining when token Jaccard ≥ 0.5 or the normalized URL is the same. This replaces the `pg_trgm` idea: same effect, unit-testable, no extension needed.
- **Per-source normalization:** growth and demand are normalized within each source (HN points/day, GitHub stars/day, SO votes/day; HN comments, SO views), so different scales never compete directly.
- **Evidence shrinkage:** `score = weighted × (0.5 + 0.5 × confidence)`. Renormalizing over available components alone let data-poor topics (e.g. a release note with only freshness + relevance) outrank well-evidenced ones (found in the first live run, 2026-11-15).
- **YouTube competition:** checked only for the 15 strongest candidates per run (one `search.list`, `part=id`, capped at `YOUTUBE_DAILY_SEARCH_CAP` calls per UTC day), so quota use is bounded and no titles or channel data are retrieved. The value is YouTube's `totalResults` *estimate* of short videos (<4 min, `videoDuration=short`; not specifically Shorts), labelled as such. After 30 days the metric rows are deleted and the topic's competition value and explanation are redacted (score recomputed); weekly reports never contain YouTube numbers.
- **Source hygiene (GitHub):** `fork:false`, plus de-duplication of repos sharing a description, removes star-farmed clone clusters.

## 6. Prompt management
- Prompts are versioned files in `libs/providers/prompts/{task}/{version}.md` with a front-matter schema reference; `promptId@version` is stored on every output.
- Golden-set evaluations (Phase 03): ~20 fixed topics with expected properties (length, claims cited, code runs). Run in CI against **recorded** fixtures; live evaluation is run manually with an explicit cost estimate.
- Prompt-injection defense: source texts are wrapped as quoted data; the system prompt states that source content is untrusted and contains no instructions. Outputs are schema-validated, and URLs in outputs must match the input source URLs.

## 7. Originality and policy controls
- Similarity check of each new idea/script against all past ones using Postgres `pg_trgm` text similarity (no embedding provider or cost in MVP; pgvector + an embedding provider can be added later if needed). Similar items are flagged, not auto-rejected.
- Template diversity: rotate between several visual layouts and hook styles to avoid "mass-produced template" signals.
- **Human creative input is required** at script approval (edit or explicit "approve as is" with a note), recorded as evidence of creative direction.
- No impersonation: TTS voices are stock voices; the voice never claims to be a human expert.
- Disclosure: `containsSyntheticMedia=true` when an AI voice or AI imagery is used (see `INTEGRATIONS.md` §6), plus a one-line description footer "Narration generated with AI text-to-speech."

## 8. Cost metering
Every provider call writes an `expense_record` (provider, model, units, unit price version, cost USD, related entity, job ID). Before a billable job starts, the **budget guard** estimates its cost (from token estimates and history) and refuses if the month-to-date total plus the estimate exceeds the budget. Pricing tables live in versioned config, never hard-coded in logic.

## 9. Testing AI components
- Unit: schema validation, malformed JSON, `max_tokens` truncation, refusal, empty results, duplicate ideas.
- Contract: recorded real responses (sanitized) replayed through adapters.
- Sandbox: tests for timeout, network blocked, memory limit, and malicious code (fork bomb, file write outside `/tmp`).
- No live provider calls in CI.
