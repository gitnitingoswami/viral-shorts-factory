# Central Task Tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `DONE`.
Phase status lives in `docs/PHASE_TRACKER.md`; this file tracks tasks and blockers.

## Setup / blockers
| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| S.1 | Initialize Git repo, add remote | Lead Orchestrator | DONE | Local repo on `main` (c4cddaf); remote `origin` = gitnitingoswami/desktop-tutorial; working branch `phase-00/product-discovery` |
| S.1b | Push access to GitHub remote | User | BLOCKED | HTTPS: stored credential invalid; SSH: key `~/.ssh/id_rsa` not registered with GitHub |
| S.2 | Fix `~/.config/gh` ownership (root-owned) and authenticate `gh` | User | BLOCKED | `sudo chown -R $(whoami) ~/.config/gh && gh auth login` |
| S.3 | Start Docker daemon | User | TODO | Needed by Phase 01 |
| S.4 | Install FFmpeg | Lead Orchestrator | TODO | Needed by Phase 04 |
| S.5 | Resolve phase-gate rule conflict | User | DONE | Approved 2026-11-14: Phase 00 needs user acceptance; Phase 01+ auto-advance on passing criteria |
| S.7 | YouTube target channel | User | DONE | `@Codehaksy` recorded as target channel; no OAuth connection yet (needed from Phase 02) |
| S.6 | Product decisions | User | DONE | Approved defaults 2026-11-14: coding-tips niche, YouTube Shorts only, ~$100/mo guard, Azure vs AWS compared in Phase 00, approval for every upload |

## Phase 00 — Product discovery, PRD & architecture
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T00.1 | PRD | Lead Orchestrator | IN_REVIEW | `docs/PRD.md` |
| T00.2 | Integrations research | Lead Orchestrator + security-reviewer | IN_REVIEW | `docs/INTEGRATIONS.md` |
| T00.3 | System architecture | backend-engineer + devops-engineer | IN_REVIEW | `docs/SYSTEM_ARCHITECTURE.md` |
| T00.4 | AI architecture | backend-engineer | IN_REVIEW | `docs/AI_ARCHITECTURE.md` |
| T00.5 | Database design + ERD | database-engineer | IN_REVIEW | `docs/DATABASE_DESIGN.md` |
| T00.6 | Security design | security-reviewer | IN_REVIEW | `docs/SECURITY_DESIGN.md` |
| T00.7 | Cost estimation | devops-engineer | IN_REVIEW | `docs/COST_ESTIMATION.md` |
| T00.8 | Development roadmap | Lead Orchestrator + qa-engineer | IN_REVIEW | `docs/DEVELOPMENT_ROADMAP.md` |
| T00.9 | Consistency review | code-reviewer | IN_PROGRESS | Completion report |
| T00.10 | Completion report + tracker | Lead Orchestrator | TODO | `tasks/reports/PHASE_00_COMPLETION_REPORT.md` |

## Change log
- 2026-11-14 — Workspace inspected; Phase 00 plan prepared; tracker created.
- 2026-11-14 — Plan approved. 8 Phase 00 docs drafted (official sources verified 2026-11-14); independent review started.
- 2026-11-14 — Git initialized locally, remote added, push blocked on auth; YouTube channel @Codehaksy recorded.
