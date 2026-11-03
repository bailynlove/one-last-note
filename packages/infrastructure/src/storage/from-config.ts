import type { ServerConfig } from '@oln/config';
import { ObjectStorage } from './client';

export function objectStorageFromConfig(config: ServerConfig): ObjectStorage {
  return new ObjectStorage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}
