#!/usr/bin/env node
import pg from "pg";
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL en las variables de entorno.");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  const r = await client.query(`
    UPDATE sync_state
    SET status = 'abandoned', finished_at = CURRENT_TIMESTAMP,
        detail = COALESCE(detail::jsonb, '{}'::jsonb) || jsonb_build_object('reason', 'manual_unlock')
    WHERE status = 'running'
    RETURNING run_id, started_at;
  `);
  if (!r.rowCount) console.log("No había ninguna sincronización bloqueada.");
  else console.log(`Desbloqueadas ${r.rowCount} sincronización(es): ${r.rows.map(x => x.run_id).join(", ")}`);
} finally {
  await client.end();
}
