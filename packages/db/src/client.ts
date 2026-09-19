import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { z } from 'zod';

import * as schema from './schema.js';

const databaseEnvSchema = z.object({
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().min(1),
});

export function createDb(env: NodeJS.ProcessEnv = process.env) {
  const config = databaseEnvSchema.parse(env);
  const client = createClient({
    url: config.TURSO_DATABASE_URL,
    authToken: config.TURSO_AUTH_TOKEN,
  });

  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDb>;
