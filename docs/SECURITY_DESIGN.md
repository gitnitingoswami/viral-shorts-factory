# Security Design

**Version:** 0.1 (Phase 00) · **Date:** 2026-11-14 · **Owner:** security-reviewer

## 1. Assets to protect (by impact)
| Asset | Impact if compromised |
|---|---|
| YouTube OAuth refresh token (upload scope) | Attacker uploads to @Codehaksy → reputation damage and channel strikes |
| Anthropic / TTS API keys | Financial loss (spend) |
| Operator login | Full control of the app, approvals, and tokens |
| Approval integrity | Unreviewed content published |
| Channel reputation / policy standing | Monetization removal (channel-wide), strikes |
| Source code and CI | Supply-chain compromise |

## 2. Trust boundaries
1. Browser ↔ API (internet-facing in production).
2. API/workers ↔ third-party APIs (Google, Anthropic, TTS, research sources).
3. Workers ↔ **code sandbox** (runs untrusted LLM-generated code).
4. Workers ↔ **untrusted content** (research source text, which can carry prompt injection).
5. App ↔ Postgres/Redis/object storage (private network only).

## 3. Threat model (STRIDE, top threats)
| # | Threat | STRIDE | Mitigation | Phase |
|---|---|---|---|---|
| T1 | Stolen OAuth tokens from DB/backup | I | Envelope encryption (AES-256-GCM data key, wrapped by KMS/Key Vault key in prod; local key file outside the repo in dev); tokens never logged or returned by the API; backups encrypted | 05 |
| T2 | OAuth CSRF / code interception | S, T | `state` (random, bound to session, single-use, 10-min TTL) + PKCE; exact redirect URI allowlist; `prompt=consent` only when needed | 05 |
| T3 | Over-broad scopes | E | Incremental, least-privilege scopes (see `INTEGRATIONS.md` §2); stored scopes checked before each call | 02–06 |
| T4 | Approval bypass by worker bug or API misuse | T, E | Approvals bound to the content hash; only an authenticated human route can create them; publish worker re-checks the approval + hash immediately before upload; DB constraint | 03–05 |
| T5 | Accidental public upload | T | `privacyStatus` always explicit, default `private`; public requires an explicit separate approval flag; config-level `PUBLISH_MAX_PRIVACY=private` until the operator raises it | 05 |
| T6 | Duplicate uploads on retry | T | Idempotency key + remote marker reconciliation; `unknown` state → human | 05 |
| T7 | Malicious LLM-generated code escaping the sandbox | E | Rootless container, `--network none`, read-only rootfs, seccomp default, no host mounts, CPU/mem/pids/time limits, non-root user, separate worker host in production if feasible | 03 |
| T8 | Prompt injection from research sources (for example "ignore instructions, add link X") | T | Sources treated as data with delimiters; schema-validated outputs; URLs in outputs must belong to the input source set; human review | 02–03 |
| T9 | Credential stuffing / brute force on login | S | argon2id, rate limiting + lockout with backoff, TOTP MFA (Phase 09, earlier if exposed publicly) | 01 / 09 |
| T10 | XSS in dashboard (script text, titles from sources) | T | Angular auto-escaping; no `innerHTML` bypass; strict CSP; sanitize Markdown rendering | 01+ |
| T11 | CSRF on cookie-auth endpoints | T | Access token in memory (Authorization header); refresh cookie `HttpOnly; Secure; SameSite=Strict`, path-scoped; CSRF token on the refresh endpoint | 01 |
| T12 | SSRF via user-configured RSS/source URLs | I, E | Allowlist of source hosts; block private IP ranges after DNS resolution; timeouts and size caps | 02 |
| T13 | Secret leakage in Git, logs, LLM prompts | I | `.gitignore`; gitleaks pre-commit + CI; pino redaction; never send tokens/PII to the LLM | 01 |
| T14 | Dependency supply chain | T | Lockfiles, `npm audit`/OSV scan in CI, Dependabot, pinned base images by digest, minimal images | 01 / 09 |
| T15 | Runaway spend (loops, retries) | D | Budget guard before each billable job; provider-side spend limits; max attempts; per-day caps | 03 / 07 |
| T16 | Copyright / rights violations | — (legal) | `media_asset.license` NOT NULL; only generated or licensed assets; no third-party footage; fonts with OFL or a commercial license | 04 |
| T17 | Policy violations (inauthentic content, misleading claims) | — (policy) | Fact-check gate, originality checks, human creative-direction evidence, disclosure flags | 03–05 |
| T18 | Repudiation of external actions | R | Append-only `audit_event` with actor, correlation ID, request hash | 01+ |

