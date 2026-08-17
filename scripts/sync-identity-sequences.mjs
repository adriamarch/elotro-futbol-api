#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;

const databaseUrl =
  process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!databaseUrl) {
  console.error("ERROR: define DATABASE_URL o DATABASE_PUBLIC_URL.");
  process.exit(2);
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
});

await client.connect();

try {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'id'
      AND data_type IN ('smallint', 'integer', 'bigint')
  `);

  for (const row of columns.rows) {
    const table = row.table_name;
    const column = row.column_name;

    const maxResult = await client.query(
      `SELECT MAX("${column}") AS max_id
       FROM "public"."${table}"`
    );

    const rawMax = maxResult.rows[0].max_id;
    const maxId = rawMax === null ? 0 : Number(rawMax);
    const restartAt = maxId + 1;

    if (row.is_identity === "YES") {
      await client.query(
        `ALTER TABLE "public"."${table}"
         ALTER COLUMN "${column}" RESTART WITH ${restartAt}`
      );
      console.log(`OK ${table}.${column} IDENTITY -> ${restartAt}`);
      continue;
    }

    const sequenceResult = await client.query(
      `SELECT pg_get_serial_sequence($1, $2) AS sequence_name`,
      [`public.${table}`, column]
    );

    const sequence = sequenceResult.rows[0]?.sequence_name;

    if (sequence) {
      await client.query(
        `SELECT setval($1::regclass, $2, false)`,
        [sequence, restartAt]
      );
      console.log(`OK ${table}.${column} sequence -> ${restartAt}`);
    }
  }

  console.log("Identity/serial sequences synchronized.");
} finally {
  await client.end();
}
