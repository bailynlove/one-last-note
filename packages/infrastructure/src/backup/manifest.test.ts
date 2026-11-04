import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BackupManifest,
  backupKeyFor,
  selectRetention,
  validateManifest,
  verifyDump,
} from './manifest';

const work: string[] = [];
async function tempFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oln-manifest-'));
  work.push(dir);
  const path = join(dir, 'dump');
  await writeFile(path, content);
  return path;
}

afterEach(async () => {
  await Promise.all(work.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const manifest: BackupManifest = {
  version: 1,
  createdAt: '2026-11-04T00:00:00.000Z',
  database: {
    dumpKey: 'backups/2026-11-04T00-00-00-000Z/postgres.dump',
    dumpBytes: 3,
    dumpSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    tableCounts: { notes: 2, users: 1 },
  },
  objects: { bucket: 'notes', totalBytes: 3, items: [{ key: 'a', size: 3, etag: 'x' }] },
};

describe('backup manifest', () => {
  it('builds stable keys and validates a manifest', () => {
    expect(backupKeyFor(new Date('2026-11-04T01:02:03.456Z'))).toBe(
      'backups/2026-11-04T01-02-03-456Z/',
    );
    expect(validateManifest(manifest).database.tableCounts.notes).toBe(2);
    expect(() =>
      validateManifest({ ...manifest, objects: { ...manifest.objects, totalBytes: 4 } }),
    ).toThrow('total');
  });

  it('verifies dump bytes and checksum', async () => {
    const path = await tempFile('abc');
    await expect(verifyDump(path, manifest)).resolves.toBeUndefined();
    await writeFile(path, 'abd');
    await expect(verifyDump(path, manifest)).rejects.toThrow('checksum');
  });

  it('keeps 35 daily and 8 weekly manifests', () => {
    const now = new Date('2026-11-04T00:00:00Z');
    const keys = Array.from({ length: 50 }, (_, index) => {
      const date = new Date(now.getTime() - index * 86_400_000);
      return `${backupKeyFor(date)}manifest.json`;
    });
    const deleted = selectRetention(keys, now, 35, 8);
    const kept = keys.filter((key) => !deleted.includes(key));
    expect(kept.length).toBeLessThanOrEqual(43);
    expect(kept).toContain(keys[0]);
    expect(deleted.length).toBeGreaterThan(0);
  });
});
