# Phase 02 Plan: Weekly Trend Research Engine

**Started:** 2026-11-15 · **Branch:** `phase-02/trend-research` · **Gate:** auto-accept on passing criteria (user pre-approval)

## Scope (from `phases/02-trend-research.md`, `docs/AI_ARCHITECTURE.md` §5, `docs/DEVELOPMENT_ROADMAP.md`)
1. **Prerequisite follow-ups:** F-01 job lease (before side-effecting jobs), F-04 JWT iss/aud test, F-05 web 401-after-refresh.
2. **Data model (migration):** niche, content_strategy, research_source, trend_collection, raw_signal, trend_topic,
   trend_topic_signal, trend_metric, weekly_trend_report; expense_record + budget (ledger and budget guard land in Phase 02).
3. **Source adapters** behind a `ResearchSource` interface, each with provenance (URL, retrieved_at, terms note):
   Hacker News (public), Stack Exchange (public), GitHub search (optional token), RSS release feeds (allowlisted hosts,
   SSRF guard), YouTube `search.list` (API key; mock until provided). Every adapter has recorded fixtures for CI.
4. **Pipeline jobs:** manual run + weekly cron (BullMQ repeatable); per-source isolation (one failure doesn't fail the run);
   dedup (normalized title + `pg_trgm`); deterministic, explainable scoring with confidence and missing components;
   stale (>14 d) flags; 30-day expiry of YouTube data about other channels.
5. **Weekly report** with evidence links and limitations.
6. **API + Angular:** niche config, run research now, collections list, topic table with filter/compare, score breakdown, approve/reject.
7. **Tests:** missing/stale data, provider failures and timeouts, duplicates, scoring math, idempotent runs, SSRF guard, budget guard.

## External access
| Need | Status | Effect if missing |
|---|---|---|
| YouTube Data API key (GCP project) | **Not provided** | YouTube competition signal uses mock data; the component is reported as "missing" in live runs |
| GitHub read-only token | Optional | Lower rate limit (unauthenticated) |
| Anthropic API key | Not needed (LLM topic labeling is optional) | Deterministic clustering only |

## Acceptance (roadmap Phase 02)
Manual and scheduled runs work; source errors isolated; duplicates merged; every metric has provenance; scores
explainable (breakdown, confidence, missing components); tests cover missing/stale data and provider failures;
ledger and budget guard exist and are tested; YouTube-derived data expires within 30 days; dashboard filter/compare/approve works.
