# Backup restore drill record — 2026-11-04

- Date: 2026-11-04
- Recovery point: `backups/2026-11-04T15-07-06-930Z/manifest.json`
- Source database / object bucket: local PostgreSQL and S3Mock application bucket
- Target database / object bucket: clean PostgreSQL 17.11 container on port 55432; same S3Mock bucket
- Operator: automated local drill (release-candidate validation)
- Started at / completed at: 15:07 UTC / 15:08 UTC
- Backup elapsed (`elapsedMs`): 2,483 ms
- Elapsed restore (`elapsedMs`): 22,438 ms
- Table counts verified: yes (20 tables)
- Object count and sizes verified: yes (1,546 objects, 425,706 bytes in the manifest)
- Application spot checks: API `/ready` 200 on the restored database; `/auth/me` 401 without a
  session; restored counts and object sizes matched the manifest
- Mismatches or follow-ups: none. The local drill uses S3Mock and a local object target; the
  production drill must use the dedicated backup bucket, managed PostgreSQL PITR, and R2
  replication.
- Go/no-go: local restore path passes. Production/pre-launch drill remains an external dependency
  tracked by #30.
