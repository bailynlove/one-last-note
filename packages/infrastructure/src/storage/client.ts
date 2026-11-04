import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface ObjectStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class ObjectStorage {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      maxAttempts: 1,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async headBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(2_000),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.headBucket();
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }

      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(2_000),
      });
    }
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
  }

  async getObject(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    if (!response.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return response.Body.transformToByteArray();
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
  }

  destroy(): void {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
    return true;
  }

  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode === 404;
}
