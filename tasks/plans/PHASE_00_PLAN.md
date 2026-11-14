# Phase 00 Execution Plan — Product Discovery, PRD & Architecture

**Prepared:** 2026-11-14 · **Owner:** Lead Orchestrator · **Status:** Pending user approval

## 1. Requirement understanding
Phase 00 is planning and research only (per `phases/00-product-discovery.md`): define a feasible,
secure, testable product for an AI-assisted short-form video business and produce 8 design
documents. No application source code, no dependency installs, no production resources.

## 2. Current workspace findings (2026-11-14)
| Area | Finding | Impact |
|---|---|---|
| Code | None. Workspace holds instructions, 12 agent files, 3 commands, 1 skill, templates, 10 phase prompts | Greenfield; no conventions to inherit beyond `CLAUDE.md` |
| Git | **Not a Git repository.** No remote configured. Global `user.name` = set; no credential helper | Commit/push impossible until repo + remote exist |
| GitHub CLI | `gh` installed but `~/.config/gh/` is **owned by root** (permission denied) | `gh` unusable until ownership fixed |
| Node | v22.15.0, npm 10.9.2 | OK for Phase 01 |
| Docker | Installed, **daemon not running** | Needed in Phase 01 (Postgres/Redis) |
| FFmpeg | **Not installed** | Needed in Phase 04 |
| Gmail / YouTube | **No integration connected** in this Claude Code session | Needed for Phases 02/05/06; not for Phase 00 |
| Google Drive (claude.ai connector) | Present but **unauthorized** | Optional; not required |
| Permissions | `.claude/settings.json` uses `defaultMode: default` with deny rules for force-push / hard reset | Routine prompts will still appear unless an allowlist is added |
| Duplicate agents | backend-engineer/developer, frontend-engineer/developer, database-engineer/specialist, qa-engineer/test-engineer overlap | Will use the `*-engineer` set as primary; `*-developer`/`*-specialist` as fallback |

### Instruction conflict to resolve
`CLAUDE.md`/`APPROVAL_POLICY.md` allow automatic progression to the next phase, while
`docs/PHASE_TRACKER.md` ("ACCEPTED only after … user approval"), `lead-orchestrator.md` (step 10–11),
`/handoff`, and Phase 00's own constraint ("produce a plan and wait for approval") require explicit
user acceptance. **Proposed resolution:** Phase 00 (architecture decisions) requires your explicit
acceptance. From Phase 01 onward, phases auto-advance when all acceptance criteria pass, with a
completion report each time. I will update the tracker gate rule to match once you confirm.

## 3. Acceptance criteria (Phase 00)
1. All 8 deliverables exist in `docs/` and cover every "Required work" item in the phase prompt.
2. External-service claims (APIs, quotas, scopes, pricing, terms) cite official sources with a
   retrieval date; verified facts are clearly separated from assumptions.
3. ERD covers all 9 core domains in `ARCHITECTURE_OVERVIEW.md`, and the suggested entities of phases 02–08.
4. Threat model covers OAuth, token storage, secrets, approval gates, audit logs, media rights, and privacy.
5. Cost estimate gives low/expected/high ranges with explicit assumptions; no view/revenue promises.
6. Roadmap gives each phase 01–09 testable acceptance criteria and dependencies.
7. Security review by `security-reviewer` and consistency review by `code-reviewer` with no open blocking findings.
8. No application code, no dependency installs, no secrets in the repo.

## 4. Work breakdown and specialist assignments
Each task has one owner and writes only its listed file(s). Steps in the same wave can run in parallel.

| # | Wave | Task | Owner | Output file | Depends on |
|---|---|---|---|---|---|
| T00.1 | 1 | Product scope: users, workflows, MVP, non-goals, success metrics, end-to-end flow | Lead Orchestrator | `docs/PRD.md` | Your product decisions (§7) |
| T00.2 | 1 | External services research: YouTube Data/Analytics API, Google OAuth scopes and quota, Google Trends access, Gmail API, TTS/LLM/image providers, TikTok/Instagram API feasibility | Lead Orchestrator + `security-reviewer` (scopes) | `docs/INTEGRATIONS.md` | — |
| T00.3 | 2 | System architecture: Angular, NestJS modules, BullMQ queues, FFmpeg workers, S3 storage, deployment options with trade-offs | `backend-engineer` (+ `devops-engineer` for deployment) | `docs/SYSTEM_ARCHITECTURE.md` | T00.1 |
| T00.4 | 2 | AI architecture: provider interfaces (LLM, research, TTS, image/video), prompt versioning, fact-check, cost metering, fallback | `backend-engineer` | `docs/AI_ARCHITECTURE.md` | T00.1, T00.2 |
| T00.5 | 2 | Database domains + first-pass ERD (Mermaid), keys, indexes, idempotency keys, audit and provenance tables | `database-engineer` | `docs/DATABASE_DESIGN.md` | T00.1 |
| T00.6 | 3 | Threat model (STRIDE), OAuth/token encryption, secret management, approval gates, audit logging, media rights, privacy | `security-reviewer` | `docs/SECURITY_DESIGN.md` | T00.2–T00.5 |
| T00.7 | 3 | Cost model: LLM, TTS, image/video gen, rendering compute, storage, hosting; low/expected/high ranges | `devops-engineer` | `docs/COST_ESTIMATION.md` | T00.2, T00.3 |
| T00.8 | 3 | Roadmap: phases 01–09, dependencies, per-phase acceptance criteria, test strategy | Lead Orchestrator + `qa-engineer` (test strategy) | `docs/DEVELOPMENT_ROADMAP.md` | T00.3–T00.5 |
| T00.9 | 4 | Cross-document consistency review | `code-reviewer` | review notes in completion report | all |
| T00.10 | 4 | Completion report + tracker update | Lead Orchestrator | `tasks/reports/PHASE_00_COMPLETION_REPORT.md` | T00.9 |

