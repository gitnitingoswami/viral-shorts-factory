# Product Requirements Document — AI Viral Shorts Factory

**Version:** 0.1 (Phase 00) · **Date:** 2026-11-14 · **Owner:** Lead Orchestrator · **Status:** Draft for acceptance

## 1. Summary
An internal, single-operator tool that helps Nitin research, write, produce, review, publish and
measure **short programming and coding tips videos** for the YouTube channel **@Codehaksy**.
AI does the repetitive work (research digests, drafts, voice-over, rendering, metrics).
The human gives the creative direction and approves every script and every upload.

The name "Viral Shorts Factory" is an internal project name. The product makes no promise of
virality, views, or revenue (see §9).

## 1a. Workspace inspection (2026-11-14)
- **Existing code:** none. The workspace contained only orchestration instructions (`CLAUDE.md`, `APPROVAL_POLICY.md`), 12 specialist agent files, 3 commands, 1 skill, templates, and 10 phase prompts.
- **Conventions inherited:** from `CLAUDE.md` / `docs/engineering-standards/`: strict TypeScript, NestJS/Angular/PostgreSQL/TypeORM/Redis stack, migrations for every schema change, idempotent jobs, no secrets in Git, feature branches, no force-push.
- **Constraints found:** Git was not initialized (now initialized, remote `gitnitingoswami/desktop-tutorial`, branch `phase-00/product-discovery`; the remote `main` has unrelated history). FFmpeg is not installed. The Docker daemon is not running. No YouTube/Gmail integration is connected. `gh` CLI config is root-owned. Duplicate agent roles exist (`*-engineer` used as primary).

## 2. Approved decisions (2026-11-14)
| Decision | Value |
|---|---|
| Niche | Short programming and coding tips (JS/TS, Node, Angular, SQL, Git, DevOps, AI tooling) |
| Platforms (MVP) | YouTube Shorts only; other platforms are later adapters |
| Budget guard | About $100/month in variable AI/TTS/render cost; hard stop when reached |
| Cloud | Azure vs AWS compared in `SYSTEM_ARCHITECTURE.md`; final choice in Phase 09 |
| Publishing | Human approval for every upload; autopilot is out of the MVP |

## 3. Target users
| User | Description | Primary needs |
|---|---|---|
| **Operator (Nitin)** — primary, only MVP user | Senior engineer who runs the channel part time | Spend about 15 minutes of review per video instead of hours of production; keep technical accuracy; stay within budget and YouTube policies |
| **Viewer** (indirect) | Developers browsing Shorts | Correct, concise, original tips with readable code on screen |
| **Reviewer/collaborator** (later) | An optional second person who approves content | Role-based access to the review queue |

## 4. Problem and value
Making a good coding Short takes 2–4 hours: find a topic, write a tight script, check the code
actually works, record voice-over, build visuals, edit, caption, upload, and track results.
The product cuts this to a short review loop while keeping quality and originality high enough
to meet YouTube's **inauthentic content** policy, which excludes "mass-produced, generic,
repetitive" content and "AI-generated content made with generic or unoriginal templates" from
monetization (verified 2026-11-14, see `INTEGRATIONS.md` §6).

**Design consequence:** the product optimizes for *quality per video and human creative
direction*, not volume. The default cadence is 3–5 videos/week.

## 5. Primary workflow (end to end)
```
Niche config ─► Weekly trend research ─► Topic shortlist (human picks)
   ─► 5 content ideas per topic ─► Script + storyboard draft
   ─► Code-snippet verification + fact-check ─► Human script review/edit (approval gate 1)
   ─► Assets: rendered code visuals, TTS voice, captions ─► FFmpeg render 1080×1920
   ─► Automated quality checks ─► Human video review (approval gate 2)
   ─► Upload to YouTube as private/scheduled ─► Remote state verification
   ─► Metric snapshots (24h, 7d, 28d) ─► Performance insights ─► Feeds next week's research
   ─► Cost/revenue ledger updated at every billable step
```

### Niche-specific advantage
Coding content can use **deterministically rendered visuals**: syntax-highlighted code frames,
terminal sessions, diffs and diagrams generated from the script's own code. This:
- avoids most image/video-generation cost,
- avoids third-party media rights issues (all visuals are generated from our own text),
- lets us **run the code snippet** in a sandbox to check that it is correct before it reaches the screen.

AI image/video generation stays an optional, provider-abstracted add-on (for example, a title card background).

## 6. MVP scope (Phases 01–06)
| # | Capability | Phase |
|---|---|---|
| M1 | Login (single operator, local accounts with MFA-ready design), workspace, channel config | 01 |
| M2 | Niche config + weekly/manual trend research from approved sources with provenance and explainable score | 02 |
| M3 | Idea generation (5 per topic), script + storyboard generation, versioning, review UI | 03 |
| M4 | Code snippet verification (sandboxed execution or type-check) and claim fact-check against sources | 03 |
| M5 | Production: code-frame renderer, TTS, captions, FFmpeg composition, quality report, preview | 04 |
| M6 | YouTube OAuth connection, publishing queue, approval gate, private/scheduled upload, duplicate prevention | 05 |
| M7 | Metric snapshots from YouTube Data + Analytics APIs, dashboards, evidence-linked insights | 06 |
| M8 | Cost ledger per provider/video, monthly budget guard that pauses billable jobs | Ledger + guard in 02 (before the first billable call); finance views in 07 |
| M9 | Audit log of every external action and approval | 01 onward |

