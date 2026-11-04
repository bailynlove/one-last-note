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

## Chrome Saver

`apps/saver` is the Manifest V3 extension. It connects with an authorization code + PKCE flow, saves the readable page or the selected passage into a Knowledge Base where the signed-in User is Owner or Manager, warns before an intentional duplicate, and recovers an attempt after the popup closes. Set `SAVER_EXTENSION_ID` to the unpacked/published extension ID so authorization codes cannot be redirected to another extension. See `apps/saver/README.md` for loading and manual verification; `pnpm test:saver` runs the mocked Chromium popup flow.

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
`POST /auth/extension-token` (mints a bearer session for the current user). The Chrome Saver uses
`POST /auth/extension/authorize`, `POST /auth/extension/exchange` (with `redirectUri`),
`POST /auth/extension/refresh`, and `POST /auth/extension/revoke`.

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

## Sharing and Trash

Managers share a Note into another Knowledge Base they manage. Removing an association moves it to
that Knowledge Base's Trash for 30 days; other associations keep the Note and its Revisions
available. Trashed associations and deleted Knowledge Bases are purged automatically by the worker
after 30 days, and stored objects are deleted only when no association retains them.

Only the Owner can delete a Knowledge Base. Deletion preserves memberships and shared Notes, revokes
Invitations and Join Links, and makes the Knowledge Base unavailable until restored. Notes without
any remaining association become inaccessible immediately and are purged with their objects after
30 days. Every trash, restore, and purge writes an `audit_event`.

API routes: `DELETE /knowledge-bases/:id`, `POST /knowledge-bases/:id/restore`,
`GET /knowledge-bases/deleted`, `GET /knowledge-bases/:id/trash`,
`DELETE /knowledge-bases/:id/notes/:noteId/association`, and
`POST /knowledge-bases/:id/notes/:noteId/restore`. The web workspace exposes Trash under each
Knowledge Base and at `/knowledge-bases/trash`.

## Comments and Marks

Every Annotation belongs to one Knowledge Base and points at the Revision where it was created.
Comments carry text; the built-in `core/highlight` Mark captures a selection without text. Text
Anchors store the exact quote plus surrounding context and offsets; PDF Anchors store the page and a
normalized region. When a Note advances, unique text passages are re-anchored automatically;
ambiguous or PDF passages are flagged for review instead of being moved silently.

Annotations are visible only inside their Knowledge Base. Replies are one level deep. Authors can
edit or delete their own Comments; Owners and Managers can delete any Annotation. Deleting a root
Comment that has replies keeps a tombstone. API routes:
`GET|POST /knowledge-bases/:id/notes/:noteId/annotations`,
`POST /knowledge-bases/:id/notes/:noteId/annotations/:annotationId/replies`,
and `PATCH|DELETE /knowledge-bases/:id/notes/:noteId/annotations/:annotationId`.

## Web capture

Managers can capture a public page or a selected passage into a Knowledge Base. Capture runs as an
asynchronous job, stores the readable HTML as a normal immutable Revision, and keeps the source URL,
canonical URL, site name, and capture time with the Note. Pages are limited to public HTTP(S), with
DNS and redirect checks that block private networks. Images are limited to 10 MB each and 100 MB per
Note; page HTML is limited to 5 MB and the whole job is capped at 60 seconds.

Capture attempts are rate-limited to 30 per User per hour and 2 active attempts per User. Duplicate
canonical URLs are warned about but still captured; repeated requests with the same `Idempotency-Key`
return the original attempt. API routes:
`POST /knowledge-bases/:id/captures`, `GET /captures/:id`, `POST /captures/:id/retry`, and
`GET /capture-media/:attemptId/:filename`.

## Note Relations

Owners and Managers can connect Notes inside one Knowledge Base with manual relations: Related to (symmetric), References (directed), and Supersedes (newer to older). Cycles and different labels between the same pair are allowed; self-links and duplicate pairs are rejected. Viewers can explore relations.

Content references are derived from explicit app Note links (`/notes/<id>`) in Markdown and sanitized HTML. They stay attached to the source Revision and resolve only when both Notes belong to the same Knowledge Base. Changing a Revision changes only its content references; manual relations persist.

The Knowledge Base header and Note page link to `/knowledge-bases/[id]/relations`. The Relation page offers a graph with an inspector and an equivalent accessible list, URL-backed filters and selection, isolated Notes, and expandable clusters for large graphs. Filters cover title, relation type, origin, and current/all revisions. Content references are derived on read from the selected Revisions; graphs are capped at 200 Notes and 500 content references. Content-reference derivation is synchronous and will move to a background index when large Knowledge Bases make it the dominant cost.

API:

```text
GET    /knowledge-bases/:id/relations?revision=current|all|<revisionId>&type=&origin=&q=
POST   /knowledge-bases/:id/relations
DELETE /knowledge-bases/:id/relations/:relationId
```

## App Extensions

Owners and Managers can install pinned App Extension packages for one Knowledge Base at `/knowledge-bases/[id]/extensions`. A package is a strict manifest plus text files: namespaced ID, semantic version, API version, publisher, Renderer contributions (extensions, MIME types, entry), Mark contributions, and declared permissions. The host shows the package SHA-256 and keeps every version installable, so an update can be reviewed and rolled back without touching other Knowledge Bases.

Third-party Renderer code runs in a sandboxed iframe with an opaque origin (`sandbox="allow-scripts"`), no cookies/storage/DOM access, and a CSP that blocks network, frames, forms, and external assets. The host sends the selected Revision bytes through `postMessage`; the extension can report navigation, height, diagnostics, and Anchor candidates back. Renderer failure or a missing package falls back to the built-in renderer or original download. Installation, enable/disable, rollback, and removal require a Manager or Owner; Viewers can use installed Renderers.

### Mark registry

Every Knowledge Base exposes `GET /knowledge-bases/:id/mark-types`. The response is host-generated and contains the built-in `core/highlight` definition plus the Mark types from the enabled App Extension versions. Each descriptor includes its label, JSON payload schema, default payload, source, extension ID/version, and supported operations, so the hosted MCP server can discover custom Marks without an extension running its own server.

Annotations store the Mark type and validated payload. If an extension is disabled, removed, downgraded, or its schema changes, existing annotations are still returned with their original type and payload; clients show a type fallback instead of discarding data. New writes are validated against the currently enabled definition.

API:

```text
GET    /knowledge-bases/:id/extensions
GET    /knowledge-bases/:id/mark-types
POST   /knowledge-bases/:id/extensions
PATCH  /knowledge-bases/:id/extensions/:installationId
DELETE /knowledge-bases/:id/extensions/:installationId
```

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
