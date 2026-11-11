# Modular monolith with separate asynchronous workers

The v1 product needs consistent authorization and domain behavior across the web app, REST API, hosted MCP interface, Chrome Saver, and App Extension host, while web capture, media processing, derivative generation, and purge work require asynchronous execution. We will use a TypeScript pnpm workspace containing a Next.js web app, a Fastify REST/MCP service, shared domain contracts, background workers, and the Saver. REST and MCP will call the same domain and authorization services rather than duplicating product behavior.

PostgreSQL is the source of truth for relational records, accepted attempts, idempotency, and audit. S3-compatible storage holds original files, copied media, derivatives, and extension packages. Redis/BullMQ provides queues, rate-limit counters, and ephemeral caching but never owns durable product state. The deployment target is Render for web, API, and workers, with managed PostgreSQL/Redis and Cloudflare R2. Third-party Renderer code runs only in hash-pinned, sandboxed browser iframes on a separate cookieless origin.

## Considered Options

Separate frontend/API services with independent release cycles and a microservice architecture were rejected because v1 needs one consistent domain boundary more than independent service deployment. A Next.js-only backend was rejected to keep long-running MCP, worker, and API concerns outside the web runtime. PostgreSQL-only file storage and a document database were rejected in favor of explicit relational integrity plus object storage.

## Consequences

The workspace must preserve module boundaries despite shared deployment. Web, API, and workers use one container build but scale separately. Local development requires Node 24 LTS, pnpm, and Docker Compose for PostgreSQL, Redis, MinIO, Mailpit, ClamAV, and HTTPS. Contract, RBAC, integration, security, and real-Chromium Saver tests are required because the shared domain services and browser boundaries are central to this choice.
