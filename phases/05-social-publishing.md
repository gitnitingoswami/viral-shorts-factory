# Phase 05 — Social Publishing Engine

Implement YouTube first. Design adapters for other platforms only after verifying official API access and terms.

## Requirements
- Google OAuth authorization flow with secure state, redirect validation, encrypted token storage, refresh/revocation handling, and account disconnect.
- Verify current YouTube Data API documentation for upload, metadata, scheduling, quotas, and limitations. Never assume a capability.
- Publishing calendar and job queue.
- Preview metadata and visibility before upload.
- Private/unlisted test workflow first.
- Explicit approval before public upload or scheduling by default.
- Idempotency and remote-state verification before retry to prevent duplicates.
- Audit events and upload logs.
- Angular connected account, publishing calendar, approval queue, and job status UI.

## Suggested entities
ConnectedSocialAccount, PublishingSchedule, PublishingJob, PublishedContent, UploadAttempt, PublishingLog.

## Acceptance
OAuth is secure; scopes are minimal; test upload works only after user approval; remote status is verified; duplicate uploads are prevented; public publishing requires approval; integration tests use mocks in CI.
