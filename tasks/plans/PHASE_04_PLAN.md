# Phase 04 Plan: AI Video Production

**Started:** 2026-11-15 · **Branch:** `phase-04/video-production` · **Gate:** auto-accept on passing criteria (user pre-approval)

## Scope (`phases/04-video-production.md`, `docs/DATABASE_DESIGN.md` §5, `docs/SYSTEM_ARCHITECTURE.md`)
Approved script version → narration (TTS) → audio processing → frames (code + captions) → FFmpeg composition →
captions sidecar → render → quality checks → preview.

1. **Provider interfaces.** `TtsProvider` with:
   - `espeak` (eSpeak NG, local, free, labelled *draft voice*);
   - `mock` (deterministic tone, used in tests, always fails the publishability check).

   A cloud TTS provider plugs into the same interface once the user picks one (new integration, so it needs user approval).
   Visuals come from `FrameRenderer` (original SVG → PNG frames via resvg). Storage is the existing S3-compatible `StorageService`.
   Image/video generation providers are out of scope until a licensed provider is approved: every visual is generated
   in-house (code frames, title cards, captions).
2. **Rights and provenance.** Every asset is a `media_asset` row with:
   - source, creator/provider, license (NOT NULL), license URL, usage rights;
   - generation parameters, provenance and sha256.

   Fonts (JetBrains Mono, SIL OFL 1.1) are registered as assets. Assets are content-addressed, so retries reuse them.
3. **Data model (migration `VideoProduction`):** `voice_profile`, `media_asset`, `video_production`, `video_scene`,
   `production_asset`, `video_version`, `quality_report`.
   - The render job is the existing `job` table, type `video.render`.
   - Generated audio and visuals are `media_asset.kind`.
4. **Render settings.** 9:16 is enforced; the default is 1080×1920 at 30 fps, H.264/AAC, 6 Mbps, with a 20–60 s window.
   Settings are configurable per production and validated.
5. **Jobs.** A dedicated `render` queue with:
   - bounded concurrency (`RENDER_CONCURRENCY`), lease + heartbeat and stage progress;
   - retries with exponential backoff, and cancellation that kills FFmpeg;
   - idempotent creation, unique per (script version, settings, voice), and one `video_version` per job;
   - a timeout (`RENDER_TIMEOUT_MS`).
6. **Quality checks.** Each check is shown with pass/warn/fail plus measured and expected values:
   - dimensions, codec/pixel format, fps;
   - duration window, audio present, A/V sync (≤ 100 ms);
   - caption bounds and timing, missing or corrupt assets, full decode integrity;
   - loudness (target −14 LUFS);
   - publishable voice: draft and mock voices are flagged.
7. **Costs.** TTS units and cost, plus render compute seconds, go to the expense ledger. Local providers cost $0 but are still metered.
8. **API and Angular:**
   - production queue with progress, cancel and retry;
   - preview player through a signed, expiring media URL with Range support;
   - asset library with rights metadata;
   - quality report.
9. **Follow-up F-12:** warn in the UI before re-running checks clears overrides.

## Acceptance (from the phase prompt) → evidence
| Criterion | Evidence |
|---|---|
| At least one complete test video renders and plays | e2e render → ffprobe and full decode pass; live render with eSpeak voice; file opened in a player |
| Assets have rights metadata | DB constraint (license NOT NULL); e2e asserts every production asset has license, source and provider |
| Retries do not create duplicate production records | e2e: duplicate create returns the same production; a transient failure is retried → one production, one version, assets not duplicated |
| Quality failures are visible | e2e: mock voice / too-long settings → `quality_failed` with failures listed; UI shows the report |
| Tests cover worker failure and recovery | e2e: lease takeover after a dead worker; FFmpeg failure → failed with error; cancellation mid-render |

## External access
| Need | Status | Effect if missing |
|---|---|---|
| FFmpeg 9 + eSpeak NG | Installed locally (Homebrew); added to the worker image and CI | Render jobs fail fast with "FFmpeg unavailable" |
| Cloud TTS provider (user choice) | **Not chosen** | Draft eSpeak voice only. Videos are flagged "draft voice" in the quality report |
