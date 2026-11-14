# Target Architecture (Initial Proposal)

- Frontend: Angular dashboard
- Backend: NestJS + TypeScript
- Persistence: PostgreSQL + TypeORM
- Queue/cache: Redis + BullMQ
- Rendering: FFmpeg workers
- Storage: S3-compatible object storage
- AI providers: provider interfaces for LLM, research, TTS, image/video generation
- Social: official platform APIs behind adapters
- Runtime: Docker; cloud deployment selected during Phase 00

Core domains:
1. Identity and workspace
2. Channels and integrations
3. Niches and trend research
4. Ideas, scripts, storyboards and review
5. Media assets and production jobs
6. Publishing calendar and publishing jobs
7. Analytics and experiments
8. Budgets, expenses and revenue
9. Workflow orchestration and audit events

Use asynchronous jobs for long-running research, generation, rendering, publishing, and analytics. Persist job state and make operations idempotent.
