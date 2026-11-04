# Operations runbook

## Limits

| Surface | Limit | Enforcement |
| --- | --- | --- |
| Note upload | 30 per User per hour | Redis counter in `NoteService.upload` (web, API, MCP) |
| Note original | 25 MB | API multipart limit + `NoteService` inspection |
| KB storage | 5 GB retained | `NoteService` quota transaction |
| Web capture | 30 per User per hour, 2 active | `capture_attempts` advisory lock |
| Capture page / media | 5 MB / 10 MB each, 100 MB per Note | safe fetcher + `CaptureService.copyMedia` |
| API requests | 600 per IP per minute | Redis counter in Fastify `onRequest` |
| Agent token | 60 requests and 30 writes per minute | Redis counter keyed by token ID |
| Auth attempts | 5 per IP per 15 minutes | Redis throttle |

Limits return `429` with `retry-after` or a safe `409`/`422` problem response. The same service
code enforces uploads and captures from the UI, Chrome Saver, and MCP; there is no second path.

## Retention

| Data | Retention | Owner |
| --- | --- | --- |
| Trash | 30 days | worker `purgeTrash` hourly |
| Failed capture payloads / failed attempts | 7 days | worker `RetentionService` daily |
| Rejected Revision payloads | 7 days | worker `RetentionService` daily |
| Accepted capture metadata/payloads | 90 days (metadata scrubbed; Note media retained) | worker `RetentionService` daily |
| Audit events | 400 days | worker `RetentionService` daily |
| Expired sessions / magic links / Agent tokens | immediate / 7 days / expiry | worker `RetentionService` daily |
| Application logs | 30 days | Render log retention setting / log drain |
| Metrics | 13 months | Prometheus retention setting |
| Backups | Per recovery policy | #30 |

The retention job deletes storage objects only for rejected/failed payloads and captures that
are already being removed. It never touches a ready Revision still referenced by a Note.

## Metrics and tracing

- API: `GET /metrics` (Prometheus text); set `METRICS_TOKEN` to require
  `Authorization: Bearer <token>`.
- Worker: `http://<worker>:9464/metrics`; `METRICS_PORT` and `METRICS_TOKEN` configure it.
- API requests include `x-request-id` and W3C `traceparent` support. The response carries
  `x-trace-id` so a log line can be correlated with an upstream trace even without an OTel
  exporter.
- Logs are JSON from pino with `service`, `reqId`, `traceId`-correlated headers, queue names,
  and no raw tokens or magic-link secrets.

## Alerts

Load `ops/prometheus/alerts.yml` into the Prometheus/Render alert manager. Thresholds:

- API unavailable for 2 minutes: page.
- 5xx ratio >2% for 5 minutes (warning), >5% for 2 minutes (page).
- p95 API latency >750 ms for 5 minutes (warning), >1.5 s for 2 minutes (page).
- Queue waiting >100 or oldest waiting >5 minutes (warning); failed jobs >10 (page).
- Capture job failure ratio >10% for 15 minutes (warning); >25% for 5 minutes (page).
- Readiness failing for 2 minutes: page.
- PostgreSQL/Redis saturation: use managed-service alerts; a failed readiness check is the
  application-level page.
- Backup/restore failure: #30 runbook; page on any failed restore drill or backup job.

## Dashboards

Import `ops/grafana/dashboard.json`. It charts request rate/errors, p95 latency, queue depth, and
worker outcomes. The runbook owns threshold changes; do not tune alert thresholds silently.

## Incident checklist

1. Check `/ready` and `/metrics` on API and worker.
2. Check queue depth/oldest age and the failing worker logs.
3. Confirm the database and Redis status in the managed provider.
4. If a limit is hot, inspect `api_requests_total` by route/status and the Redis keys for the
   offending User; do not raise limits without an issue.
5. If retention or Trash purge is failing, stop the worker, capture the error, and rerun after
   fixing; object deletion is idempotent.
