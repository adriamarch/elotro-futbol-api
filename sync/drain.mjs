#!/usr/bin/env node
// Drenaje de pending_writes hacia D1 (FASE 5, ver
// db/migrations/003_pending_writes.sql para el contexto completo).
//
// Este script NO conecta con D1 directamente (Postgres/Railway no puede
// hablar con D1, que solo es accesible desde dentro del Worker de
// Cloudflare vía binding). En su lugar, lee su PROPIA cola en Postgres y
// la manda por HTTP al Worker principal
// (POST /api/internal/drain-pending-writes, ver worker/src/index.js), que
// reproduce cada escritura contra D1 usando la misma lógica de negocio que
// cualquier petición normal (handlePrimary), y devuelve el resultado.
//
// Se llama desde sync/scheduler.mjs en cada pasada, DESPUÉS del sync
// D1 -> PostgreSQL normal: primero se trae lo nuevo de D1, luego se
// intenta subir lo pendiente. Si D1 sigue caída, el POST al Worker
// simplemente fallará (timeout o 5xx) y las filas se quedan 'pending'
// para el siguiente intento -- no se marcan 'failed' por un fallo de
// conectividad, solo por un rechazo explícito de D1 (ver más abajo).
//
// Orden de aplicación: se procesan por created_at ascendente (más antigua
// primero), para que si hay dos escrituras sobre el mismo registro se
// apliquen en el mismo orden en que ocurrieron -- importante porque D1 no
// tiene forma de saber por sí sola cuál fue antes.

import pg from "pg";
import { conReintentos } from "./retry.mjs";

const { Client } = pg;

const WORKER_URL = process.env.WORKER_URL || "https://api.elotrofutbol.media";
const INTERNAL_SYNC_SECRET = process.env.INTERNAL_SYNC_SECRET;
const LOTE = 50; // debe coincidir con LOTE_MAXIMO en worker/src/index.js

export async function drenarEscriturasPendientes() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL en las variables de entorno.");
  }
  if (!INTERNAL_SYNC_SECRET) {
    // Sin el secreto no hay forma de autenticarse contra el Worker: mejor
    // no intentarlo (fallaría con 401 en cada pasada, generando ruido en
    // los logs) y avisar claramente de la causa.
    console.error(
      "[drain] Falta INTERNAL_SYNC_SECRET en las variables de entorno de " +
      "Railway. Debe tener EXACTAMENTE el mismo valor que el " +
      "INTERNAL_SYNC_SECRET configurado en el Worker (wrangler secret put " +
      "INTERNAL_SYNC_SECRET). Sin esto, las escrituras hechas en la " +
      "secundaria durante un failover no se reproducirán nunca en D1."
    );
    return { skipped: true, reason: "sin_secreto" };
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      `SELECT write_id, method, path, query_string, body, authorization_header
       FROM pending_writes
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1;`,
      [LOTE]
    );

    if (rows.length === 0) return { drained: 0 };

    console.log(`[drain] ${rows.length} escritura(s) pendiente(s), intentando aplicar contra D1...`);

    let response;
    try {
      response = await conReintentos(
        () => llamarWorker(rows),
        {
          intentos: 3,
          onRetry: ({ intento, error }) => console.warn(`[drain] reintento POST al Worker (${intento}): ${error.message}`),
        }
      );
    } catch (error) {
      // El Worker sigue sin responder tras los reintentos: probablemente
      // D1 (o el propio Worker) todavía no ha vuelto. No se toca el
      // estado de ninguna fila -- se reintentará en la siguiente pasada
      // del scheduler (60s por defecto). Esto es justo la diferencia
      // entre "D1 caída" (reintentar más tarde, sin penalizar) y "D1 vivo
      // pero rechaza la escritura" (marcar failed, ver abajo).
      console.warn(`[drain] no se pudo contactar con el Worker, se reintentará en la siguiente pasada: ${error.message}`);
      return { drained: 0, error: error.message };
    }

    let aplicadas = 0;
    let fallidas = 0;
    for (const resultado of response.results || []) {
      const nuevoEstado = resultado.status === "applied" ? "applied" : "failed";
      if (nuevoEstado === "applied") aplicadas++; else fallidas++;
      await client.query(
        `UPDATE pending_writes SET
           status = $2,
           attempts = attempts + 1,
           last_attempt_at = CURRENT_TIMESTAMP,
           last_result_status = $3,
           last_result_body = $4,
           applied_at = CASE WHEN $2 = 'applied' THEN CURRENT_TIMESTAMP ELSE applied_at END
         WHERE write_id = $1;`,
        [resultado.write_id, nuevoEstado, resultado.result_status, resultado.result_body]
      );
    }

    console.log(`[drain] aplicadas=${aplicadas} fallidas=${fallidas} (ver pending_writes.last_result_body para el motivo de cada fallo)`);
    return { drained: aplicadas, failed: fallidas };
  } finally {
    await client.end();
  }
}

async function llamarWorker(rows) {
  const body = JSON.stringify({
    writes: rows.map((r) => ({
      write_id: r.write_id,
      method: r.method,
      path: r.path,
      query_string: r.query_string,
      body: r.body,
      authorization_header: r.authorization_header,
    })),
  });

  const resp = await fetch(`${WORKER_URL}/api/internal/drain-pending-writes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Sync-Secret": INTERNAL_SYNC_SECRET,
    },
    body,
  });

  if (!resp.ok) {
    throw new Error(`Worker respondió ${resp.status}`);
  }
  return resp.json();
}
