import 'dotenv/config';

import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const env = z
  .object({
    TURSO_DATABASE_URL: z.string().url().or(z.string().startsWith('libsql://')),
    TURSO_AUTH_TOKEN: z.string().min(1),
  })
  .parse(process.env);

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const expectedTables = [
  'experiments',
  'feature_snapshots',
  'jev_evaluations',
  'outcomes',
  'strategy_signals',
] as const;

async function main() {
  const ping = await client.execute('SELECT 1 AS ok');
  if (Number(ping.rows[0]?.ok) !== 1) {
    throw new Error('Turso ping failed');
  }

  const tableResult = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  const existingTables = new Set(tableResult.rows.map((row) => String(row.name)));
  const missingTables = expectedTables.filter((table) => !existingTables.has(table));

  if (missingTables.length > 0) {
    throw new Error(
      `Database connection succeeded, but schema is incomplete. Missing: ${missingTables.join(', ')}. Run npm run db:push first.`,
    );
  }

  const id = `smoke-${randomUUID()}`;
  const now = Date.now();

  try {
    await client.execute({
      sql: `
        INSERT INTO experiments (
          id,
          created_at,
          name,
          status,
          strategy_version,
          feature_version,
          prompt_version,
          model_version,
          cost_model_version,
          configuration_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        now,
        'JMScore DB smoke test',
        'draft',
        'smoke-v1',
        'smoke-v1',
        null,
        null,
        'smoke-v1',
        '{}',
      ],
    });

    const readBack = await client.execute({
      sql: 'SELECT id, name FROM experiments WHERE id = ? LIMIT 1',
      args: [id],
    });

    if (readBack.rows.length !== 1 || readBack.rows[0]?.id !== id) {
      throw new Error('Smoke-test row could not be read back');
    }
  } finally {
    await client.execute({
      sql: 'DELETE FROM experiments WHERE id = ?',
      args: [id],
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        databaseUrl: env.TURSO_DATABASE_URL,
        tables: expectedTables,
        writeReadDelete: 'passed',
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
