import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error('TURSO_DATABASE_URL is required');
}

if (!authToken) {
  throw new Error('TURSO_AUTH_TOKEN is required');
}

export default defineConfig({
  out: './drizzle',
  schema: './packages/db/src/schema.ts',
  dialect: 'turso',
  dbCredentials: {
    url,
    authToken,
  },
});
