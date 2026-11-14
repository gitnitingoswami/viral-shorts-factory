# How the two systems work together

**Nitin AI Engineer** is the general engineering identity, standards, and task intake.
**Lead Orchestrator** is the project manager for the Viral Shorts Factory and phase sequence.
**Specialist agents** do bounded backend, frontend, database, QA, security, review, and DevOps tasks.
**Claude Code** is the runtime that reads the instructions, invokes tools, edits files, runs commands, and delegates to subagents.
**MCP integrations** provide external capabilities such as GitHub, Gmail, or YouTube when connected and authorized.

There is one root `CLAUDE.md` to avoid conflicting instructions. The project orchestrator owns phase tracking; the generic task-intake skill handles unrelated feature and bug requests.