Phases 07–09 add finance views, full orchestration with bounded autopilot (off by default), and production hardening.

## 7. Non-goals (MVP)
- Publishing to TikTok, Instagram, X, or LinkedIn (adapter interfaces only, no implementation).
- Multi-tenant SaaS, billing, or public sign-up.
- Fully autonomous publishing without human approval.
- Scraping sites without an official API or that forbid it (for example, scraping the Google Trends web UI).
- Re-uploading or remixing other creators' videos, music, or footage.
- Sponsorship deals, ad buying, or any purchases.
- Mobile apps.
- Real-human voice cloning. Only stock TTS voices are used, or the operator's own voice with documented consent.

## 8. Functional requirements (summary)
Full acceptance criteria per phase are in `DEVELOPMENT_ROADMAP.md`.
- **FR-1 Research:** each trend topic stores source, URL, retrieval timestamp, raw metric values, and a score breakdown. Missing metrics are shown as missing, never imputed silently.
- **FR-2 Ideas:** exactly 5 distinct ideas per approved topic. Near-duplicates of past ideas (`pg_trgm` text similarity above a threshold) are flagged.
- **FR-3 Scripts:** 20–60 s target (YouTube allows up to 3 min). Scene list with narration, on-screen code/text, duration, and transition. Every version is kept.
- **FR-4 Verification:** code snippets are executed or type-checked in an isolated sandbox. Factual claims are linked to sources or flagged "unsupported". Unsupported claims block approval unless the operator overrides with a reason.
- **FR-5 Production:** 1080×1920, configurable fps/codec/bitrate. Burned-in captions plus an SRT file. Every asset has provenance and license metadata.
- **FR-6 Quality checks:** duration, resolution, audio loudness (target −14 LUFS), A/V sync, caption bounds within the safe area, code legibility (minimum font size), and a missing-asset check.
- **FR-7 Publishing:** `privacyStatus` is **always set explicitly** (the API defaults to public when omitted). `containsSyntheticMedia` is set per the disclosure rules. `selfDeclaredMadeForKids=false` is set explicitly. Every upload uses an idempotency key. Remote state is checked before any retry.
- **FR-8 Analytics:** only metrics the APIs actually expose, with source, time window, and fetch time.
- **FR-9 Budget:** each billable job checks the remaining monthly budget before it runs. At 80% the operator is notified; at 100% new billable jobs pause.
- **FR-10 Audit:** an append-only audit event for logins, OAuth connects/disconnects, approvals, uploads, budget changes, and overrides.

## 9. Success metrics (product, not outcome guarantees)
| Metric | MVP target | How measured |
|---|---|---|
| Operator time per published Short | ≤ 30 min (from topic pick to scheduled upload) | Timestamps on workflow state transitions |
| Script approval rate without major rewrite | ≥ 60% after 4 weeks | Review records |
| Code snippets passing verification | 100% of published videos | Verification records |
| Unsupported factual claims published | 0 | Fact-check records |
| Duplicate or accidental public uploads | 0 | Upload attempts vs. published content |
| Variable cost per published Short | ≤ $3 expected, monthly total ≤ $100 | Cost ledger |
| Pipeline success rate (render + upload) | ≥ 95% without manual retry | Job records |

Channel outcomes (views, retention, subscribers, revenue) are **tracked and reported but not targeted**.
YouTube Partner Program eligibility currently requires 1,000 subscribers plus either 4,000 watch
hours/12 months or 10M Shorts views/90 days, and the terms change on 2027-02-01 (verified 2026-11-14).
No claim is made that the channel will reach these thresholds.

## 10. Assumptions
- A1: One operator, one channel (@Codehaksy), English-language content.
- A2: The operator owns the channel and can create a Google Cloud project and OAuth client.
- A3: An Anthropic API key with a spend limit will be provided via `.env` or keychain (Phase 03).
- A4: Local development on macOS with Docker; production on a single small VM is enough for MVP volume.
- A5: Stock TTS voices are acceptable for brand voice (operator will choose one in Phase 04).
- A6: Using AI for scripts and voice-over is permissible for YouTube monetization *if* each video shows real creative direction. This is policy interpretation, not a guarantee.

## 11. Open questions (non-blocking)
- Q1: A brand style (colors, font, intro/outro) is needed by Phase 04. A default will be proposed.
- Q2: Should the operator's own recorded voice be supported as an alternative to TTS? (Proposed: Phase 04 stretch goal.)
- Q3: Should the same videos later be cross-posted to other platforms? (Not in MVP.)
