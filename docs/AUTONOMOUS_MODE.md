# Autonomous Mode

This project pack is configured for autonomous execution after initial setup.

The AI team should not ask for routine approval to:
- implement planned project work,
- delegate to specialists,
- fix test failures,
- run normal development commands,
- commit and push project code to the configured remote,
- proceed to the next phase after acceptance checks pass,
- perform authorized project-related Gmail and YouTube workflows.

The user still needs to connect accounts through official OAuth/integration flows and grant the scopes required. This configuration cannot create account access by itself.

The system must preserve audit logs, use secure secret storage, respect platform rules and API limits, and pause only for missing access, security incidents, out-of-scope actions, or unresolved material risk.
