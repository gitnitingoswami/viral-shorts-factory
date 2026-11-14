# Viral Shorts Factory

Internal tool for researching, writing, producing, reviewing, publishing and measuring short
programming-tips videos for YouTube Shorts, with human approval at every publishing step.

- Product and architecture: [`docs/PRD.md`](docs/PRD.md), [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md)
- Delivery status: [`docs/PHASE_TRACKER.md`](docs/PHASE_TRACKER.md), [`docs/TASK_TRACKER.md`](docs/TASK_TRACKER.md)
- How the AI engineering team works in this repo: [`CLAUDE.md`](CLAUDE.md), [`docs/WORKSPACE_GUIDE.md`](docs/WORKSPACE_GUIDE.md)

## Repository layout

```
apps/api        NestJS API (src/main.ts) and background worker (src/worker.ts): one codebase, two processes
apps/web        Angular 22 dashboard
libs/contracts  Shared TypeScript API contract used by both apps
infra/docker    Docker Compose (Postgres, Redis, S3-compatible storage), Dockerfiles, nginx config
.github         CI: lint, typecheck, unit tests, build, integration tests, secret scan, dependency audit
```

## Prerequisites

- **Node.js 24.22.3** (see `.nvmrc`; Angular 22 needs ≥ 22.22.3) and npm 11
- **Docker Desktop** running

## Local setup

```bash
nvm use                        # or put Node 24.22.3 first on PATH
npm ci                         # installs all workspaces; native build scripts are allow-listed in package.json
cp .env.example .env           # then edit: set JWT_ACCESS_SECRET and the BOOTSTRAP_OWNER_* pair
npm run infra:up               # Postgres :55432, Redis :56379, S3 storage :8333 (non-default ports avoid clashes)
npm run migration:run          # applies TypeORM migrations to the dev database
```

Generate a JWT secret with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
On first start, the API creates the owner account from `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD`
(only when no users exist). Clear those two values afterwards.

## Run

```bash
npm run start:api      # http://localhost:3100/api   (Swagger: /api/docs when SWAGGER_ENABLED=true)
npm run start:worker   # processes background jobs
npm run start:web      # http://localhost:4200 (proxies /api to :3100)
```

Everything in containers instead: `docker compose -f infra/docker/compose.yaml --profile app up -d --build`
(dashboard on http://localhost:8080).

## Quality checks

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint (API + web), zero warnings allowed |
| `npm run typecheck` | Strict TypeScript for contracts, API and web |
| `npm test` | API unit tests (Jest) + web unit tests (Vitest) |
| `npm run test:e2e` | API integration tests against the disposable `vsf_test` DB: migrations up/down/up, auth, roles, jobs + worker, audit, rate limiting. Needs `npm run infra:up` |
| `npm run test:cov -w @vsf/api` | Unit + integration with coverage |
| `npm run build` | Production builds of all packages |

Integration tests only ever reset a database whose name ends in `_test`.

## Security notes

- Secrets live only in `.env` locally (git-ignored) and in a secret manager in production. Never commit them.
- Access tokens are kept in memory in the browser. Refresh tokens are HttpOnly, `SameSite=Strict` cookies, rotated on
  every use, and replaying an old one revokes the whole session family.
- Every authenticated mutating request and every login/logout/refresh-reuse event is written to an append-only audit log.
