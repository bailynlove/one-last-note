import { loadServerConfig } from '@oln/config';
import { createLogger } from '../logging';
import { objectStorageFromConfig } from './from-config';

let config: ReturnType<typeof loadServerConfig>;

try {
  config = loadServerConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger({ service: 'storage-init', level: config.LOG_LEVEL });
const storage = objectStorageFromConfig(config);
const attempts = 40;

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await storage.ensureBucket();
      logger.info({ bucket: storage.bucket }, 'object storage ready');
      break;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
} catch (error) {
  logger.error({ err: error, bucket: storage.bucket }, 'object storage unavailable');
  process.exitCode = 1;
} finally {
  storage.destroy();
}
