# Phase 01 — Project Foundation

Build the minimal runnable monorepo foundation based on accepted Phase 00 documents.

## Backend
NestJS + TypeScript modules: Auth, Users, Channels, Integrations, Config, Health, Jobs, Audit. Add configuration validation, DTO validation, Swagger, structured logs, health/readiness endpoints, PostgreSQL TypeORM migrations, Redis/BullMQ connection, and baseline tests.

## Frontend
Angular application shell with navigation, authentication screens, dashboard layout, API client/interceptor, loading/error states, and a basic health status view.

## Infrastructure
Docker Compose for local PostgreSQL and Redis; `.env.example` only; `.gitignore`; lint/format/typecheck/test scripts; CI pipeline skeleton.

## Acceptance
- Clean setup documented and reproducible.
- Backend/frontend build.
- DB and Redis health checks work.
- Migration runs on disposable DB.
- Auth baseline and protected route work.
- Frontend can call backend.
- Tests, lint, and type checks pass.
- No secrets committed.
