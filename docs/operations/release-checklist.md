# Release validation and staged rollout

This checklist implements the no-waiver gates from #15. Every row needs linked, reproducible
evidence. A failed gate blocks progression; do not waive it.

## Hard gates

| Gate | Command / evidence | Required result |
| --- | --- | --- |
| Clean checkout | `pnpm install --frozen-lockfile` | no lockfile change |
| Static checks | `pnpm lint`, `pnpm typecheck` | clean |
| Unit + integration | `pnpm test`, `pnpm test:integration` | all pass |
| Build + wiring | `pnpm build`, `pnpm smoke` | pass |
| RBAC / cross-KB isolation | integration suites (`knowledge-bases`, `relations`, `annotations`, `mcp`, `captures`, `app-extensions`) | no cross-KB read/write; role matrix enforced |
| Security | `pnpm audit --prod`; review auth, capture SSRF, upload scanning, App Extension sandbox | zero critical/high; no known auth bypass |
| MCP scopes / audit | `test/mcp.integration.test.ts` + manual token scope check | read/write scopes enforced; revoked/expired 401; writes audited |
| Real Chromium Saver | `pnpm test:saver` | pass |
| Accessibility | `A11Y_PATHS=/login,/ pnpm a11y` (add `A11Y_SESSION_TOKEN` for authenticated pages) | no critical/serious axe violations; keyboard journey pass |
| 2x expected load | `LOAD_URL=... LOAD_CONCURRENCY=... LOAD_DURATION_SECONDS=... pnpm load-test` | p95 within budget, zero errors at 2x forecast |
| Timed restore | `pnpm restore` in clean environment | counts/objects match; within RTO 4h |
| Alert / rollback rehearsal | deploy previous image, fire test alert, execute rollback | alert delivered; rollback restores service |
| Defects | issue tracker | zero open critical/high |

## Staged rollout

1. **Dogfood — 7 consecutive days.** Internal Users only. Review alerts, defects, usage, and
   recovery readiness daily. Any critical/high defect resets the clock.
2. **Limited beta — 7 consecutive days.** Invited external Users. Track same signals plus support
   load and cross-KB security. Any critical/high defect blocks GA.
3. **GA decision.** Record go/no-go with owner names, evidence links, known risks, rollback image
   digest, and the 24-hour watch plan.

## Rollback

- Keep the previous image digest deployed and pinned.
- Application rollback is a redeploy of that digest; migrations are additive, so do not run a
  destructive down migration during rollback.
- If a migration is incompatible with the previous image, stop writes, restore the last backup into
  a clean database, and follow the rollback decision in the incident channel.
- Rehearse rollback before beta and before GA; record the elapsed time and any manual steps.
