# Central Task Tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `DONE`.
Phase status lives in `docs/PHASE_TRACKER.md`; this file tracks tasks and blockers.

## Setup / blockers
| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| S.1 | Initialize Git repo, add remote | Lead Orchestrator | DONE | Local repo on `main` (c4cddaf); remote `origin` = gitnitingoswami/viral-shorts-factory (private, created 2026-11-14; old `desktop-tutorial` kept as remote `tutorial`); working branch `phase-00/product-discovery` |
| S.1b | Push access to GitHub remote | User | DONE | HTTPS works via VS Code credentials (2026-11-14); SSH key still not registered |
| S.2 | Fix `~/.config/gh` ownership (root-owned) and authenticate `gh` | User | BLOCKED | `sudo chown -R $(whoami) ~/.config/gh && gh auth login` |
| S.3 | Start Docker daemon | User | DONE | Docker 29.8.1, Compose v5.5.1 verified 2026-11-14 |
| S.4 | Install FFmpeg | Lead Orchestrator | TODO | Needed by Phase 04 |
| S.8 | Node 24.22.3 for this project | Lead Orchestrator | DONE | Installed via nvm without changing the user's global node/npm config (`~/.npmrc` prefix left untouched) |
| S.5 | Resolve phase-gate rule conflict | User | DONE | Approved 2026-11-14: Phase 00 needs user acceptance; Phase 01+ auto-advance on passing criteria |
| S.7 | YouTube target channel | User | DONE | `@Codehaksy` recorded as target channel; no OAuth connection yet (needed from Phase 02) |
| S.6 | Product decisions | User | DONE | Approved defaults 2026-11-14: coding-tips niche, YouTube Shorts only, ~$100/mo guard, Azure vs AWS compared in Phase 00, approval for every upload |

## Phase 00 — Product discovery, PRD & architecture
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T00.1 | PRD | Lead Orchestrator | DONE | `docs/PRD.md` |
| T00.2 | Integrations research | Lead Orchestrator + security-reviewer | DONE | `docs/INTEGRATIONS.md` |
| T00.3 | System architecture | backend-engineer + devops-engineer | DONE | `docs/SYSTEM_ARCHITECTURE.md` |
| T00.4 | AI architecture | backend-engineer | DONE | `docs/AI_ARCHITECTURE.md` |
| T00.5 | Database design + ERD | database-engineer | DONE | `docs/DATABASE_DESIGN.md` |
| T00.6 | Security design | security-reviewer | DONE | `docs/SECURITY_DESIGN.md` |
| T00.7 | Cost estimation | devops-engineer | DONE | `docs/COST_ESTIMATION.md` |
| T00.8 | Development roadmap | Lead Orchestrator + qa-engineer | DONE | `docs/DEVELOPMENT_ROADMAP.md` |
| T00.9 | Consistency review | code-reviewer | DONE | Completion report |
| T00.10 | Completion report + tracker | Lead Orchestrator | DONE | `tasks/reports/PHASE_00_COMPLETION_REPORT.md` |

## Phase 01 — Project foundation
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T01.1 | Monorepo (npm workspaces), shared contracts, root tooling | Lead Orchestrator | DONE | `package.json`, `libs/contracts` |
| T01.2 | NestJS API: config, health, auth, users, channels, integrations, jobs, audit, migration | Lead Orchestrator (backend-engineer role) | DONE | `apps/api` |
| T01.3 | Angular shell, auth flow, health/channels/jobs/audit screens | frontend-engineer (subagent) | DONE | `apps/web` (44 tests) |
| T01.4 | Docker Compose, Dockerfiles, nginx, CI | Lead Orchestrator (devops-engineer role) | DONE | `infra/docker`, `.github/workflows/ci.yml` |
| T01.5 | Tests: unit + integration incl. migrations up/down/up, worker, concurrency | Lead Orchestrator (qa-engineer role) | DONE | API 66 tests in combined run, 94% lines |
| T01.6 | Independent code + security review | code-reviewer/security-reviewer (subagent) | DONE | Round 1 RETURN FOR FIXES (5 medium); fixes in `a9ba047` |
| T01.7 | Completion report | Lead Orchestrator | DONE | `tasks/reports/PHASE_01_COMPLETION_REPORT.md` |

