# Release validation evidence — 2026-11-04

Status: **NO-GO for general availability.** Local release-candidate gates pass; deployed,
timed, and dogfood/beta gates remain open.

## Candidate

- Branch: `prototype/web-ui`
- Last feature commit: `7a9b9ec` (issue #30)
- Dependency hardening in this validation pass: `drizzle-orm@0.45.4`, PostCSS override
  `8.5.32`; `pnpm audit --prod` reports zero known vulnerabilities.

## Passing local gates

| Gate | Evidence |
| --- | --- |
| Static | `pnpm lint`, `pnpm typecheck` clean |
| Unit | 75 tests / 23 files |
| Integration | 76 tests / 14 files, real PostgreSQL, Redis, S3, MCP SDK, BullMQ |
| Build / smoke | `pnpm build`, `pnpm smoke` pass |
| Real Chromium Saver | `pnpm test:saver` pass (role filtering, duplicate confirmation, recovery) |
| Accessibility (public pages) | `pnpm a11y`: 0 WCAG A/AA violations on `/login` and signed-out `/` |
| Security audit | `pnpm audit --prod`: no known vulnerabilities; cross-KB/RBAC and capture SSRF suites pass |
| Timed restore (local) | 22.4s restore, 20 tables and 1,546 objects verified; API `/ready` 200 on restored DB |
| Load smoke (local) | 20 concurrent `/ready`, 348.1 req/s, p95 91.7ms, 0 errors over 10s |

The local load number is a regression smoke, not the 2x forecast gate. The accessibility run
covers public pages; authenticated workspace/reader/relations/extension pages need a seeded
session and must be included in the deployed gate.

## Open gates (external / time-bound)

- 2x expected-load test against the deployed release candidate with the forecast baseline.
- Full authenticated accessibility audit (workspace, Knowledge Base, reader, relations, App
  Extensions).
- Real R2 backup bucket + managed PostgreSQL PITR restore; regional recovery rehearsal.
- Alert delivery and rollback rehearsal against deployed services.
- 7 consecutive days of dogfooding and 7 consecutive days of limited beta.
- Zero open critical/high defects at the GA decision; no critical/high defects are known today.

## Decision

Do not promote to beta or GA until the open gates have linked evidence and the no-waiver
checklist in `release-checklist.md` is complete. The next required input is a deployed staging
environment, the expected-load baseline, and the dogfood/beta window.
