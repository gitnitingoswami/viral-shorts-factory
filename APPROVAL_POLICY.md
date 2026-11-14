# Autonomous Execution Policy

The user has selected autonomous operation for this project. The goal is to avoid routine approval prompts while keeping access authenticated, scoped, auditable, and compliant.

## Autonomy after initial setup
Once the user has connected the integrations and approved the project plan, the Lead Orchestrator and specialists may autonomously:
- Read and modify files within this workspace.
- Install project dependencies and run development tools needed for the approved work.
- Create feature branches, commit reviewed changes, and push to the configured repository.
- Run tests, lint, type checks, builds, security scans, and fix failures.
- Continue through phases in sequence after each phase passes its acceptance criteria.
- Use connected Gmail for project-related mail workflows within granted scopes.
- Use connected YouTube for channel research, video uploads, scheduling, and publishing within granted scopes and configured channel settings.
- Monitor analytics and use results to improve later content.
- Maintain an audit log and report completed work.

## Required initial authorization
The user must connect each external account through its official OAuth or supported integration flow. The agent cannot grant itself access or bypass sign-in, consent, MFA, API quotas, account restrictions, or platform policies.

## Account-specific boundaries
### Git
- Autonomous commits and pushes are enabled for the configured project repository after initial setup.
- Use feature branches by default and preserve unrelated user changes.
- Never force-push, rewrite shared history, expose secrets, or push credentials.
- Do not alter repository access, billing, branch protections, or organization settings unless separately authorized.

### Gmail
- The user must connect Gmail and grant the scopes required for the requested workflows.
- The agent may autonomously search, organize, draft, and send project-related messages within those scopes.
- Do not impersonate others, send deceptive or unlawful messages, or conduct unsolicited bulk campaigns.
- Keep a concise audit record of outbound messages (recipient, subject, timestamp, result); avoid retaining unnecessary message content.

### YouTube
- The user must connect the Google/YouTube account and grant the required scopes.
- The agent may autonomously upload, schedule, publish, update metadata, and monitor content within the authorized channel and API capabilities.
- Use the user's configured default channel, visibility, and publishing schedule.
- Do not upload content with unresolved rights, factual, safety, or platform-policy concerns.
- Do not delete videos, change channel ownership/security, or alter account recovery settings.
- Verify upload/publishing status before retrying to avoid duplicate public posts.

## Safety and compliance
- Never store raw passwords, app passwords, refresh tokens, API keys, or private keys in repository files or prompts.
- Use least-privilege OAuth scopes and secure credential storage.
- Do not bypass API restrictions, quotas, platform terms, copyright, privacy, or legal requirements.
- Do not make purchases, sign contracts, spend ad budgets, or change billing settings unless the user has separately configured explicit limits and authorization.
- Pause only when access is missing/expired, a security incident is suspected, an action exceeds granted scope, or a material unresolved risk prevents compliant execution.

## Phase progression
The orchestrator should automatically start the next phase after:
1. All acceptance criteria for the current phase pass.
2. Required tests and security checks pass.
3. The completion report and tracker are updated.
4. No unresolved blocker remains.

If a phase fails, fix it or delegate remediation before progressing. Do not mark a phase complete based only on a subagent's claim.
