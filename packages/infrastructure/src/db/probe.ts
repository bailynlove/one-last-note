import type { Probe } from '@oln/application';
import { sql } from 'drizzle-orm';
import type { Database } from './client';

export function databaseProbe(database: Database): Probe {
  return {
    name: 'database',
    check: async () => {
      await database.db.execute(sql`select 1`);
    },
  };
}
