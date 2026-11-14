# Development Roadmap

**Version:** 0.1 (Phase 00) · **Date:** 2026-11-14 · **Owners:** Lead Orchestrator, qa-engineer (test strategy)

## 1. Phase gate rule (approved 2026-11-14)
- **Phase 00** requires explicit user acceptance.
- **Phases 01–09** auto-advance when every acceptance criterion passes with recorded evidence, a completion report is written, and no blocker remains. Exceptions that always need the user: public publishing, production deployment, new integrations/scope expansion, spending above the budget, destructive actions.
- One phase `IN_PROGRESS` at a time. Phases are never skipped.

## 2. Dependency graph
```
00 ─► 01 ─► 02 ─► 03 ─► 04 ─► 05 ─► 06 ─► 07 ─► 08 ─► 09
            │      │      │      │
            │      │      │      └─ needs: YouTube upload scope (user), test channel/private mode
            │      │      └─ needs: TTS credential (user), FFmpeg (agent installs)
            │      └─ needs: Anthropic API key (user)
            └─ needs: GCP project + YouTube read scope + API key (user)
01 needs: Docker running (user), GitHub push access (user)
```
Where a credential is missing, the phase proceeds with **mock providers** and is marked `BLOCKED` only for the live-integration criteria.

## 3. Phases and acceptance criteria
### Phase 01 — Project foundation
Scope: npm-workspaces monorepo (`apps/api`, `apps/worker`, `apps/web`, `libs/contracts`, `libs/providers`); NestJS modules config/health/auth/users/channels/integrations/jobs/audit; Angular shell; Compose (Postgres, Redis, MinIO); CI.
Acceptance:
1. `npm ci && npm run build` succeeds for all apps on a clean clone (documented in README).
2. `docker compose up` starts the dependencies; `/health/ready` reports DB, Redis, and storage as up.
3. Migrations run up/down/up on a disposable DB in CI.
4. Login → access a protected route works; unauthenticated → 401; reviewer role is denied owner-only routes.
5. Angular calls the API (health page shows live status); loading/error states are present.
6. Lint, typecheck, unit tests (≥ 80% line coverage on `auth`, `jobs`, `audit`), and gitleaks all pass in CI.
7. A job submitted twice with the same idempotency key creates one job record.
8. Audit events are written for login and protected mutations.

### Phase 02 — Weekly trend research
Acceptance: the manual run and the scheduled (cron) run both produce a collection; one failing source doesn't fail the run (isolated errors are recorded); duplicate signals/topics are merged; every `trend_metric` has source + timestamps; each score shows its breakdown, confidence, and missing components; tests cover missing, stale, and provider-failure cases; dashboard filter/compare/approve works. Live YouTube search requires the API key (else mock).

### Phase 03 — Content strategy & scripts
Acceptance: 5 distinct ideas per approved topic; scripts and scenes match the schema; every claim has a source or is flagged; code snippets are sandbox-verified (with tests for the escape attempts); versions are immutable; review state is explicit; tests cover malformed LLM output, refusal, truncation, and duplicate ideas; the budget guard blocks when over budget; cost is recorded per call.

### Phase 04 — Video production
Acceptance: at least one complete 1080×1920 test video renders, plays, and passes quality checks; every asset has license/provenance; retries don't duplicate production records; failure and recovery of the render worker are tested; quality failures are visible in the UI; TTS + render costs are recorded.

### Phase 05 — YouTube publishing
Acceptance: OAuth with state + PKCE + encrypted tokens + disconnect/revoke; minimal scopes; the test upload is **private**, only after operator approval; remote status is verified; a simulated crash mid-upload does not produce a duplicate (marker reconciliation test); public publishing requires explicit approval; CI uses mocks.

### Phase 06 — Analytics & performance
Acceptance: scheduled + manual snapshots; only API-exposed metrics, each with source, window, and fetch time; delayed/estimated labels; idempotent refresh; calculations unit-tested; insights cite snapshot IDs and include a causation caveat.

### Phase 07 — Monetization & finance
Acceptance: every figure has a source and currency; net/cost-per-video/RPM are computed only with valid denominators (else "n/a"); budgets pause eligible jobs (tested); incomplete revenue is labeled; no automatic purchases or commitments exist anywhere in the code.

### Phase 08 — Full orchestration
Acceptance: the mock workflow runs end to end from research to analytics; restart mid-workflow resumes correctly; retries never duplicate external actions; approval gates can't be bypassed (negative tests via API and worker); the audit trail is complete per correlation ID; autopilot is off by default and its limits are enforced.

### Phase 09 — Production hardening
Acceptance: no open critical/high findings without written risk acceptance; backup → restore demonstrated; reproducible deploy (IaC) to the chosen cloud **after user approval**; monitoring, alerting, and rollback verified; runbooks written.

## 4. Test strategy (qa-engineer)
| Level | Tooling | Scope | In CI |
|---|---|---|---|
| Unit | Jest (API/worker), Jest or Vitest (Angular) | Services, scoring, guards, schema validation | Yes |
| Integration | Jest + Testcontainers (Postgres, Redis, MinIO) | Repositories, migrations, queues, idempotency | Yes |
| Contract | Recorded provider fixtures | Claude, YouTube, TTS adapters | Yes |
| E2E | Playwright | Login, review/approve flows, full mock workflow | Yes (mock providers) |
| Media | ffprobe-based assertions | Resolution, duration, loudness, captions | Yes (short fixture) |
| Security | gitleaks, npm audit/OSV, sandbox escape tests, authz negative tests | Every phase | Yes |
| Live smoke | Manual-trigger workflow with real credentials | Per integration, private mode only | No (manual) |
Rules: tests are never weakened or deleted to make a suite pass; exact pass/fail counts go in each completion report.

## 5. Indicative timeline (AI-team effort, excluding waits on user actions)
| Phase | Size | Notes |
|---|---|---|
| 01 | M | Foundation and CI |
| 02 | M | Five source adapters + scoring + UI |
| 03 | L | LLM pipelines, sandbox, review UI |
| 04 | L | Renderer and FFmpeg pipeline is the hardest engineering piece |
| 05 | M | OAuth + safe upload |
| 06 | M | |
| 07 | S | Ledger exists from 03 |
| 08 | M | |
| 09 | M | Plus a cloud account from the user |