## Phase 02 — Weekly trend research engine
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T02.1 | Migration: niche, research_source, collections, signals, topics, metrics, report, expense_record, budget, job lease | Lead Orchestrator (database-engineer role) | DONE | `1763330000000-TrendResearch.ts` |
| T02.2 | Source adapters (HN, Stack Exchange, GitHub, RSS) + YouTube competition, SSRF-safe HTTP | Lead Orchestrator (backend-engineer role) | DONE | `apps/api/src/research/{http,sources}.ts` |
| T02.3 | Deterministic clustering + explainable scoring | Lead Orchestrator | DONE | `scoring.ts` (unit-tested) |
| T02.4 | Pipeline job, weekly schedule, 30-day YouTube purge, ledger + budget guard | Lead Orchestrator | DONE | `research.pipeline.ts`, `research.processor.ts`, `budget/` |
| T02.5 | API: niches, runs, collections, topics, compare, decisions, report, budget | Lead Orchestrator | DONE | `research.controller.ts` |
| T02.6 | Angular research UI + budget card | frontend-engineer (subagent) | DONE | `apps/web/src/app/features/research` |
| T02.7 | Live smoke run against real public sources | Lead Orchestrator | DONE | 5/5 sources ok incl. YouTube; quality fixes (HN tags, GitHub clones/forks, sparse-score shrinkage) |
| T02.8 | Independent review, CI, completion report | Lead Orchestrator + reviewer | DONE | Review ACCEPT (round 2); CI 4/4 on 2b2e294 |

## Phase 03 — AI content strategy and scripts
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T03.1 | LLM layer: Claude provider (structured output, effort, refusal fallbacks), mock provider, metering + budget guard | Lead Orchestrator (backend-engineer role) | DONE | `apps/api/src/llm/` |
| T03.2 | Data model: ideas, scripts, immutable versions, claims, code checks, reviews | Lead Orchestrator (database-engineer role) | DONE | `1763350000000-ContentScripts.ts` |
| T03.3 | Pipelines: ideas (dedupe), script + storyboard, fact-check (evidence must be quoted), quality review, code sandbox | Lead Orchestrator | DONE | `apps/api/src/content/` |
| T03.4 | Approval gates bound to version hash; overrides with reasons; audit | Lead Orchestrator | DONE | `content.service.ts` |
| T03.5 | Angular: ideas, scripts, workspace, editor, decisions | frontend-engineer (subagent) | DONE | `apps/web/src/app/features/content` (143 web tests) |
| T03.6 | Live generation with Claude | User (Anthropic credits) | BLOCKED | Key configured and valid; API returns "credit balance is too low" — add credits in console.anthropic.com |
| T03.7 | Independent review, CI, completion report | Lead Orchestrator + reviewer | DONE | Review ACCEPT (round 3); CI 4/4 on 24e8398 |

## Phase 04 — AI video production
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T04.1 | Tooling: FFmpeg 9, eSpeak NG (local), OFL font assets, resvg frame renderer | Lead Orchestrator (devops role) | DONE | `apps/api/assets/fonts` (OFL.txt) |
| T04.2 | Data model: voice profiles, media assets (rights NOT NULL), productions, scenes, versions, quality reports | Lead Orchestrator (database-engineer role) | IN_PROGRESS | migration `VideoProduction` |
| T04.3 | Render pipeline: TTS → audio → frames → FFmpeg → captions → QC, on the `render` queue (leased, cancellable, idempotent) | Lead Orchestrator (backend-engineer role) | IN_PROGRESS | `apps/api/src/video/` |
| T04.4 | API: productions, cancel/retry, assets, signed media streaming | Lead Orchestrator | TODO | `video.controller.ts` |
| T04.5 | Angular: production queue, preview, asset library, quality report; F-12 re-run warning | frontend-engineer (subagent) | TODO | `apps/web/src/app/features/video` |
| T04.6 | Worker image + CI: ffmpeg/espeak-ng, fonts | Lead Orchestrator (devops role) | TODO | Dockerfile, ci.yml |
| T04.7 | Cloud TTS provider | User (choose provider + credential) | BLOCKED | Draft eSpeak voice until chosen |
| T04.8 | Independent review, CI, completion report | Lead Orchestrator + reviewer | TODO | |

