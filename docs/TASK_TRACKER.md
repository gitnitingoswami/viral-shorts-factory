# Central Task Tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `DONE`.
Phase status lives in `docs/PHASE_TRACKER.md`; this file tracks tasks and blockers.

## Setup / blockers
| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| S.1 | Initialize Git repo, add remote | Lead Orchestrator | BLOCKED | Waiting for remote repo URL from user |
| S.2 | Fix `~/.config/gh` ownership (root-owned) and authenticate `gh` | User | BLOCKED | `sudo chown -R $(whoami) ~/.config/gh && gh auth login` |
| S.3 | Start Docker daemon | User | TODO | Needed by Phase 01 |
| S.4 | Install FFmpeg | Lead Orchestrator | TODO | Needed by Phase 04 |
| S.5 | Resolve phase-gate rule conflict | User | BLOCKED | See `tasks/plans/PHASE_00_PLAN.md` §2 |
| S.6 | Product decisions (niche, platforms, budget, cloud, publishing mode) | User | BLOCKED | See plan §7 |

## Phase 00 — Product discovery, PRD & architecture
| ID | Task | Owner | Status | Output |
|---|---|---|---|---|
| T00.1 | PRD | Lead Orchestrator | TODO | `docs/PRD.md` |
| T00.2 | Integrations research | Lead Orchestrator + security-reviewer | TODO | `docs/INTEGRATIONS.md` |
| T00.3 | System architecture | backend-engineer + devops-engineer | TODO | `docs/SYSTEM_ARCHITECTURE.md` |
| T00.4 | AI architecture | backend-engineer | TODO | `docs/AI_ARCHITECTURE.md` |
| T00.5 | Database design + ERD | database-engineer | TODO | `docs/DATABASE_DESIGN.md` |
| T00.6 | Security design | security-reviewer | TODO | `docs/SECURITY_DESIGN.md` |
| T00.7 | Cost estimation | devops-engineer | TODO | `docs/COST_ESTIMATION.md` |
| T00.8 | Development roadmap | Lead Orchestrator + qa-engineer | TODO | `docs/DEVELOPMENT_ROADMAP.md` |
| T00.9 | Consistency review | code-reviewer | TODO | Completion report |
| T00.10 | Completion report + tracker | Lead Orchestrator | TODO | `tasks/reports/PHASE_00_COMPLETION_REPORT.md` |

## Change log
- 2026-11-14 — Workspace inspected; Phase 00 plan prepared; tracker created.
