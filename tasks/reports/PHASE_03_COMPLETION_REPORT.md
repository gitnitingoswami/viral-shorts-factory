# Phase 03 Completion Report: AI Content Strategy and Scripts

**Date:** 2026-11-15 · **Branch:** `phase-03/content-scripts` · **PR:** #4 · **Recommendation:** ACCEPT · live Claude verification BLOCKED on Anthropic credits (F-14)

## Summary
Approved trend topics become five distinct content ideas. A selected idea becomes an original 20–60 s script
with a scene-by-scene storyboard. Every version is fact-checked against the topic's evidence, reviewed for
quality, and its code is executed in a locked-down sandbox. Approval is a human decision bound to the version's
content hash, possible only when every gate passes (or is overridden with a recorded reason).

## Scope delivered
| Area | Delivered |
|---|---|
| LLM layer | `LlmProvider` interface. `ClaudeProvider` uses the official SDK with `claude-opus-5-5`, structured JSON-schema output (zod-validated), explicit effort per task and server-side refusal fallbacks; refusals, truncation, malformed output and auth/400 errors are non-retryable. Deterministic `MockLlmProvider` (labelled). Budget guard before each call; token cost metered, including failed calls and fallback-model pricing. |
| Prompts | Versioned (`ideas@1`, `script@1`, `factcheck@1`, `quality@1`), stored on every output; untrusted input passed as data only |
| Ideas | 5 per approved topic, distinct formats, sources restricted to evidence URLs, duplicate detection vs earlier ideas (flagged, linked, not rejected), idempotent retries |
| Scripts | Storyboard scenes (narration, on-screen text, visual concept, code, transition, asset brief), word count and duration estimate, immutable versions (DB trigger), human edits with optimistic concurrency |
| Checks | Fact-check: a claim only counts as supported if its quote appears verbatim in the cited source, is at least 20 characters or 4 content words, and shares a word with the claim. AI quality review on 7 dimensions. Code verification in a sandbox: no network, read-only, non-root, no capabilities, resource limits, timeout, `--pull=never`. |
| Gates | Approval blockers are listed and re-evaluated under row locks. Overrides are owner-only, need a reason and are audited. Re-running checks revokes an approval; overlapping runs are refused. |
| UI | Ideas, scripts, workspace (storyboard, claims, code checks, reviews, blockers), editor, decisions, mock-provider banner |

## Specialist agents
- **frontend-engineer** (subagent): content UI with 143 web tests. Re-verified independently (typecheck, lint, tests, build, security greps).
- **code-reviewer + security-reviewer** (subagent).
  - Round 1: RETURN FOR FIXES, with 7 confirmed defects:
    - approval-gate race (T4);
    - ideas-retry FK failure;
    - overlapping check runs;
    - weak evidence guard;
    - no throttle on version creation;
    - fallback pricing;
    - select/discard race.
  - All were fixed with tests.
  - Round 2: three issues remained, all now fixed with tests:
    - a crash mid-run could leave a version stuck (MEDIUM);
    - a worker that had lost its lease could still write (LOW);
    - duplicate detection missed ideas whose job was deleted (LOW).
- **Lead Orchestrator:** backend, data, LLM layer, sandbox, tests, CI.

## Acceptance criteria (phase prompt)
| Criterion | Result | Evidence |
|---|---|---|
| Scripts traceable to inputs | PASS | Idea → topic → evidence signals; source refs limited to supplied URLs; `promptRef` + model on every AI output; content hash per version |
| Unsupported claims flagged | PASS | e2e: "10x faster" claim flagged unsupported; approval 409 lists it; quote-verification guard (unit + e2e) |
| Versions preserved | PASS | Immutability trigger (e2e), human edits create new versions, stale edits 409 |
| Review state explicit | PASS | Script status + per-version check states + human reviews with decision/note/approved hash; blockers listed |
| Tests: prompt failures, malformed outputs, duplicate ideas | PASS | e2e: malformed → failed on attempt 1 with nothing stored; refusal → failed; budget exhausted → failed; duplicates flagged; unit tests for SDK error mapping, truncation, schema violations |

## Git / CI
PR #4: `7ae7436` feature, `ef63a0e` CI timeout fix, `d3da0e8` review fixes, `24e8398` round-2 fixes. GitHub CI 4/4 green on `d3da0e8` and `24e8398`. Review round 3: ACCEPT.

## Tests and quality
- API: 109 unit + 68 integration tests pass. The integration tests use the real Docker sandbox, covering a thrown error, a network attempt, an infinite-loop timeout and a non-executable language.
- Combined coverage: 94% of lines.
- Web: 143 tests pass.
- Lint, strict typecheck and builds are clean. gitleaks finds no leaks.

## External access used
None. No Anthropic key is configured, so all generation used the mock provider and no LLM spend occurred. GitHub was used for the PR and CI.

## Blocked / pending
- **Live Claude generation:** the key was added on 2026-11-15 and is valid; the live run reached the API.
  - Anthropic rejected the call: "Your credit balance is too low to access the Anthropic API."
  - The app handled this correctly: the job failed in 4 s with no retries, the error was recorded on the job, and the key was absent from all logs.
  - **User action:** add credits (with a monthly spend limit) in console.anthropic.com → Plans & Billing. The live ideas → script → checks run is then re-done (F-14).

## Follow-ups
- **F-11:** dedicated sandbox-runner service.
- **F-12:** overrides are cleared on re-run.
- **F-13:** streaming and prompt-cache sizing.
- **F-14:** live Claude smoke test.
- Earlier items F-02, F-03, F-06 to F-10 remain open.

## Recommendation
**ACCEPT**, provided the round-2 review and CI are green. Live LLM verification is tracked separately and does not block the phase criteria.
