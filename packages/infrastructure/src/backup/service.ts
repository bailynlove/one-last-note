import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { Client } from 'pg';
import {
  BACKUP_PREFIX,
  type BackupManifest,
  type BackupObject,
  backupKeyFor,
  selectRetention,
  sha256File,
  validateManifest,
  verifyDump,
} from './manifest';
import type { BackupTarget } from './target';
import { createS3Client } from './target';

export interface BackupOptions {
  databaseUrl: string;
  objectBucket: string;
  objectClient: ReturnType<typeof createS3Client>;
  target: BackupTarget;
  now?: Date;
  pgDumpPath?: string;
  dailyRetention?: number;
  weeklyRetention?: number;
}

export interface BackupResult {
  key: string;
  manifest: BackupManifest;
  deleted: string[];
  elapsedMs: number;
}

export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const prefix = backupKeyFor(now);
  const work = await mkdtemp(join(tmpdir(), 'oln-backup-'));
  const dumpPath = join(work, 'postgres.dump');

  try {
    const client = new Client({
      connectionString: options.databaseUrl,
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    let tableCounts: Record<string, number>;
    try {
      await client.query('begin isolation level repeatable read');
      const snapshot = await client.query<{ snapshot: string }>(
        'select pg_export_snapshot() as snapshot',
      );
      const snapshotId = snapshot.rows[0]?.snapshot;
      if (!snapshotId) throw new Error('could not export a PostgreSQL snapshot');
      await runCommand(options.pgDumpPath ?? 'pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--snapshot',
        snapshotId,
        '--file',
        dumpPath,
        options.databaseUrl,
      ]);
      tableCounts = await readTableCounts(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      await client.end();
    }
    const dumpBytes = (await stat(dumpPath)).size;
    const dumpSha256 = await sha256File(dumpPath);
    const objects = await listObjects(options.objectClient, options.objectBucket);
    const manifest: BackupManifest = {
      version: 1,
      createdAt: now.toISOString(),
      database: { dumpKey: `${prefix}postgres.dump`, dumpBytes, dumpSha256, tableCounts },
      objects: {
        bucket: options.objectBucket,
        totalBytes: objects.reduce((sum, item) => sum + item.size, 0),
        items: objects,
      },
    };

    await options.target.putFile(manifest.database.dumpKey, dumpPath);
    await options.target.putJson(`${prefix}manifest.json`, manifest);

    const allKeys = (await options.target.list(BACKUP_PREFIX))
      .map((item) => item.key)
      .filter((key) => key.endsWith('/manifest.json'));
    const deleted = selectRetention(
      allKeys,
      now,
      options.dailyRetention ?? 35,
      options.weeklyRetention ?? 8,
    );
    for (const key of deleted) {
      await options.target.deletePrefix(key.replace(/manifest\.json$/, ''));
    }

    return { key: `${prefix}manifest.json`, manifest, deleted, elapsedMs: Date.now() - started };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export interface RestoreOptions {
  databaseUrl: string;
  objectBucket: string;
  objectClient: ReturnType<typeof createS3Client>;
  target: BackupTarget;
  manifestKey?: string;
  pgRestorePath?: string;
}

export async function runRestore(
  options: RestoreOptions,
): Promise<{ manifest: BackupManifest; elapsedMs: number }> {
  const started = Date.now();
  const manifestKey = options.manifestKey ?? (await latestManifestKey(options.target));
  const manifest = validateManifest(await options.target.getJson<unknown>(manifestKey));
  const work = await mkdtemp(join(tmpdir(), 'oln-restore-'));
  const dumpPath = join(work, 'postgres.dump');

  try {
    await options.target.getFile(manifest.database.dumpKey, dumpPath);
    await verifyDump(dumpPath, manifest);
    await runCommand(options.pgRestorePath ?? 'pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--dbname',
      options.databaseUrl,
      dumpPath,
    ]);

    const sourceBucket = manifest.objects.bucket;
    const source = createS3Client({
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      region: process.env.S3_REGION ?? 'auto',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
    const objectDir = join(work, 'objects');
    await mkdir(objectDir, { recursive: true });
    for (const item of manifest.objects.items) {
      const local = join(objectDir, item.key.replace(/[^a-zA-Z0-9._/-]/g, '_'));
      await mkdir(dirname(local), { recursive: true });
      const response = await source.send(
        new GetObjectCommand({ Bucket: sourceBucket, Key: item.key }),
      );
      if (!response.Body) throw new Error(`missing object ${item.key}`);
      await writeFile(local, await response.Body.transformToByteArray());
      await options.objectClient.send(
        new PutObjectCommand({
          Bucket: options.objectBucket,
          Key: item.key,
          Body: await readFile(local),
        }),
      );
    }

    await verifyDatabase(options.databaseUrl, manifest);
    await verifyObjects(options.objectClient, options.objectBucket, manifest);
    return { manifest, elapsedMs: Date.now() - started };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function latestManifestKey(target: BackupTarget): Promise<string> {
  const keys = (await target.list(BACKUP_PREFIX))
    .map((item) => item.key)
    .filter((key) => key.endsWith('/manifest.json'))
    .sort();
  const key = keys.at(-1);
  if (!key) throw new Error('no backups found');
  return key;
}

async function listObjects(
  client: ReturnType<typeof createS3Client>,
  bucket: string,
): Promise<BackupObject[]> {
  const out: BackupObject[] = [];
  let token: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key) {
        out.push({
          key: item.Key,
          size: item.Size ?? 0,
          etag: item.ETag?.replaceAll('"', '') ?? '',
        });
      }
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function readTableCounts(client: Client): Promise<Record<string, number>> {
  {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of rows) {
      const quoted = `"${table.replaceAll('"', '""')}"`;
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from ${quoted}`,
      );
      counts[table] = Number(result.rows[0]?.count ?? 0);
    }
    return counts;
  }
}

async function verifyDatabase(databaseUrl: string, manifest: BackupManifest): Promise<void> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  let counts: Record<string, number>;
  try {
    counts = await readTableCounts(client);
  } finally {
    await client.end();
  }
  for (const [table, expected] of Object.entries(manifest.database.tableCounts)) {
    if (counts[table] !== expected) {
      throw new Error(`table ${table} restored ${counts[table] ?? 0} rows, expected ${expected}`);
    }
  }
}

async function verifyObjects(
  client: ReturnType<typeof createS3Client>,
  bucket: string,
  manifest: BackupManifest,
): Promise<void> {
  const items = await listObjects(client, bucket);
  const sizeByKey = new Map(items.map((item) => [item.key, item.size]));
  for (const item of manifest.objects.items) {
    if (sizeByKey.get(item.key) !== item.size) {
      throw new Error(`object ${item.key} missing or size mismatch after restore`);
    }
  }
}

export function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}
