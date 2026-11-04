import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const BACKUP_VERSION = 1;
export const BACKUP_PREFIX = 'backups/';

export interface BackupObject {
  key: string;
  size: number;
  etag: string;
}

export interface BackupManifest {
  version: typeof BACKUP_VERSION;
  createdAt: string;
  database: {
    dumpKey: string;
    dumpBytes: number;
    dumpSha256: string;
    tableCounts: Record<string, number>;
  };
  objects: {
    bucket: string;
    totalBytes: number;
    items: BackupObject[];
  };
}

export function backupKeyFor(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${BACKUP_PREFIX}${stamp}/`;
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export async function verifyDump(path: string, manifest: BackupManifest): Promise<void> {
  const info = await stat(path);
  if (info.size !== manifest.database.dumpBytes) {
    throw new Error(
      `dump size mismatch: expected ${manifest.database.dumpBytes}, got ${info.size}`,
    );
  }
  const digest = await sha256File(path);
  if (digest !== manifest.database.dumpSha256) {
    throw new Error(
      `dump checksum mismatch: expected ${manifest.database.dumpSha256}, got ${digest}`,
    );
  }
}

export function validateManifest(input: unknown): BackupManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest must be an object');
  const manifest = input as Partial<BackupManifest>;
  if (manifest.version !== BACKUP_VERSION) throw new Error('unsupported manifest version');
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('manifest createdAt is invalid');
  }
  const database = manifest.database;
  if (
    !database ||
    typeof database.dumpKey !== 'string' ||
    !Number.isSafeInteger(database.dumpBytes) ||
    database.dumpBytes <= 0 ||
    typeof database.dumpSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(database.dumpSha256) ||
    !database.tableCounts ||
    typeof database.tableCounts !== 'object'
  ) {
    throw new Error('manifest database section is invalid');
  }
  for (const count of Object.values(database.tableCounts)) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('manifest table count is invalid');
  }
  const objects = manifest.objects;
  if (!objects || typeof objects.bucket !== 'string' || !Array.isArray(objects.items)) {
    throw new Error('manifest objects section is invalid');
  }
  let total = 0;
  for (const item of objects.items) {
    if (typeof item.key !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0) {
      throw new Error('manifest object entry is invalid');
    }
    total += item.size;
  }
  if (total !== objects.totalBytes) throw new Error('manifest object total does not match entries');
  return manifest as BackupManifest;
}

/**
 * Keeps every backup from the last `dailyDays`, then one backup per ISO week for
 * up to `weeklyCount` older weeks. Returns the manifest keys to delete.
 */
export function selectRetention(
  keys: readonly string[],
  now: Date,
  dailyDays = 35,
  weeklyCount = 8,
): string[] {
  const dated = keys
    .map((key) => {
      const match = /^backups\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\/manifest\.json$/.exec(
        key,
      );
      if (!match?.[1]) return null;
      const createdAt = new Date(
        match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'),
      );
      if (Number.isNaN(createdAt.getTime())) return null;
      return { key, createdAt };
    })
    .filter((item): item is { key: string; createdAt: Date } => item !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const weeklyKept = new Set<string>();
  const remove: string[] = [];
  for (const item of dated) {
    const ageDays = (now.getTime() - item.createdAt.getTime()) / 86_400_000;
    if (ageDays <= dailyDays) continue;
    const week = isoWeek(item.createdAt);
    if (weeklyKept.size < weeklyCount && !weeklyKept.has(week)) {
      weeklyKept.add(week);
      continue;
    }
    remove.push(item.key);
  }
  return remove;
}

function isoWeek(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
