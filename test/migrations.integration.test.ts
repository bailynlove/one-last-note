import { type Database, runMigrations } from '@oln/infrastructure';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { startTestStack } from './fixtures';

let database: Database | undefined;
let close: (() => Promise<void>) | undefined;

afterAll(async () => {
  await close?.();
});

describe('database migrations', () => {
  it('applies every migration to a fresh database and is idempotent', async () => {
    const stack = await startTestStack();
    database = stack.database;
    close = stack.close;

    const databaseUrl = new URL(stack.config.DATABASE_URL);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseUrl.hostname)) {
      throw new Error(
        `Refusing to drop schemas on non-local database host: ${databaseUrl.hostname}`,
      );
    }

    await database.db.execute(sql`drop schema if exists drizzle cascade`);
    await database.db.execute(sql`drop schema if exists public cascade`);
    await database.db.execute(sql`create schema public`);

    await runMigrations(database);
    await runMigrations(database);

    const tables = await database.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = tables.rows.map((row) => row.table_name);

    expect(names).toEqual(
      expect.arrayContaining([
        'audit_event',
        'users',
        'auth_identities',
        'magic_link_tokens',
        'sessions',
      ]),
    );
    expect(names).not.toContain('notes');

    const columns = await database.db.execute<{ column_name: string; data_type: string }>(
      sql`select column_name, data_type from information_schema.columns where table_name = 'audit_event'`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'actor_user_id',
        'action',
        'subject_type',
        'subject_id',
        'metadata',
        'created_at',
      ]),
    );
  });
});
