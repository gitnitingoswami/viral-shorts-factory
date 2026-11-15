# Phase 04 Completion Report: AI Video Production

**Date:** 2026-11-15 · **Branch:** `phase-04/video-production` · **PR:** #5 · **Recommendation:** ACCEPT. A production voice (cloud TTS) is pending the user's choice and does not block the phase criteria.

## Summary
An approved script version becomes a vertical Short. The pipeline:
1. synthesizes narration per scene;
2. renders original code and title frames with captions burned into the safe area;
3. composes everything with FFmpeg (H.264/AAC, −14 LUFS);
4. writes a WebVTT sidecar;
5. checks the result automatically.

Every asset carries rights and provenance metadata. Renders run as leased, cancellable, idempotent jobs on a dedicated queue.

## Scope delivered
| Area | Delivered |
|---|---|
| Providers | `TtsProvider` interface with local **eSpeak NG** (draft voice) and a **mock** tone (tests). A cloud TTS plugs into the same interface. Frames come from our own SVG layout rendered to PNG via resvg with bundled JetBrains Mono (SIL OFL 1.1). Storage is the existing S3-compatible service, with streamed upload for video. |
| Rights / provenance | `media_asset` requires source, creator/provider, license (NOT NULL plus CHECK), license URL, usage rights, generation params, provenance and sha256. Fonts are registered as licensed assets; every generated asset is labelled original. Assets are content-addressed and cached by input. |
| Data model | `voice_profile`, `media_asset`, `video_production` (unique per script version + settings + voice), `video_scene`, `production_asset`, `video_version` (unique per production + job), `quality_report` (with `publishable`). Render jobs are rows in `job`. |
| Output settings | 9:16 only (1080×1920 default, or 720×1280), fps 24/25/30/60, H.264, bitrate up to 20 Mbps, duration window (default 20–60 s), captions burned in on/off. Validated by the DTO plus `resolveSettings`; defaults are validated at boot. |
| Audio | Narration is normalized (48 kHz mono, silence trimmed) and padded to scene length. Gentle speech compression, then two-pass loudnorm to −14 LUFS / −1.5 dBTP. |
| Captions | Cues are timed against measured speech, at most 2 lines with exact monospace bounds, and checked against the Shorts safe area. WebVTT is escaped; SRT is available. |
| Jobs | `render` queue: bounded concurrency (`RENDER_CONCURRENCY`), lease and heartbeat, progress by stage, 3 attempts with exponential backoff. Cancellation (queued or running) kills FFmpeg/TTS. Per-step timeouts plus an overall deadline. Reconciliation: stuck productions are failed, unlinked ones re-enqueued, stale temp dirs swept. Ownership is by render attempt, and a re-claimed job that already finished returns its recorded result. |
| Quality report | Dimensions, codec/pixel format, fps, duration window, audio present, A/V sync against the planned timeline, loudness, caption bounds and timing, missing or corrupt assets, full-decode integrity, voice publishability, plus warnings (transitions simplified, code truncated, headline overflow, bitrate). `passed` means technically sound; **`publishable`** means passed AND a production voice (the gate for Phase 05). |
| Costs | TTS characters and render compute-seconds go to the expense ledger. Local providers cost $0 but are still metered. |
| API | Status/capabilities, voices, create (idempotent), list/detail, cancel, retry, asset library. HMAC-signed, expiring media URLs with HTTP Range, streamed with abort-safe `pipeline`; signatures are redacted from logs. |
| UI | Production queue (polling, cancel/retry), start-render form (approved scripts, voice quality warnings, settings), detail page (9:16 preview with captions track and poster, version selector, quality report with icon + text per check, prominent failures and publish gate, scene timeline, asset rights table), asset library (kind filter, on-demand audio preview). **F-12:** confirmation before re-running checks clears overrides. |

## Specialist agents
- **frontend-engineer** (subagent): video UI and the F-12 confirmation, 34 new web tests. I re-verified lint, typecheck, tests, build and the security greps independently.
- **code-reviewer + security-reviewer** (subagent):
  - **Round 1:** CHANGES REQUIRED.
    - Blocking items:
      - H1: a job-ownership race could falsely fail a new render, and a crash window could leave a production stuck in `queued`.
      - M1: a re-claimed job could re-render a finished production and downgrade it.
      - M2: aborted media downloads leaked storage sockets.
      - M3: draft voices passed as "ready" with no publish gate.
    - Also flagged: M4/M5 and L1–L14.
    - All fixed with tests, except L12 (dedupe provenance shows the first producer).
  - **Round 2:** H1, M1, M2 and M3 verified fixed. One blocker remained: L1, the signature still leaked through the parsed query in request logs. Fixed and verified against real pino-http/Express.