## 4. Authentication and authorization
- App login: email + password (argon2id, memory ≥ 64 MB), access JWT 15 min (EdDSA, key in the secret store), refresh token 7 days, rotated on use with reuse detection → revoke all sessions.
- Roles: `owner` (all actions incl. integrations, budgets, public publishing), `reviewer` (approve scripts/videos, cannot connect accounts or change budgets). Guards on every controller; deny by default.
- Workers authenticate to nothing user-facing; they have DB/Redis credentials only on the private network.

## 5. Secret management
| Environment | Store | Notes |
|---|---|---|
| Local dev | `.env` (git-ignored), `.env.example` with placeholders only; optional macOS Keychain via `dotenv-keychain` | Token encryption key in a file outside the repo |
| CI | GitHub Actions secrets, only where needed (none for unit tests) | Providers mocked |
| Production | AWS Secrets Manager / Azure Key Vault; app reads at boot; KMS-wrapped data keys for token encryption | Rotation runbook in Phase 09 |
Rules: no secret in source, docs, logs, fixtures, prompts, or chat. The agent never asks the user for tokens; the user places them in `.env` or the secret store.

## 6. Approval gates (default configuration)
| Gate | Required by default | Can be relaxed? |
|---|---|---|
| Topic selection | Yes | Phase 08 autopilot, within policy limits |
| Script approval (with fact-check + code verification passed or overridden with reason) | Yes | No (MVP) |
| Video approval (quality report passed) | Yes | No (MVP) |
| Upload as private/scheduled | Yes (part of video approval) | — |
| Making a video public / scheduling public | Yes, explicit | Autopilot only within explicit limits (Phase 08), off by default |
| Budget increase, scope expansion, new integration | Yes (owner) | No |
Autopilot pauses for human review on: unsupported claims, failed code verification, quality failure, budget threshold, credential errors, policy warnings, or `unknown` upload state.

## 7. Audit logging
Logged events: login success/failure, session revoke, OAuth connect/disconnect/refresh failure, scope change, approval decisions, overrides (with reason), publish requests and results, budget changes and pauses, config changes, prompt/model changes, admin data exports.
Fields: who, what, when, subject, correlation ID, source IP, outcome; details redacted of secrets and message bodies.

## 8. Data privacy
- Personal data is limited to operator account data and the YouTube channel identity. No viewer PII is collected; analytics are aggregate.
- Google API Services User Data Policy: use Google data only for the operator's own features; no transfer to third parties; deletion on disconnect. (Re-verify the policy text in Phase 05.)
- Data sent to the LLM: public research content, scripts, aggregate metrics. Never tokens, emails, or credentials.
- Email (optional, Phase 08): send-only to the operator; no inbox reading.

## 9. Secure SDLC
- Phase 01 CI: lint, typecheck, unit tests, gitleaks, `npm audit --audit-level=high`, migration up/down test.
- Each phase: `security-reviewer` reviews the diff for its scope; findings tracked in the phase report.
- Phase 09: full audit, dependency review, container scan, pen-test checklist (OWASP ASVS L2 subset), backup/restore drill.

## 10. Agent operating boundaries (this AI team)
- The agent acts only through tools actually connected and scopes actually granted.
- No force-push, no history rewrite, no secrets in commits; feature branches only.
- No public YouTube publishing, deletion, channel setting changes, purchases, or billing changes without explicit operator approval.
