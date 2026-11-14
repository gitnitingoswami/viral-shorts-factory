# Engineering standards

Use the standards already established by the target repository first.

General expectations:
- TypeScript strictness and existing lint/format rules should be respected.
- Validate external input at system boundaries.
- Enforce authorization on protected operations.
- Keep secrets in approved secret stores/environment configuration.
- Use database transactions for multi-step changes that must be atomic.
- Add tests for changed behavior and important edge cases.
- Keep changes focused and reviewable.
- Document operationally significant configuration and migration changes.
