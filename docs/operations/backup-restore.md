# Backup, restore, and regional recovery

## Objectives

| Asset | Recovery point (RPO) | Recovery time (RTO) | Mechanism |
| --- | --- | --- | --- |
| PostgreSQL | 15 minutes | 4 hours | Render managed point-in-time recovery + daily logical backup |
| Note originals and capture media (R2) | 1 hour | 4 hours | R2 versioning/replication + daily object manifest |
| Full regional recovery | 1 hour | 24 hours | replicated backup bucket + documented cutover |

The daily logical backup is the portable recovery point. Managed PostgreSQL PITR covers the
15-minute database RPO between logical backups. R2 versioning/replication covers the one-hour
object RPO; the backup manifest records the exact object keys, sizes, and ETags captured with the
database dump so a restore is internally consistent.

## Schedule and retention

Run the backup as a daily Render Cron Job (03:00 UTC), separate from the API and worker:

```bash
pnpm backup
```

Keep 35 daily and 8 weekly recovery points. `selectRetention` in
`packages/infrastructure/src/backup/manifest.ts` owns the policy; the job applies it only after a
successful dump and upload. A failed job exits non-zero, which triggers Render's cron failure
notification. Set `BACKUP_ALERT_WEBHOOK_URL` to also post a failure event to the operations
webhook.

Backups live in a dedicated bucket with credentials that cannot read or write the application
bucket. Enable R2 audit logging for that bucket and keep its access token in the deployment secret
store, never in application services. Backup reads and restores are audited by the object-store
audit log; the application has no permission to delete backups.

## Required configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Source PostgreSQL database |
| `S3_*` | Source application bucket for the object manifest |
| `BACKUP_S3_BUCKET` / `BACKUP_S3_*` | Separate backup bucket and credentials |
| `BACKUP_DIR` | Local target for drills; defaults to `.backups` |
| `BACKUP_DAILY_RETENTION` / `BACKUP_WEEKLY_RETENTION` | Defaults 35 / 8 |
| `BACKUP_ALERT_WEBHOOK_URL` | Optional failure notification |
| `RESTORE_DATABASE_URL` | Clean target database; never the production URL |
| `RESTORE_S3_BUCKET` | Target bucket for restored objects |
| `RESTORE_CONFIRM=replace` | Explicit destructive-restore guard |
| `RESTORE_S3_*` | Optional separate target credentials |

The runtime image includes `pg_dump` and `pg_restore`. Run the job from the same image as the API
so the PostgreSQL client version matches the managed database.

## Restore drill (quarterly, and before launch)

1. Create a clean PostgreSQL database and an empty target bucket.
2. Select the recovery point (`BACKUP_KEY`; omit it to use the newest manifest).
3. Run the restore and record the emitted `elapsedMs`, table counts, and object count:

```bash
RESTORE_CONFIRM=replace \
RESTORE_DATABASE_URL=postgres://.../restore \
RESTORE_S3_BUCKET=oln-restore \
BACKUP_KEY=backups/.../manifest.json \
pnpm restore
```

The command verifies the dump SHA-256 before touching the target, runs `pg_restore --clean`, copies
every manifest object, then compares every table count and object size with the manifest. It refuses
to run without `RESTORE_CONFIRM=replace`.

4. Spot-check sign-in, a Note download, a Knowledge Base page, and an Extension Renderer in the
restored environment.
5. Record the drill in `docs/operations/backup-drill-<date>.md` with the recovery point, elapsed
time, counts, operator, and any mismatch. A failed or mismatched drill blocks release.

## Regional recovery

Replicate the backup bucket to the recovery region (R2 bucket replication). On a regional failure:

1. Declare the incident and freeze writes.
2. Promote the replicated backup bucket in the recovery region.
3. Create a PostgreSQL instance in the recovery region and restore the newest portable backup; use
   the managed PITR archive if it is available in that region.
4. Restore objects from the replicated bucket into the recovery application bucket.
5. Update DNS and service configuration, then verify `/ready`, `/metrics`, sign-in, Note download,
   and storage access before reopening writes.
6. Reconcile any writes lost after the last recovery point and record the incident timeline.

The 24-hour regional objective is rehearsed at least twice a year. The drill may use a staging
region; production cutover requires an explicit go/no-go and the rollback path in the runbook.

## Monitoring

- Cron failure notification and `BACKUP_ALERT_WEBHOOK_URL` page the on-call operator.
- Treat a missing daily cron success as an incident; the cron failure notification and webhook page the on-call operator.
- Alert on restore verification mismatches; do not retry a mismatched restore blindly.
- Review backup bucket audit logs weekly for unexpected reads, deletes, or credential use.
