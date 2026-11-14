# Phase 08 — Full Automation and Orchestration

Connect the end-to-end workflow with durable state and controlled automation.

## Workflow
Weekly research → trend scoring → idea generation → script/storyboard → asset generation → render → quality checks → human approval or configured bounded autopilot → upload → analytics → next-cycle insights.

## Requirements
- Persist workflow state and transitions.
- Durable job dependencies, retries, timeouts, cancellation, recovery, idempotency, and dead-letter handling.
- Correlation IDs and audit trail across all stages.
- Approval mode is default.
- Autopilot may operate only within explicit channel, content, budget, time, quality, rights, and platform-policy limits.
- Pause and request human review on uncertain factual claims, rights issues, low quality, budget limits, credential problems, policy warnings, or uncertain upload status.
- Notifications for approval, failures, budget thresholds, and completed reports.
- Avoid unnecessary multi-agent complexity; the Lead Orchestrator remains accountable.
- E2E tests use mocked external providers in CI.

## Acceptance
A complete mock workflow runs from research to analytics; restart recovers state; retry does not duplicate external actions; approval gates cannot be bypassed; audit trail is complete.
