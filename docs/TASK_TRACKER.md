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
| T01.7 | Completion report | Lead Orchestrator | IN_PROGRESS | `tasks/reports/PHASE_01_COMPLETION_REPORT.md` |

## Follow-ups (tracked, non-blocking)
| ID | Item | Source | Target phase |
|---|---|---|---|
| F-01 | Job lease (worker id + expiry) in the claim, so a stalled-but-alive worker can't double-process; required before upload jobs | Review #6 | 02 (before any side-effecting job) |
| F-02 | Separate non-owner DB role for the app (revoke UPDATE/DELETE/TRUNCATE on audit_event, no trigger disable) | Review #9 | 09 |
| F-03 | Request hash in audit events (T18) | Review suggestion | 05 (publishing) |
| F-04 | Test for wrong JWT issuer/audience | Review suggestion | 02 |
| F-05 | Web: navigate to login when a retried request still returns 401 after a successful refresh | Review suggestion | 02 |
| F-06 | Re-evaluate EdDSA vs HS256 access tokens | SECURITY_DESIGN §4 | 09 |
| F-07 | 3 moderate npm advisories (typeorm → minimatch), no high/critical | npm audit | Re-check each phase |

## Change log
- 2026-11-15 — Phase 01 implemented; review round 1 found 5 medium issues, all fixed with tests; F-01..F-07 tracked.
- 2026-11-14 — Phase 00 ACCEPTED by the user; phases 01–09 pre-approved on passing criteria. Phase 01 started.
- 2026-11-14 — Workspace inspected; Phase 00 plan prepared; tracker created.
- 2026-11-14 — Review round 1: RETURN FOR FIXES (3 blocking); fixed; round 2: ACCEPT. Completion report written; Phase 00 IN_REVIEW awaiting user acceptance.
- 2026-11-14 — Plan approved. 8 Phase 00 docs drafted (official sources verified 2026-11-14); independent review started.
- 2026-11-14 — Git initialized locally, remote added, push blocked on auth; YouTube channel @Codehaksy recorded.
