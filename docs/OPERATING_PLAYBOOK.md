# Operating Playbook

## Daily working loop
1. Start `/start-phase`.
2. Review the plan and approve or request changes.
3. Orchestrator delegates bounded tasks to specialists.
4. Specialists return code, tests, and evidence.
5. Orchestrator integrates, tests, and reviews.
6. Run `/verify-phase`.
7. Review completion report and approve or return for fixes.
8. Only after approval, run `/handoff` and plan the next phase.

## If a specialist fails
The Lead Orchestrator should:
- identify the exact failing acceptance criterion,
- provide a minimal reproducible defect and relevant context,
- reassign to the same or another specialist,
- prevent unrelated scope expansion,
- rerun regression tests after fixes.

## If blocked by credentials or provider access
Do not invent credentials or switch to unofficial scraping. Mark the task BLOCKED, explain the required OAuth integration/scope, and continue only with mocked adapters where useful.

## If Git work is requested
Review user changes first. Keep unrelated changes untouched. Use feature branches and clear commits. Ask before push/merge. Never force-push.

## If Gmail work is requested
Draft first. Before sending, display the complete message and request approval.

## If YouTube publishing is requested
Use test/private mode first. Before public publishing, display all metadata and request approval. Verify upload status after the API call.
