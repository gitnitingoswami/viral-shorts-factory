# Phase 06 — Analytics and Performance

Collect only metrics available through authorized official APIs or explicit imports.

## Features
- Scheduled metric snapshots and manual refresh.
- Views, likes, comments, shares, watch time, average view duration, retention, subscribers, and revenue only where the provider actually exposes them.
- Clearly label unavailable, delayed, estimated, or imported metrics.
- Document metric definitions and time windows.
- AI performance insights must cite the metrics used and distinguish correlation from causation.
- Content experiments and comparison across hooks, topics, lengths, and formats.
- Angular channel/video dashboards with date filters and export.

## Suggested entities
VideoMetricSnapshot, ChannelMetricSnapshot, PerformanceReport, ContentExperiment, PerformanceInsight.

## Acceptance
Metrics are not fabricated; timestamps and source are stored; refresh jobs are retry-safe; calculations are tested; insights are evidence-linked and caveated.
