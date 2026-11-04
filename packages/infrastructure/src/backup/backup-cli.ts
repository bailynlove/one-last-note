import { notifyFailure } from './alert';
import { runBackup } from './service';
import { createBackupTarget, createS3Client } from './target';

const databaseUrl = process.env.DATABASE_URL;
const bucket = process.env.S3_BUCKET;
if (!databaseUrl || !bucket) {
  console.error(
    JSON.stringify({ event: 'backup.failed', error: 'DATABASE_URL and S3_BUCKET are required' }),
  );
  process.exit(1);
}

const target = createBackupTarget();
const objectClient = createS3Client({
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION ?? 'auto',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

runBackup({
  databaseUrl,
  objectBucket: bucket,
  objectClient,
  target,
  dailyRetention: Number(process.env.BACKUP_DAILY_RETENTION ?? 35),
  weeklyRetention: Number(process.env.BACKUP_WEEKLY_RETENTION ?? 8),
})
  .then((result) => {
    console.log(
      JSON.stringify({
        event: 'backup.completed',
        key: result.key,
        objects: result.manifest.objects.items.length,
        bytes: result.manifest.database.dumpBytes + result.manifest.objects.totalBytes,
        deleted: result.deleted.length,
        elapsedMs: result.elapsedMs,
      }),
    );
  })
  .catch(async (error: unknown) => {
    await notifyFailure('backup.failed', error);
    console.error(
      JSON.stringify({
        event: 'backup.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
