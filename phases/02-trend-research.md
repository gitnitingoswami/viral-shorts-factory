# Phase 02 — Weekly Trend Research Engine

Build a weekly research pipeline for one configurable content niche initially.

## Sources
Evaluate Google Trends, YouTube Data API, permitted news/RSS sources, and other approved APIs. Verify current official terms, quotas, and access. Do not bypass restrictions or scrape prohibited sources.

## Features
- Niche configuration and weekly/manual research schedule.
- Source adapter interface with source URL, retrieval time, and provenance.
- Deduplication and normalized trend topics.
- Metrics with timestamps and source attribution.
- Explainable score using freshness, growth, relevance, competition, demand signals, and repeatability. Document normalization and missing-data handling.
- Weekly report with evidence and confidence/limitations.
- Angular dashboard to view, filter, compare, and approve topics.

## Suggested entities
ResearchSource, Niche, TrendCollection, TrendTopic, TrendMetric, WeeklyTrendReport.

## Acceptance
A manual run and scheduled run work; source errors are isolated; duplicate topics are handled; every factual metric has provenance; score is explainable; tests cover missing/stale data and provider failures.
