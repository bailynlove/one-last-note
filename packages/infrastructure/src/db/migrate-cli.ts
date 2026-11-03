import { loadServerConfig } from '@oln/config';
import { createLogger } from '../logging';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

let config: ReturnType<typeof loadServerConfig>;

try {
  config = loadServerConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger({ service: 'migrate', level: config.LOG_LEVEL });
const database = createDatabase({ connectionString: config.DATABASE_URL });

try {
  await runMigrations(database);
  logger.info('database migrations applied');
} catch (error) {
  logger.error({ err: error }, 'database migration failed');
  process.exitCode = 1;
} finally {
  await database.close();
}
