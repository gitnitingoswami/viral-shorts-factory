# Phase 03 Plan: AI Content Strategy and Scripts

**Started:** 2026-11-15 · **Branch:** `phase-03/content-scripts` · **Gate:** auto-accept on passing criteria (user pre-approval)

## Scope (`phases/03-content-strategy-scripts.md`, `docs/AI_ARCHITECTURE.md` §2–§4, §6–§9)
1. **LLM provider layer:** `LlmProvider` interface; `ClaudeProvider` (official `@anthropic-ai/sdk`, model `claude-opus-5-5`,
   explicit effort per task, server-side refusal fallbacks `fallbacks: "default"`, structured JSON-schema output validated
   with zod, typed error handling, refusal/max_tokens handling, token + cost metering into the expense ledger, budget guard
   before every call); `MockLlmProvider` (deterministic, used in tests and when no API key is configured, labelled "mock").
2. **Prompts:** versioned prompt files (`promptId@version` stored on every output); sources passed as quoted, untrusted data.
3. **Data model:** content_strategy, content_idea, video_script, script_version (immutable), storyboard_scene, script_claim,
   code_verification, script_review (+ review history).
4. **Pipelines (BullMQ `content` queue, leased jobs):** ideas (5 per approved topic, distinct angles, duplicate detection vs.
   history), script + storyboard (20–60 s word budget, ≤12 code lines/scene), fact-check (claims vs. supplied evidence:
   supported/unsupported/contradicted with quoted evidence), quality review (originality, repetition, clarity, pacing,
   accessibility, platform suitability, rights/policy risk; advisory), code verification (sandboxed, no network).
5. **Approval rules:** script approval requires fact-check done and no unsupported/contradicted claims unless overridden with a
   reason; code verification passed or overridden; approvals bound to the version hash; human edits create new versions.
6. **API + Angular:** ideas list, script editor (creates versions), storyboard view, claims/fact-check panel, review + approval UI.
7. **Tests:** prompt/provider failures, refusals, truncation, malformed outputs (schema violations), duplicate ideas, version
   immutability, approval gates, budget guard, sandbox escape attempts.

## External access
| Need | Status | Effect if missing |
|---|---|---|
| `ANTHROPIC_API_KEY` (with a monthly spend limit set in the Anthropic console) | **Not configured** | Mock provider; live generation criteria marked BLOCKED until provided |
| Docker (code sandbox) | Available locally | Without Docker, verification = `unavailable` (approval requires an override reason) |
