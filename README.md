# one last note

Application foundation for the one last note workspace: a TypeScript modular monolith with a
Next.js web app, a Fastify API, background workers, PostgreSQL, Redis/BullMQ, and S3-compatible
object storage.

The product surface is intentionally empty. This repository currently proves that the foundation
boots, validates its configuration, reports health, and runs in CI.

## Requirements

- Node.js 24 or newer
- pnpm 11 (`corepack enable` uses the pinned `packageManager`)
- Docker with Compose for PostgreSQL, Redis, and S3Mock

## First run

```bash
cp .env.example .env
pnpm install
pnpm services:up
pnpm db:migrate
pnpm storage:init
pnpm dev
```

Open http://localhost:3000 for the status page. The API answers at http://localhost:4000 with
`/health` and `/ready`.

`pnpm services:up` starts PostgreSQL 17, Redis 7.4, and Adobe S3Mock as the local S3-compatible
store on host port 9095. S3Mock stands in for the R2/S3 target because it speaks the same API
without requiring credentials. Deployed environments use Cloudflare R2.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs API, worker, and web together |
| `pnpm build` | Builds the web app |
| `pnpm lint` / `pnpm format` | Checks or rewrites formatting and lint rules |
| `pnpm typecheck` | Type-checks the whole workspace |
| `pnpm test` | Unit tests (no backing services) |
| `pnpm test:integration` | Integration tests against PostgreSQL, Redis, and object storage |
| `pnpm db:generate` | Generates a Drizzle migration from the schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm storage:init` | Creates the configured bucket if it is missing |
| `pnpm smoke` | Boots all three apps and checks health, readiness, and the status page |
| `pnpm services:down` | Stops local backing services |

Integration tests and the smoke test expect `.env` (or the same variables in the environment), running
backing services, and an initialized database and bucket (`pnpm db:migrate && pnpm storage:init`).

## Workspace layout

```
apps/
  api/             Fastify HTTP service: /health, /ready, problem+json errors
  web/             Next.js App Router status page
  worker/          BullMQ worker with a heartbeat scheduler
packages/
  domain/          Framework-free shared types and invariants
  application/     Use cases and error contracts
  infrastructure/  PostgreSQL, Redis, object storage, logging, queues
  config/          Zod-validated environment configuration
```

Dependencies point inward: `apps -> infrastructure -> application -> domain`. The web app only
imports configuration and domain types, never infrastructure.

## Configuration

All environment variables are validated at startup. A bad value stops the process with a readable
message instead of failing later. See `.env.example` for local defaults.

Required for the API and worker: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Optional: `PORT` (4000), `API_HOST` (0.0.0.0),
`S3_REGION`, `S3_FORCE_PATH_STYLE`, `WORKER_CONCURRENCY`, `LOG_LEVEL`, `NODE_ENV`.

The web app reads `API_BASE_URL` (default `http://localhost:4000`) and
`API_REQUEST_TIMEOUT_MS` (default 3000).

## Health and readiness

- `GET /health` on the API and web app is a liveness check.
- `GET /ready` checks PostgreSQL, Redis, and object storage on every request. It returns `200`
  when all three answer and `503` with per-dependency detail when any is unavailable.
- API errors use `application/problem+json`. Responses carry `x-request-id` and
  `cache-control: no-store`.

## Deployment

Build the image from the repository root. One Dockerfile serves all three processes:

```bash
docker build -t one-last-note .
docker run --env-file .env -e APP=api -p 4000:4000 one-last-note
```

Set `APP` to `api`, `worker`, or `web` for each process. On Render, create one service per role,
point each at its managed PostgreSQL, Redis, and Cloudflare R2 credentials, and run
`pnpm db:migrate` as the release command. The storage bucket is created by `pnpm storage:init` or
by the deployment runbook.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, migrations, storage initialization,
integration tests, the web build, and the smoke test against service containers. A clean checkout
must pass every step before merge.