## Follow-ups (tracked, non-blocking)
| ID | Item | Source | Target phase |
|---|---|---|---|
| F-01 | Job lease (worker id + expiry) in the claim, so a stalled-but-alive worker can't double-process; required before upload jobs | Review #6 | **DONE in Phase 02** (claim/heartbeat/complete/fail with lease; e2e-tested) |
| F-02 | Separate non-owner DB role for the app (revoke UPDATE/DELETE/TRUNCATE on audit_event, no trigger disable) | Review #9 | 09 |
| F-03 | Request hash in audit events (T18) | Review suggestion | 05 (publishing) |
| F-04 | Test for wrong JWT issuer/audience | Review suggestion | **DONE in Phase 02** (issuer, audience, algorithm) |
| F-05 | Web: navigate to login when a retried request still returns 401 after a successful refresh | Review suggestion | **DONE in Phase 02** |
| F-06 | Re-evaluate EdDSA vs HS256 access tokens | SECURITY_DESIGN §4 | 09 |
| F-07 | 3 moderate npm advisories (typeorm → minimatch), no high/critical | npm audit | Re-check each phase |
| F-08 | Scoring fairness: topics outside the YouTube-checked top 15 lose the competition weight via confidence shrinkage; consider excluding it from confidence for unchecked topics | Phase 02 review suggestion | 06 (analytics calibration) |
| F-10 | YouTube daily cap is read-then-record; several concurrent workers could slightly exceed it. Use an atomic reservation when workers scale out | Phase 02 review round 2 | 08 |
| F-11 | Dedicated sandbox-runner service so containerized workers never need Docker access (today: docker CLI on the worker host; compose workers report `unavailable`) | Phase 03 / SECURITY_DESIGN T7 | 09 |
| F-12 | Re-running checks clears earlier claim/code overrides (audit keeps them): warn in the UI before re-run, or carry overrides forward by claim text | Phase 03 review suggestion | 04 |
| F-13 | Stream the 32k-token script call (`finalMessage()`); system prompts are below the cache minimum (cache_control is a no-op until prompts grow) | Phase 03 review suggestion | 08 |
| F-14 | Live Claude smoke test (ideas → script → checks) and cost check once `ANTHROPIC_API_KEY` is configured | Phase 03 | When key provided |
| F-15 | If a check job's final attempt fails before it is ever claimed (e.g. DB error during claim), states can stay `pending`; have the reconciler fail orphaned pending check runs | Phase 03 review round 3 | 08 |
| F-09 | Pin the SSRF-checked IP for the actual connection (undici Agent `connect.lookup`) to close the DNS-rebinding window | Phase 02 review suggestion | 09 |

## Change log
- 2026-11-15 — Phase 03 ACCEPTED; PR #4 merged. Live Claude run (F-14) pending Anthropic credits.
- 2026-11-15 — ANTHROPIC_API_KEY configured; live call blocked by Anthropic: credit balance too low (handled: fast non-retryable failure).
- 2026-11-15 — Phase 03 implemented with mock LLM; live Claude generation blocked on ANTHROPIC_API_KEY.
- 2026-11-15 — Phase 02 ACCEPTED; PR #3 merged.
- 2026-11-15 — Phase 02 implemented; live run against HN/SO/GitHub/RSS succeeded.
- 2026-11-15 — YouTube Data API key configured by the user (`YOUTUBE_API_KEY` in local `.env`); verified with one search call; live run: 5/5 sources ok, 15 competition checks, 30-day expiry, quota recorded, key absent from logs.
- 2026-11-15 — Phase 01 ACCEPTED (CI 4/4 green on 67ff191; review ACCEPT). PR #2 merged.
- 2026-11-15 — Phase 01 implemented; review round 1 found 5 medium issues, all fixed with tests; F-01..F-07 tracked.
- 2026-11-14 — Phase 00 ACCEPTED by the user; phases 01–09 pre-approved on passing criteria. Phase 01 started.
- 2026-11-14 — Workspace inspected; Phase 00 plan prepared; tracker created.
- 2026-11-14 — Review round 1: RETURN FOR FIXES (3 blocking); fixed; round 2: ACCEPT. Completion report written; Phase 00 IN_REVIEW awaiting user acceptance.
- 2026-11-14 — Plan approved. 8 Phase 00 docs drafted (official sources verified 2026-11-14); independent review started.
- 2026-11-14 — Git initialized locally, remote added, push blocked on auth; YouTube channel @Codehaksy recorded.
