import { drizzle } from 'drizzle-orm/libsql';
import { z } from 'zod';

const databaseEnvSchema = z.object({
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().min(1),
});

export function createDb(env: NodeJS.ProcessEnv = process.env) {
  const config = databaseEnvSchema.parse(env);

  return drizzle({
    connection: {
      url: config.TURSO_DATABASE_URL,
      authToken: config.TURSO_AUTH_TOKEN,
    },
  });
}

export type Database = ReturnType<typeof createDb>;
