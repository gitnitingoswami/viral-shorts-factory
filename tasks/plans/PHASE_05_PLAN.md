# Phase 05 Plan: Social Publishing Engine (YouTube first)

**Started:** 2026-11-15 · **Branch:** `phase-05/social-publishing` · **Gate:** auto-accept on passing criteria (user pre-approval), **except** that any real upload and any public publishing always needs explicit user approval.

## Verified platform facts (official docs, 2026-11-15)
- **`videos.insert`:**
  - costs 1 unit from the Video Uploads quota bucket (limit 100 calls/day);
  - accepts `video/*` up to 256 GB;
  - needs scope `youtube.upload` (or broader).
- **Privacy:** `status.privacyStatus` **defaults to `public` when omitted**, so every insert must set it explicitly.
- **Scheduling:** `status.publishAt` (ISO 8601) is allowed only when the video is `private` and has never been published. A past time publishes immediately.
- **Other status fields:**
  - `status.containsSyntheticMedia` (realistic altered/synthetic disclosure) and `selfDeclaredMadeForKids` are settable;
  - `notifySubscribers` defaults to true (we set false for private tests).
- **Snippet limits:**
  - title ≤ 100 characters, description ≤ 5000 bytes, neither may contain `<` or `>`;
  - tags ≤ 500 characters in total (a tag containing spaces counts its quotes).
- **Resumable upload:**
  1. `POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` returns a `Location` session URI.
  2. `PUT` the bytes to that URI: `201` means done; `308` means incomplete and the `Range` header says what was received.
  3. `PUT` with `Content-Range: bytes */TOTAL` asks for the status. After completion it returns the original completion response.
  4. A `404` means the session expired. 5xx responses are resumable with backoff.
- **Remote state:**
  - `status.uploadStatus` is one of uploaded, processed, failed, rejected or deleted;
  - `processingDetails.processingStatus` reports processing progress.
- **OAuth (web server flow):**
  - auth endpoint `accounts.google.com/o/oauth2/v2/auth` with `access_type=offline` and `state`;
  - token endpoint `oauth2.googleapis.com/token`, revocation endpoint `oauth2.googleapis.com/revoke`;
  - the redirect URI must match exactly (localhost is allowed over http);
  - `invalid_grant` means the user must reconnect.

## Scope
1. **OAuth.**
   - Minimal scopes: `youtube.upload` and `youtube.readonly` (needed for channel identity and verifying remote state).
   - A single-use, hashed `state` that expires after 10 minutes and is bound to the owner who started the flow, plus PKCE (S256).
   - A fixed, configured redirect URI (no open redirects).
   - Tokens stored with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, with the account id as associated data); they never appear in DTOs or logs.
   - Refresh with `invalid_grant` → `expired`. Disconnect revokes the token at Google and deletes it locally.
2. **Data:**
   - `oauth_state`;
   - token columns on `connected_account`;
   - `publishing_job`, unique per (video version, account), with `approval_hash`, a private approval and a public approval;
   - `upload_attempt`, where the session URI is stored encrypted **before any bytes are sent**;
   - `published_content`, with `remote_video_id` unique;
   - `approval`;
   - `publishing_log` (merged into `upload_attempt` and the audit log).
3. **Publishing rules:**
   - The video version must have `passed` quality checks for a private or unlisted test upload.
   - Public or scheduled publishing needs a `publishable` version (production voice) **and** an owner's `publish_public` approval.
   - Every approval is bound to the metadata hash, so any edit invalidates it.
4. **Upload worker** (`publish` queue):
   - leased, with a daily upload cap;
   - recomputes the hash and re-checks approvals right before calling the API;
   - resumes an existing session or verifies its state before any retry, so a retry never creates a second video;
   - a `404` on a session that already received all its bytes becomes `needs_attention`, never a blind re-upload;
   - polls `videos.list` to verify the remote result (processing, rejected, failed, privacy).
5. **API and UI:**
   - connect/disconnect the account;
   - metadata form with limits and preview;
   - approval queue and publishing calendar;
   - job status with upload attempts.
6. **Tests:** a fake YouTube and Google OAuth server, injected the same way as the research HTTP layer (no network in CI). Covers OAuth state and CSRF, encryption, approval gating and hash invalidation, resume/verify before retry, duplicate prevention, rejected/failed remote states, the quota cap, and token revocation and expiry.

## Acceptance → evidence
| Criterion | Evidence |
|---|---|
| OAuth is secure; scopes are minimal | Unit and e2e tests: state single-use, expiring and user-bound; PKCE; redirect fixed; tokens encrypted at rest (DB holds ciphertext only); only the two scopes requested; missing scopes rejected |
| Test upload works only after user approval | e2e (fake YouTube): no upload without approval; real channel only after the user explicitly approves a private test upload |
| Remote status verified | e2e: verification job records uploadStatus, processing and privacy; rejected or failed surfaces as failed |
| Duplicate uploads prevented | e2e: crash after a session was created resumes it; crash after completion makes no second insert; duplicate job creation is idempotent; `remote_video_id` unique |
| Public publishing requires approval | e2e: public or scheduled without an owner `publish_public` approval → 409; a metadata edit invalidates approvals |
| Integration tests use mocks in CI | The fake server is injected via a provider token; no network |

## External access needed (user)
| Need | Why |
|---|---|
| Google Cloud OAuth client (Web application) in the same project as the YouTube key, with redirect URI `http://localhost:3100/api/integrations/youtube/callback`; YouTube Data API v3 enabled; consent screen in Testing with the user's Google account added as a test user | Connect @Codehaksy |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` in `.env` (never in chat) | Token exchange |
| Explicit approval of the first private test upload | Policy |
