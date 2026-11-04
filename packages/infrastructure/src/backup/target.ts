import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface BackupTarget {
  putFile(key: string, path: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  getFile(key: string, path: string): Promise<void>;
  getJson<T>(key: string): Promise<T>;
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  deletePrefix(prefix: string): Promise<void>;
}

export class LocalBackupTarget implements BackupTarget {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const root = resolve(this.root);
    const target = resolve(root, key);
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw new Error('invalid backup key');
    return target;
  }

  async putFile(key: string, path: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(path, target);
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value, null, 2));
  }

  async getFile(key: string, path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await readFile(this.pathFor(key)));
  }

  async getJson<T>(key: string): Promise<T> {
    return JSON.parse(await readFile(this.pathFor(key), 'utf8')) as T;
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const root = this.pathFor(prefix);
    const out: { key: string; size: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push({ key: relative(this.root, full), size: (await stat(full)).size });
      }
    };
    await walk(root);
    return out;
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.pathFor(prefix), { recursive: true, force: true });
  }
}

export class S3BackupTarget implements BackupTarget {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putFile(key: string, path: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: (await stat(path)).size,
      }),
    );
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  async getFile(key: string, path: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`backup object ${key} has no body`);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(path));
  }

  async getJson<T>(key: string): Promise<T> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`backup object ${key} has no body`);
    return JSON.parse(await response.Body.transformToString()) as T;
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key) out.push({ key: item.Key, size: item.Size ?? 0 });
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deletePrefix(prefix: string): Promise<void> {
    const keys = await this.list(prefix);
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000).map((item) => ({ Key: item.key }));
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch, Quiet: true } }),
      );
    }
  }
}

export function createBackupTarget(env: NodeJS.ProcessEnv = process.env): BackupTarget {
  if (env.BACKUP_S3_BUCKET) {
    return new S3BackupTarget(
      createS3Client({
        endpoint: env.BACKUP_S3_ENDPOINT,
        accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
        region: env.BACKUP_S3_REGION ?? 'auto',
        forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === 'true',
      }),
      env.BACKUP_S3_BUCKET,
    );
  }
  return new LocalBackupTarget(env.BACKUP_DIR ?? '.backups');
}

export function createS3Client(options: {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  forcePathStyle?: boolean;
}): S3Client {
  return new S3Client({
    region: options.region ?? 'auto',
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? false,
    credentials:
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined,
  });
}
