# one last note

Application foundation for the one last note workspace: a TypeScript modular monolith with a
Next.js web app, a Fastify API, background workers, PostgreSQL, Redis/BullMQ, and S3-compatible
object storage.

The foundation boots, validates its configuration, reports health, and runs in CI. User identity
is the first product-facing slice: magic-link and Google sign-in share one persistent User.

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
  api/             Fastify HTTP service: auth, /health, /ready, problem+json errors
  web/             Next.js App Router workspace, sign-in, and Knowledge Base routes
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

The web app reads `API_BASE_URL` (default `http://localhost:4000`),
`API_REQUEST_TIMEOUT_MS` (default 3000), `WEB_APP_URL` (default `http://localhost:3000`), and
`GOOGLE_CLIENT_ID`.

Set `WEB_APP_URL` to the public web origin. Behind a proxy that sets `X-Forwarded-For`, set
`TRUST_PROXY_HOPS` to the number of trusted hops so auth throttling sees the client IP instead of
the proxy. When the web tier calls the API server-to-server, set the same `AUTH_PROXY_SECRET` on
both services so the web client's IP is forwarded and verified.

## Authentication

Users sign in with a one-time email link or Google. Both paths resolve to the same User when the
verified email matches. Sessions are opaque tokens stored as SHA-256 hashes in PostgreSQL; the web
app keeps one in an HttpOnly `oln_session` cookie, and the API also accepts
`Authorization: Bearer <token>` for clients such as the browser extension.

Magic links expire after 15 minutes and work once. Sessions expire after 30 days and can be revoked
by signing out. Authentication attempts are limited to 5 per 15 minutes per IP.

Email delivery uses Resend when `RESEND_API_KEY` is set. Without it, the API logs the magic-link URL
instead of sending mail, which is enough for local development. Production requires
`RESEND_API_KEY` so links are never written to logs. Google sign-in activates when both
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; register
`${WEB_APP_URL}/auth/google/callback` as the authorized redirect URI.

Auth endpoints: `POST /auth/magic-link`, `POST /auth/magic-link/consume`,
`POST /auth/google/exchange`, `POST /auth/logout`, `GET /auth/me`, and
`POST /auth/extension-token` (mints a bearer session for the current user).

## Knowledge Bases and membership

Any signed-in User can create a Knowledge Base and becomes its sole Owner. Members are Owner,
Manager, or Viewer. Managers can invite and remove Viewers; only the Owner can change elevated
roles, create Join Links, or start an ownership transfer. Transfers expire after 7 days and only
complete when the target Manager accepts, at which point the previous Owner becomes a Manager.

Email invitations expire after 7 days and must be accepted by the signed-in User with the invited
verified email. Join Links are multi-use, Owner-created, valid for 1-30 days, and grant Manager or
Viewer access until revoked.

The web workspace lives at `/`, `/knowledge-bases/new`, `/knowledge-bases/[id]`,
`/invitations/[token]`, `/join/[token]`, and `/ownership-transfers/[id]`. API routes under
`/knowledge-bases`, `/invitations`, `/join-links`, and `/ownership-transfers` back the same
commands.

## Notes and Revisions

Any Member can read Notes in their Knowledge Bases. Managers upload originals; replacing an
original creates an immutable Revision shared by every Knowledge Base the Note is associated with.
The current Revision only advances after quarantine and malware scanning succeed. Rejected attempts
stay visible with a safe diagnostic, but their files cannot be downloaded.

Limits: 25 MB per original, 5 GB of retained Revision data per Knowledge Base (counted once per
association). Accepted originals are PDF, PNG, JPEG, GIF, WebP, Markdown, plain text, and HTML;
archives, encrypted PDFs, mismatched file signatures, and invalid text are rejected. Set
`CLAMAV_HOST` (and optionally `CLAMAV_PORT`) to scan uploads; without it, local development uses a
clean no-op scanner. Production refuses to start without ClamAV. Start the optional local scanner
with `docker compose --profile scanning up -d clamav`.

The web workspace adds Notes to `/knowledge-bases/[id]` and `/notes/[id]`. API routes:
`GET|POST /knowledge-bases/:id/notes`, `GET|PATCH /notes/:id`,
`POST /notes/:id/revisions`, `POST /notes/:id/associations`, and
`GET /notes/:id/revisions/:revisionId/original`.

The focused Reader renders each Ready Revision by type: GFM Markdown (raw HTML is not executed),
sanitized HTML inside a script-free sandboxed frame, PDF pages with selectable text and page/zoom
controls, images, and plain text. Selecting rendered or PDF text captures quote/anchor data for
Annotations. External images, media, and fonts in HTML and Markdown are blocked by default; use
`?assets=1` to load them. Unsupported or failed Revisions show a safe message and keep the
original downloadable. PDF loading and uploads are capped at 60 seconds.

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
by the deployment runbook. Set `CLAMAV_HOST` on the API and worker; the worker is the production
scanning path.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, migrations, storage initialization,
integration tests, the web build, and the smoke test against service containers. A clean checkout
must pass every step before merge. Auth integration tests use the real PostgreSQL and Redis
services; the CI workflow runs them against the same test database after migrations.
