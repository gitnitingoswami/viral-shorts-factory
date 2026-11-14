# Engineering workflow

1. User submits a task using `tasks/requests/TASK_TEMPLATE.md`.
2. Claude inspects the repository in read-only/Plan mode.
3. Claude produces an approval-ready plan.
4. User reviews, rejects, or requests changes.
5. After explicit approval, Claude implements the approved scope.
6. Claude runs relevant tests and checks.
7. Claude reviews the diff and prepares a delivery report.
8. User reviews the final changes before merge or deployment.

Approval of a plan is not blanket approval for production changes, destructive actions, external communication, or work outside the agreed scope.
