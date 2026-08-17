// Estado/log de sincronización (FASE4.md sección 12).
// Cada ejecución (inicial o incremental) crea una fila en sync_state al
// empezar y la actualiza al terminar (o al fallar). "detail" guarda un
// JSON con el desglose por tabla y los errores concretos, para poder
// diagnosticar sin tener que leer logs de consola.

import crypto from "node:crypto";

export function nuevoRunId() {
  return crypto.randomUUID();
}

export async function registrarInicio(client, { runId, mode }) {
  await client.query(
    `INSERT INTO sync_state (run_id, started_at, status, mode)
     VALUES ($1, CURRENT_TIMESTAMP, 'running', $2);`,
    [runId, mode]
  );
}

export async function registrarFin(client, { runId, status, resumen, detail }) {
  await client.query(
    `UPDATE sync_state SET
       finished_at = CURRENT_TIMESTAMP,
       status = $2,
       records_processed = $3,
       records_inserted = $4,
       records_updated = $5,
       records_deleted = $6,
       errors = $7,
       duration_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000,
       detail = $8
     WHERE run_id = $1;`,
    [
      runId,
      status,
      resumen.processed || 0,
      resumen.inserted || 0,
      resumen.updated || 0,
      resumen.deleted || 0,
      resumen.errors || 0,
      JSON.stringify(detail || {}),
    ]
  );
}

export async function ultimaEjecucion(client) {
  const result = await client.query(
    `SELECT * FROM sync_state ORDER BY started_at DESC LIMIT 1;`
  );
  return result.rows[0] || null;
}

export async function leerCursor(client, table) {
  const result = await client.query(
    `SELECT last_synced_at, last_synced_id FROM sync_cursor WHERE table_name = $1;`,
    [table]
  );
  return result.rows[0] || null;
}

export async function guardarCursor(client, table, { lastSyncedAt, lastSyncedId }) {
  await client.query(
    `INSERT INTO sync_cursor (table_name, last_synced_at, last_synced_id, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (table_name) DO UPDATE SET
       last_synced_at = EXCLUDED.last_synced_at,
       last_synced_id = EXCLUDED.last_synced_id,
       updated_at = CURRENT_TIMESTAMP;`,
    [table, lastSyncedAt ?? null, lastSyncedId ?? null]
  );
}
