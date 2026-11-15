# Phase 02 Completion Report: Weekly Trend Research Engine

**Date:** 2026-11-15 · **Branch:** `phase-02/trend-research` · **PR:** #3 · **Recommendation:** ACCEPT

## Summary
A weekly (and on-demand) research pipeline for the coding-tips niche: it collects signals from Hacker News,
Stack Overflow, GitHub and official release feeds, measures YouTube competition, clusters signals into topics, and
scores them explainably. Every metric has provenance, YouTube-derived data is removed after 30 days, spend and quota
are guarded, and the dashboard supports review, compare and approval.

## Scope delivered
| Area | Delivered |
|---|---|
| Sources | Hacker News (Algolia), Stack Exchange, GitHub search (forks excluded, clone de-duplication), allowlisted RSS/Atom feeds, YouTube `search.list` competition estimate (`part=id`, top 15 per run, daily cap) |
| Safety | SSRF-safe HTTP (https only, host allowlist, public IPs incl. IPv6 special ranges, redirect re-check, timeout, size cap); secrets scrubbed from stored errors |
| Scoring | Relevance filter (title/real tags only), deterministic clustering, 6 components with per-source normalization, renormalized weights + evidence shrinkage, confidence, missing components, stale flags |
| Pipeline | Lease-based job (F-01), per-source isolation (`completed`/`partial`/`failed`), idempotent manual runs, weekly cron runs idempotent per ISO week, orphaned-collection reconciler |
| Data | Migrations 1763330000000 + 1763340000000; provenance on every metric; YouTube metrics deleted and topic values redacted after 30 days; reports contain no YouTube numbers |
| Cost | Expense ledger, monthly budget guard (blocks at/over limit), YouTube quota usage recorded, daily search cap |
| API | Niches, sources, runs, collections, topics (filter/sort/search), topic evidence, compare (2–4), decisions, report, budget summary; audit events for config, runs and decisions |
| UI | Research page with polling, niches, topics table, topic evidence, compare, safe report renderer, budget card |
| Follow-ups closed | F-01 job lease, F-04 JWT iss/aud/alg tests, F-05 web 401 after refresh |

## Specialist agents
- frontend-engineer (subagent, exclusive `apps/web` scope): research UI and F-05. Re-verified independently (92 tests, lint, build, security greps).
- code-reviewer + security-reviewer (independent subagent). Round 2 (on `d6e5f71`): **ACCEPT**; its low items were addressed (hourly purge, dev backfill) or tracked (F-10). Round 1: RETURN FOR FIXES. 6 confirmed defects were found, all fixed with tests:
  - YouTube values outlived the 30-day retention rule.
  - The competition count was capped at 50 and mislabelled.
  - Collections could stay stuck as running.
  - Approvals and configuration changes were not audited with details.
  - There was no daily YouTube cap.
  - A niche rename clash returned 500.
- Lead Orchestrator: backend, data, tests, live verification, docs.

## Acceptance criteria (roadmap Phase 02)
| Criterion | Result | Evidence |
|---|---|---|
| Manual and scheduled runs work | PASS | e2e: manual run completes, idempotent per key; `scheduleWeekly` idempotent per ISO week; live runs on real sources |
| Source errors isolated | PASS | e2e: failing Stack Exchange → `partial` with other sources ok; all failing → `failed`; RSS survives one broken feed |
| Duplicate topics handled | PASS | e2e: same URL from HN + RSS merged into one topic with both sources; GitHub clone clusters de-duplicated (live) |
| Every factual metric has provenance | PASS | e2e: zero metrics without source/observed/retrieved; topic evidence endpoint |
| Score explainable | PASS | Breakdown with weights, values, plain-language explanations, confidence, missing components; unit tests verify math |
| Missing/stale data and provider failures tested | PASS | Unit: missing components, stale flags, sparse shrinkage; e2e: provider failures, budget, cap |
| Ledger + budget guard tested | PASS | e2e: exhausted budget skips YouTube; summary owner-only; quota recorded |
| YouTube data expires within 30 days | PASS | e2e: purge deletes metrics and redacts topic values; reports contain no YouTube numbers |
| Dashboard filter/compare/approve | PASS | Web specs (filters, optimistic decisions + rollback, compare 2–4, safe report) |

## Live verification (real sources, 2026-11-15)
5/5 sources ok (HN 89, SO 20, GitHub 29, RSS 15 signals; 15 YouTube checks), 53 topics. The first live runs exposed quality issues that tests had not:
- Hacker News stories were tagged with their search keyword, so they all counted as relevant.
- Star-farmed GitHub clones formed one top-ranked topic.
- Release notes with little data outranked well-evidenced topics.

All three are fixed.

## Git / CI
PR #3: `b841ac0` feature · `d6e5f71` review fixes · `2b2e294` hourly purge + report. GitHub CI 4/4 green on `d6e5f71` and `2b2e294`.

## Tests
API: 87 unit + 53 integration (all pass). Web: 92 (all pass). Lint, strict typecheck, builds clean. gitleaks: no leaks.

## External access used
Public APIs (HN Algolia, Stack Exchange, GitHub search, official feeds) and the user's YouTube Data API key (search.list, ~45 calls total during verification). No OAuth, no uploads, no spend.

## Risks / follow-ups
F-02, F-03, F-06, F-07, F-08 (scoring fairness for unchecked topics), F-09 (DNS pinning), F-10 (atomic daily-cap reservation when workers scale out).
Hacker News via Algolia occasionally takes 30+ s; handled by timeouts and heartbeats.

## Recommendation
**ACCEPT.** All criteria pass with evidence; independent review ACCEPT; CI green (see Git section).
