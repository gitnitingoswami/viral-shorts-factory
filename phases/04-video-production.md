# Phase 04 — AI Video Production

Build a reliable media pipeline from approved storyboard to rendered vertical video.

## Pipeline
Storyboard → licensed/user-provided visuals → TTS narration → audio processing → FFmpeg composition → subtitles/captions → render → quality checks → preview.

## Requirements
- Provider interfaces for TTS, image/video generation, and storage.
- Record source, creator/provider, license/usage rights, generation parameters, and provenance for every asset.
- Configurable 9:16 output, default 1080x1920; configurable frame rate, codec, bitrate, and duration.
- Use only user-owned, licensed, or otherwise authorized visuals/music/fonts.
- BullMQ jobs with progress, bounded concurrency, retries/backoff, cancellation, idempotency, and persistent state.
- Validate audio/video sync, dimensions, duration, subtitle bounds, missing assets, and render integrity.
- Track provider and rendering costs.
- Angular production queue, preview, asset library, and quality report.

## Suggested entities
MediaAsset, VoiceProfile, VideoProduction, VideoScene, GeneratedAudio, GeneratedVisual, RenderJob, VideoVersion, QualityReport.

## Acceptance
At least one complete test video renders and plays; assets have rights metadata; retries do not create duplicate production records; quality failures are visible; tests cover worker failure and recovery.
