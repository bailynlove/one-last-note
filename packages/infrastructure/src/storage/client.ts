import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

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
