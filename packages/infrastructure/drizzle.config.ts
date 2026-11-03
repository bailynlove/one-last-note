import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://one_last_note:one_last_note@localhost:5432/one_last_note',
  },
  strict: true,
  verbose: true,
});