- **Lead Orchestrator:** backend, data model, media pipeline, tooling, tests, CI, Docker.

## Acceptance criteria (phase prompt)
| Criterion | Result | Evidence |
|---|---|---|
| At least one complete test video renders and plays | PASS | e2e renders 1080×1920 (mock voice) and 720×1280 (eSpeak); the downloaded file is probed (video + audio streams) and fully decoded without errors. Live sample: 28.7 s, 1080×1920 with eSpeak voice, rendered in 3.7 s. All checks pass (−14.8 LUFS, 2 ms A/V drift, 9 caption cues in bounds), voice flagged as draft. |
| Assets have rights metadata | PASS | DB constraint (an empty license is rejected, tested). e2e asserts license, source, creator and usage rights on every asset of a production, across fonts, narration, frames, thumbnail, captions and video. |
| Retries do not create duplicate production records | PASS | e2e: a duplicate create returns the same production and job. A transient TTS failure is retried with exactly 1 production and 1 version, and the provider is called only for missing narration (call count asserted). A cached voice and text adds no new audio rows. A lease takeover or re-claim yields 1 version. |
| Quality failures are visible | PASS | e2e: the mock voice gives `quality_failed` with "Voice: Mock tone…" in failures; draft voice gives `passed` but `publishable=false`. UI: "Not publishable" box, verdict and per-check status with text (web tests). |
| Tests cover worker failure and recovery | PASS | e2e: dead worker with expired lease is taken over; a crash after commit is not re-rendered; worker started before the job was linked; production with no job is re-enqueued; retries exhausted, then a manual retry succeeds; FFmpeg missing fails non-retryably on attempt 1; cancellation running and queued; job ended without a result leads the reconciler to mark the production failed; approval revoked gives 409. |

## Tests and quality
- **API:** 136 unit + 219 integration tests pass, run against real FFmpeg 9 / eSpeak NG locally and FFmpeg / eSpeak NG on CI Ubuntu. Coverage is 95% of lines.
- **Web:** 177 tests pass (143 existing + 34 new).
- **Static checks and builds:** lint, strict typecheck and builds are clean.
- **Docker:** the image ships ffmpeg, espeak-ng and the fonts; a CI smoke test renders a frame and runs both tools inside it.
- **Security scans:** gitleaks clean. `npm audit` shows the same 3 moderate advisories as before (F-07); none are high or critical.

## Git / CI
PR #5 commits:
- `1fe4a33` backend
- `a619b65` lint fix
- `5b2d2c6` UI
- `d401c45` review round 1
- `f74c614` review round 2 (log redaction)

GitHub CI was 4/4 green on `a619b65`, `5b2d2c6`, `d401c45` and `f74c614`.

## External access used
None new. Local tooling installed with Homebrew: ffmpeg 9.0.2 and espeak-ng 1.52.0. The fonts were downloaded from the JetBrains Mono GitHub release v2.304 (OFL). GitHub was used for the PR and CI.

## Blocked / pending
- **Production voice:** this is the user's choice of cloud TTS provider, a new paid integration. Until then videos use the eSpeak draft voice and are never `publishable`.
- **Live Claude generation (F-14):** still waiting on Anthropic credits.

## Follow-ups
| ID | Item |
|---|---|
| F-16 | Cloud TTS provider with word timestamps, for exact caption timing |
| F-17 | Transitions (fade/slide/zoom) and code typing animation (currently cuts, reported as a warning) |
| F-18 | Asset provenance for deduplicated assets records only the first producer (L12). Add per-use provenance via `production_asset` |
| F-19 | The overall render deadline cannot interrupt in-flight storage/DB awaits. Add SDK/DB timeouts |
| F-20 | Licensed music bed (needs a licensed source) |

Earlier follow-ups F-02, F-03, F-06 to F-11, F-13 and F-15 remain open.

## Recommendation
**ACCEPT.** All five acceptance criteria pass with evidence, the independent review blockers are resolved, and CI is green.