## 5. Proposed architecture defaults (to be confirmed in the docs)
Angular dashboard · NestJS + TypeScript API · PostgreSQL + TypeORM · Redis + BullMQ · FFmpeg render
workers · S3-compatible storage (MinIO locally) · provider adapter interfaces for all AI and social
services · Docker Compose locally · cloud target chosen in this phase (Azure vs AWS comparison).
Default LLM provider: Claude (latest Claude 5 models) behind a provider interface.

## 6. Integrations required (by phase)
| Integration | Needed from | Minimum scope / access | Status | Your action |
|---|---|---|---|---|
| **Git repo + remote** (GitHub) | Phase 00 (to commit docs) | Push to one project repo | ❌ No repo, no remote | Create an empty private GitHub repo and give me its URL; I'll run `git init` and add the remote |
| **GitHub CLI auth** | Phase 00 | `repo` | ❌ `~/.config/gh` owned by root | Run `sudo chown -R $(whoami) ~/.config/gh` then `gh auth login` (or set up an SSH key/credential helper) |
| **Docker daemon** | Phase 01 | Local only | ⚠️ Installed, not running | Start Docker Desktop |
| **FFmpeg** | Phase 04 | Local binary | ❌ Missing | `brew install ffmpeg` (I can do this when Phase 04 starts) |
| **LLM API key** (Anthropic) | Phase 03 (Phase 02 optional) | API key in `.env` / keychain, never in chat | ❌ | Create a key with a spend limit; put it in `.env` yourself |
| **Google Cloud project + OAuth client** | Phase 02 | YouTube Data API v3 enabled; OAuth consent screen | ❌ | Create the GCP project; I'll document exact steps in `INTEGRATIONS.md` |
| **YouTube read** | Phase 02/06 | `youtube.readonly`, `yt-analytics.readonly` | ❌ | Authorize via the app's OAuth flow (built in Phase 05) or an MCP connector |
| **YouTube upload** | Phase 05 | `youtube.upload` (dedicated test channel first) | ❌ | Choose the target channel; set publishing defaults |
| **Gmail** | Phase 08 (notifications) | `gmail.send` only, or `gmail.compose` for drafts only | ❌ | Connect only if you want email notifications; otherwise use in-app notifications |
| **TTS provider** | Phase 04 | API key | ❌ | Pick a provider after the cost comparison in this phase |
| **Image/video generation provider** | Phase 04 | API key | ❌ | Same as above |
| **Cloud account** (Azure/AWS) | Phase 09 | Scoped deploy role | ❌ | Not needed until Phase 09 |

**Phase 00 needs only Git.** All other integrations block later phases, not this one.

## 7. Decisions needed from you (these change the PRD)
1. **Initial niche** (e.g. tech explainers, personal finance, history facts) — or should I recommend one?
2. **Target platforms for the MVP:** YouTube Shorts only (recommended), or also TikTok/Instagram?
3. **Monthly operating budget ceiling** for AI/TTS/render costs (used for cost ranges and budget guards).
4. **Cloud preference for Phase 09:** Azure, AWS, or decide in Phase 00?
5. **Publishing mode:** human approval for every upload (default), or bounded autopilot later?
6. **Phase gate rule** (see the conflict in §2): accept the proposed resolution?

## 8. Risks and assumptions
- Platform APIs and quotas change; all claims will be re-verified from official docs with dates.
- TikTok/Instagram publishing APIs require app review; likely out of the MVP.
- Google Trends has no general public API; trend research may rely on YouTube Data API, RSS, and approved sources.
- AI-generated media must carry provenance and licensing metadata; no copyrighted third-party media.
- No promises of views, virality, or revenue.

## 9. Out of scope for Phase 00
Application code, dependency installation, cloud resources, account connections, uploads, emails.

## 10. Approval
**Status:** APPROVED by user 2026-11-14 with recommended defaults for §7.
