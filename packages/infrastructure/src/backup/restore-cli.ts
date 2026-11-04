import { notifyFailure } from './alert';
import { runRestore } from './service';
import { createBackupTarget, createS3Client } from './target';

const databaseUrl = process.env.RESTORE_DATABASE_URL;
const bucket = process.env.RESTORE_S3_BUCKET;
if (!databaseUrl || !bucket) {
  console.error(
    JSON.stringify({
      event: 'restore.failed',
      error: 'RESTORE_DATABASE_URL and RESTORE_S3_BUCKET are required',
    }),
  );
  process.exit(1);
}
if (process.env.RESTORE_CONFIRM !== 'replace') {
  console.error(
    JSON.stringify({
      event: 'restore.refused',
      error: 'set RESTORE_CONFIRM=replace to allow pg_restore --clean into the target database',
    }),
  );
  process.exit(1);
}

runRestore({
  databaseUrl,
  objectBucket: bucket,
  objectClient: createS3Client({
    endpoint: process.env.RESTORE_S3_ENDPOINT ?? process.env.S3_ENDPOINT,
    accessKeyId: process.env.RESTORE_S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.RESTORE_S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.RESTORE_S3_REGION ?? process.env.S3_REGION ?? 'auto',
    forcePathStyle:
      (process.env.RESTORE_S3_FORCE_PATH_STYLE ?? process.env.S3_FORCE_PATH_STYLE) === 'true',
  }),
  target: createBackupTarget(),
  manifestKey: process.env.BACKUP_KEY,
})
  .then((result) => {
    console.log(
      JSON.stringify({
        event: 'restore.completed',
        createdAt: result.manifest.createdAt,
        tableCounts: result.manifest.database.tableCounts,
        objects: result.manifest.objects.items.length,
        elapsedMs: result.elapsedMs,
      }),
    );
  })
  .catch(async (error: unknown) => {
    await notifyFailure('restore.failed', error);
    console.error(
      JSON.stringify({
        event: 'restore.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
