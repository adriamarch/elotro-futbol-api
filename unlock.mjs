import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const result = await client.query(`
    UPDATE sync_state
    SET
      status = 'abandoned',
      finished_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
    RETURNING run_id, started_at
  `);

  if (result.rows.length) {
    console.log("DESBLOQUEADO:");
    console.table(result.rows);
  } else {
    console.log("NO HABIA BLOQUEO");
  }
} finally {
  await client.end();
}