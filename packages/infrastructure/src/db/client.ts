import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

export interface Database {
  readonly db: NodePgDatabase<typeof schema>;
  stats(): { total: number; idle: number; waiting: number };
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  connectionString: string;
  onError?: (error: Error) => void;
}

export function createDatabase({ connectionString, onError }: CreateDatabaseOptions): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 2_000,
    statement_timeout: 2_000,
  });

  pool.on('error', (error) => onError?.(error));

  return {
    db: drizzle(pool, { schema }),
    stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    close: () => pool.end(),
  };
}
