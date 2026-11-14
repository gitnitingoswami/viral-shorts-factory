# Integrations and Account Access

## General
Use official APIs and provider-supported OAuth flows. The user authorizes access in the provider's consent screen. The application receives scoped credentials through the integration; the agent should not ask for account passwords.

## Gmail
Possible capabilities depend on the connected integration and granted scopes. Start with the minimum required:
- Read/search only if the workflow genuinely needs it.
- Draft messages before enabling send.
- Request the send scope only when the user explicitly wants sending.
- Before sending, show recipient, subject, complete body, attachments, and account identity for approval.
- Do not send bulk outreach, impersonate the user, or send unsolicited messages.
- Keep an audit log without storing message contents unnecessarily.

## YouTube / Google
Use Google OAuth and official YouTube Data API documentation. Verify current API capabilities, quota costs, channel permissions, upload behavior, and policy requirements.
- Start with channel read/analytics permissions where possible.
- Request upload permissions only for the publishing phase.
- Test on a dedicated channel or with private/unlisted uploads.
- Before a public upload, show title, description, tags, visibility, thumbnail, target channel, and schedule.
- Require approval for public publishing by default.
- Verify upload state before retrying to avoid duplicate videos.

## Git hosting
Use the user's configured Git credential helper or an approved GitHub/GitLab integration. Never request a personal access token in chat.
- Use a feature branch.
- Inspect `git diff` and `git status` before staging.
- Check for secrets and unintended files.
- Commit with a clear message after approval.
- Push only after approval.
- Never force-push or push directly to protected branches.

## Configuration
Create `.env.example` with variable names and placeholder values only. Add `.env`, token files, credential exports, private keys, and local OAuth caches to `.gitignore`.
