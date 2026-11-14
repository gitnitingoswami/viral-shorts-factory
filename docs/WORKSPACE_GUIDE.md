# Nitin AI Engineer + AI Viral Shorts Factory

This is one combined Claude Code workspace. It combines:
- Nitin's general-purpose AI software engineer instructions and task-intake skill.
- The Viral Shorts Factory Lead Orchestrator.
- Ten product phases, specialist agents, templates, tracker, and integration guidance.

## Use it in VS Code

1. Extract this ZIP.
2. Open the extracted `nitin-ai-engineer-viral-shorts` folder in VS Code
   (`File → Open Folder`).
3. Install the official Claude Code VS Code extension and sign in to your Claude account.
4. Open the Claude Code panel. In a terminal, you can also run `claude` if the CLI is installed.
5. Trust the workspace only after reviewing its files.
6. Start a new Claude Code conversation in this folder.
7. Paste the first-run prompt below.

## First-run prompt

Read `CLAUDE.md`, `.claude/agents/lead-orchestrator.md`,
`docs/PHASE_TRACKER.md`, and `docs/INTEGRATIONS_AND_ACCESS.md`.

You are Nitin AI Engineer and the Lead Orchestrator for this workspace.
Inspect the repository and Git status. Prepare the Phase 00 plan for the Viral Shorts
Factory and list the external integrations and OAuth scopes that are missing.
Do not start external actions before the user has connected the required accounts
and authorized the initial setup. Once that setup is complete, operate autonomously:
delegate work, implement, test, fix failures, commit and push to the configured repo,
and proceed through phases when acceptance criteria pass. Report progress and blockers.

## How to use the same engineer for another project/task

Open the target repository as the VS Code folder. Copy/merge the root `CLAUDE.md`
and `.claude/` agent/skill configuration into that repository only after checking for
conflicts. Then give Claude Code your feature, bug, or project description. The
`task-intake` skill provides a structured intake workflow; the Lead Orchestrator
coordinates larger phase-based work.

## Important: the two layers

- `CLAUDE.md` is the single source of project-wide instructions.
- `.claude/agents/` contains specialist agents and the orchestrator.
- `.claude/skills/` contains reusable workflows.
- `phases/` contains the ten Viral Shorts Factory phase prompts.
- `docs/PHASE_TRACKER.md` records phase progress.

Do not copy two separate root `CLAUDE.md` files into one folder. This combined pack
already merges the Nitin engineer role with the project orchestrator instructions.

## Connecting Git, Gmail, and YouTube

Claude Code needs actual integrations/tools for external account actions. Connect them
through supported OAuth/MCP integrations or an approved provider integration.
Then verify connections in Claude Code using `/mcp` (for MCP servers) and test only
the required scopes. The instruction files do not themselves grant access.

- Git: configure your Git remote and credential helper or connect an approved Git provider tool.
- Gmail: connect an authorized Gmail integration with only the scopes needed.
- YouTube: connect Google/YouTube OAuth with the scopes required by the official API.
- Keep credentials outside the repository. Never paste passwords or tokens into prompts.

## Autonomy and permissions

Use Claude Code's Auto permission mode if available in your version, or configure a
reviewed allowlist for common development commands. This reduces routine prompts while
preserving controls. Do not use unrestricted bypass-permissions mode on your everyday
machine. External services still require their own authorization and may enforce consent,
MFA, API quotas, and policy limits.

The AI can autonomously act only through tools it actually has. A written instruction
cannot create Gmail, YouTube, or GitHub access by itself.
