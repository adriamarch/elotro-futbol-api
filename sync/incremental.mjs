#!/usr/bin/env node
// Sincronización incremental D1 -> PostgreSQL (FASE4.md sección 8).
//
// Mecanismo elegido: timestamps de modificación (columna "updated_at" o,
// para tablas de solo-inserción, "created_at") + comparación de conjunto
// de IDs para detectar borrados en las tablas donde D1 permite DELETE.
// Ver sync/tables.mjs para la justificación tabla a tabla y
// SINCRONIZACION-INCREMENTAL.md para el resumen.
//
// Por qué esto y no otras opciones del documento:
//  - "Cada minuto copiar todas las tablas" (lo que la Fase 4 pide evitar
//    explícitamente): coste O(todas las filas) en cada pasada aunque no
//    cambie nada. Con timestamps el coste es O(filas cambiadas).
//  - IDs incrementales solos: no detectan UPDATEs, solo altas.
//  - Journal/outbox (tabla de cambios escrita por el Worker principal):
//    sería más preciso y detectaría deletes sin comparar IDs, pero exige
//    tocar cada INSERT/UPDATE/DELETE del Worker principal (prohibido por
//    la sección 13: "no modificar la API principal innecesariamente").
//    Los triggers de SQLite (migracion_fase4_sync_tracking.sql) consiguen
//    lo mismo que un outbox para "cuándo cambió algo" sin tocar
//    src/index.js -son la vía menos invasiva-.
//
// Garantías de "no duplicados / no reinicio a medias" (sección 10):
//  - Cada fila se procesa con upsertFila (INSERT ... ON CONFLICT DO
//    UPDATE), que es idempotente por construcción: aplicar la misma fila
//    dos veces dejacomo resultado el mismo estado.
//  - El cursor de cada tabla solo se guarda DESPUÉS de que todas las filas
//    de ese lote se hayan escrito correctamente, así que un corte a mitad
//    de tabla simplemente reprocesa (sin duplicar, por el punto anterior)
//    las mismas filas en la siguiente pasada.
//  - No hay ejecución concurrente: sync_state antes de invocar el
//    scheduler (ver sync/scheduler.mjs) comprueba si ya hay una fila con
//    status = 'running' y, si la hay, se salta esa pasada.

import { pathToFileURL } from "node:url";
import pg from "pg";
import { ejecutarD1, escaparValorD1 } from "./d1-client.mjs";
import { TABLES_IN_ORDER, DEPENDENCIAS_FK } from "./tables.mjs";
import {
  obtenerColumnasPostgres,
  existeTablaPostgres,
  upsertFila,
  upsertFilasLote,
  eliminarFila,
  obtenerIdsPostgres,
  reconciliarTablaAutoritativa,
  reconciliarFilasPorOriginWriteId,
} from "./pg-writer.mjs";
import { conReintentos } from "./retry.mjs";
import {
  nuevoRunId,
  registrarInicio,
  registrarFin,
  leerCursor,
  guardarCursor,
  ultimaEjecucion,
} from "./state.mjs";

const { Client } = pg;

function pkValuesFromRow(row, pk) {
  return pk.map((c) => row[c]);
}
function pkKey(row, pk) {
  return pk.map((c) => String(row[c])).join("\u0000");
}

async function hayEjecucionEnCurso(client) {
  const ultima = await ultimaEjecucion(client);
  if (!ultima || ultima.status !== "running") return false;
  // Salvaguarda: si una ejecución quedó "running" por un crash del
  // proceso (nunca llegó a registrarFin), no bloqueamos para siempre.
  // Un run que lleva "running" más de 30 minutos se considera abandonado.
  const iniciado = new Date(ultima.started_at).getTime();
  const minutos = (Date.now() - iniciado) / 60000;
  // Un proceso normal de esta sincronización debe avanzar y cerrar el
  // registro. Si quedó huérfano (por Ctrl+C, cierre de PowerShell, etc.)
  // no debemos bloquear todas las siguientes pasadas durante 30 minutos.
  // A partir de 3 minutos se considera stale y se libera automáticamente.
  if (minutos >= 3) {
    await client.query(
      `UPDATE sync_state
       SET status = 'abandoned', finished_at = CURRENT_TIMESTAMP,
           detail = COALESCE(detail::jsonb, '{}'::jsonb) || jsonb_build_object('reason', 'stale_lock_auto_released')
       WHERE run_id = $1 AND status = 'running';`,
      [ultima.run_id]
    );
    console.warn(`Liberando sincronización huérfana ${ultima.run_id} (${minutos.toFixed(1)} min).`);
    return false;
  }
  return true;
}

async function sincronizarTabla(client, tableConfig, { runId }) {
  const { name, pk, changeStrategy, cursorColumn, deleteDetection } = tableConfig;

  const detalle = { table: name, inserted: 0, updated: 0, deleted: 0, errors: [] };
  console.log(`[${name}] inicio`);

  const existe = await existeTablaPostgres(client, name);
  if (!existe) {
    detalle.errors.push("La tabla no existe en PostgreSQL, se omite.");
    return detalle;
  }

  const cursor = await leerCursor(client, name);
  const columnasPG = await obtenerColumnasPostgres(client, name);

  // Estas tablas son autoritativas: en cada pasada D1 se considera la copia
  // canónica y PostgreSQL se reconcilia hasta quedar exactamente igual.
  // Esto corrige también diferencias históricas que un cursor incremental no
  // detectaría (por ejemplo una fila extra en PG o un valor antiguo).
  if (tableConfig.syncMode === "authoritative") {
    console.log(`[${name}] leyendo D1 (reconciliación autoritativa)...`);
    const filasD1 = await conReintentos(
      () => ejecutarD1(`SELECT * FROM ${name};`),
      {
        onRetry: ({ intento, error }) =>
          console.warn(`[${name}] reintento lectura D1 autoritativa (${intento}): ${error.message}`),
      }
    );

    console.log(`[${name}] D1: ${filasD1.length} registros`);

    const columnasUtilizables = filasD1.length
      ? Object.keys(filasD1[0]).filter((c) => columnasPG.includes(c))
      : [];

    const faltanEnPG = filasD1.length
      ? Object.keys(filasD1[0]).filter((c) => !columnasPG.includes(c))
      : [];
    if (faltanEnPG.length > 0) {
      detalle.errors.push(`Columnas D1 sin equivalente en PG: ${faltanEnPG.join(", ")}`);
      return detalle;
    }

    try {
      // Antes de la reconciliación autoritativa normal (por PK), se resuelven
      // los casos de failover: filas de D1 que traen origin_write_id y cuyo
      // PK no coincide con el que tenía la fila equivalente creada en
      // PostgreSQL durante el failover (ver reconciliarFilasPorOriginWriteId
      // para el porqué completo). Sin este paso, reconciliarTablaAutoritativa
      // insertaría la fila de D1 como ADICIONAL (PK distinto) y dejaría la
      // fila de Postgres huérfana -pero como esta tabla es autoritativa, ni
      // siquiera se borraría sola en la siguiente pasada, porque su PK
      // seguiría sin existir en D1 solo si nadie la reconcilia antes-.
      const reconciliacionWriteId = await conReintentos(
        () => reconciliarFilasPorOriginWriteId(client, name, filasD1, pk),
        {
          onRetry: ({ intento, error }) =>
            console.warn(`[${name}] reintento reconciliación por origin_write_id (${intento}): ${error.message}`),
        }
      );
      if (reconciliacionWriteId.huerfanasEliminadas > 0) {
        console.log(`[${name}] reconciliadas ${reconciliacionWriteId.huerfanasEliminadas} fila(s) huérfana(s) de failover por origin_write_id.`);
      }
      if (reconciliacionWriteId.conflictos.length > 0) {
        detalle.errors.push(`${reconciliacionWriteId.conflictos.length} conflicto(s) de origin_write_id sin resolver, ver sync_write_id_conflicts.`);
      }

      // Nota: sin conReintentos aquí a propósito. reconciliarTablaAutoritativa
      // ya no es una única transacción (ver pg-writer.mjs): hace commit por
      // lote/fila conforme avanza, así que si lanza un error las filas
      // buenas YA quedaron persistidas. Reintentar la llamada completa
      // volvería a procesar de cero todas las filas (inofensivo por ser
      // upsert idempotente, pero redundante); en vez de eso se deja que
      // sean las filas realmente problemáticas -reportadas en el error- las
      // que se reintenten solas en la siguiente pasada del scheduler.
      let resultado;
      try {
        resultado = await reconciliarTablaAutoritativa(client, name, filasD1, columnasUtilizables, pk);
      } catch (error) {
        // Progreso parcial: las filas sin error ya se confirmaron en PG
        // (commits por lote/fila), así que sí se reportan aquí -a
        // diferencia de antes, cuando toda la transacción hacía ROLLBACK y
        // el resumen se ponía a 0 aunque el trabajo se hubiera hecho.
        const parcial = error.parcial || { inserted: 0, updated: 0, deleted: 0 };
        detalle.inserted += parcial.inserted;
        detalle.updated += parcial.updated;
        detalle.deleted += parcial.deleted;
        detalle.errors.push(`Reconciliación autoritativa: ${error.message}`);
        console.error(`[${name}] ERROR en reconciliación autoritativa (progreso parcial insertados=${parcial.inserted} actualizados=${parcial.updated} borrados=${parcial.deleted}): ${error.message}`);
        console.log(`[${name}] fin: insertados=${detalle.inserted} actualizados=${detalle.updated} borrados=${detalle.deleted} errores=${detalle.errors.length}`);
        return detalle;
      }

      detalle.inserted += resultado.inserted;
      detalle.updated += resultado.updated;
      detalle.deleted += resultado.deleted;

      const ultimo = filasD1.reduce((max, row) => {
        const value = row[cursorColumn];
        return value && (!max || value > max) ? value : max;
      }, cursor?.last_synced_at ?? null);
      if (ultimo && ultimo !== cursor?.last_synced_at) {
        await guardarCursor(client, name, { lastSyncedAt: ultimo });
      }

      return detalle;
    } catch (error) {
      detalle.errors.push(`Reconciliación autoritativa: ${error.message}`);
      console.error(`[${name}] ERROR en reconciliación autoritativa: ${error.message}`);
      console.log(`[${name}] fin: insertados=${detalle.inserted} actualizados=${detalle.updated} borrados=${detalle.deleted} errores=${detalle.errors.length}`);
      return detalle;
    }
  }

  // 1) Leer de D1 solo las filas cambiadas desde el cursor.
  let sql;
  if (cursor?.last_synced_at) {
    sql = `SELECT * FROM ${name} WHERE ${cursorColumn} > ${escaparValorD1(cursor.last_synced_at)} ORDER BY ${cursorColumn} ASC;`;
  } else {
    // Sin cursor todavía = primera pasada incremental tras la migración
    // inicial: traemos todo para poder fijar el cursor a partir de ahí.
    sql = `SELECT * FROM ${name} ORDER BY ${cursorColumn} ASC;`;
  }

  console.log(`[${name}] leyendo D1 (incremental)...`);
  const filas = await conReintentos(() => ejecutarD1(sql), {
    onRetry: ({ intento, error }) =>
      console.warn(`[${name}] reintento lectura D1 (${intento}): ${error.message}`),
  });

  console.log(`[${name}] D1: ${filas.length} registros a procesar`);

  const columnasUtilizables = filas.length
    ? Object.keys(filas[0]).filter((c) => columnasPG.includes(c))
    : [];

  let ultimoCursorValor = cursor?.last_synced_at ?? null;

  const TAMANO_LOTE = 250;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    try {
      // Igual que en la rama autoritativa: resuelve primero cualquier fila
      // huérfana de un failover antes del upsert normal por PK, para que
      // una fila reproducida desde D1 sustituya a su equivalente huérfana
      // de PostgreSQL en vez de duplicarse (ver
      // reconciliarFilasPorOriginWriteId en sync/pg-writer.mjs).
      const reconciliacionWriteId = await conReintentos(
        () => reconciliarFilasPorOriginWriteId(client, name, lote, pk),
        { onRetry: ({ intento, error }) => console.warn(`[${name}] reintento reconciliación por origin_write_id, lote ${i + 1}-${i + lote.length} (${intento}): ${error.message}`) }
      );
      if (reconciliacionWriteId.huerfanasEliminadas > 0) {
        console.log(`[${name}] reconciliadas ${reconciliacionWriteId.huerfanasEliminadas} fila(s) huérfana(s) de failover por origin_write_id (lote ${i + 1}-${i + lote.length}).`);
      }
      if (reconciliacionWriteId.conflictos.length > 0) {
        detalle.errors.push(`${reconciliacionWriteId.conflictos.length} conflicto(s) de origin_write_id sin resolver en lote ${i + 1}-${i + lote.length}, ver sync_write_id_conflicts.`);
      }

      const resultado = await conReintentos(
        () => upsertFilasLote(client, name, lote, columnasUtilizables, pk),
        { onRetry: ({ intento, error }) => console.warn(`[${name}] reintento lote ${i + 1}-${i + lote.length} (${intento}): ${error.message}`) }
      );
      detalle.inserted += resultado.inserted;
      detalle.updated += resultado.updated;
      for (const row of lote) {
        if (row[cursorColumn] && (!ultimoCursorValor || row[cursorColumn] > ultimoCursorValor)) ultimoCursorValor = row[cursorColumn];
      }
    } catch (batchError) {
      console.warn(`[${name}] lote ${i + 1}-${i + lote.length} falló; reintentando fila a fila: ${batchError.message}`);
      for (const row of lote) {
        try {
          const resultado = await conReintentos(() => upsertFila(client, name, row, columnasUtilizables, pk, { onConflictAction: "update" }));
          if (resultado === "inserted") detalle.inserted++;
          else if (resultado === "updated") detalle.updated++;
          if (row[cursorColumn] && (!ultimoCursorValor || row[cursorColumn] > ultimoCursorValor)) ultimoCursorValor = row[cursorColumn];
        } catch (error) {
          detalle.errors.push(`Fila ${pkKey(row, pk)}: ${error.message}`);
          console.error(`[${name}] error definitivo en fila ${pkKey(row, pk)}:`, error.message);
        }
      }
    }
    console.log(`[${name}] progreso ${Math.min(i + lote.length, filas.length)}/${filas.length}`);
  }

  if (ultimoCursorValor && ultimoCursorValor !== cursor?.last_synced_at) {
    await guardarCursor(client, name, { lastSyncedAt: ultimoCursorValor });
  }

  // 2) Detectar borrados (solo en tablas donde D1 permite DELETE).
  if (deleteDetection) {
    try {
      const idsD1Rows = await conReintentos(() =>
        ejecutarD1(`SELECT ${pk.join(", ")} FROM ${name};`)
      );
      const idsD1 = new Set(idsD1Rows.map((r) => pkKey(r, pk)));

      const idsPGRows = await obtenerIdsPostgres(client, name, pk);
      for (const row of idsPGRows) {
        const key = pkKey(row, pk);
        if (!idsD1.has(key)) {
          try {
            await conReintentos(() => eliminarFila(client, name, pk, pkValuesFromRow(row, pk)));
            detalle.deleted++;
            await client.query(
              `INSERT INTO sync_deletions (table_name, record_id, run_id) VALUES ($1, $2, $3);`,
              [name, key, runId]
            );
          } catch (error) {
            detalle.errors.push(`Borrado ${key}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      detalle.errors.push(`Detección de borrados: ${error.message}`);
    }
  }

  console.log(`[${name}] fin: insertados=${detalle.inserted} actualizados=${detalle.updated} borrados=${detalle.deleted} errores=${detalle.errors.length}`);
  return detalle;
}

export async function ejecutarSincronizacionIncremental() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL en las variables de entorno.");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  const runId = nuevoRunId();
  const inicio = Date.now();

  try {
    if (await hayEjecucionEnCurso(client)) {
      console.log("Ya hay una sincronización en curso, se omite esta pasada.");
      return { skipped: true };
    }

    await registrarInicio(client, { runId, mode: "incremental" });

    const detallesPorTabla = [];
    const resumen = { processed: 0, inserted: 0, updated: 0, deleted: 0, errors: 0 };
    // Nombres de tabla que fallaron en esta pasada (para poder saltar a sus
    // tablas hijas, ver DEPENDENCIAS_FK en tables.mjs).
    const tablasConError = new Set();

    for (let indice = 0; indice < TABLES_IN_ORDER.length; indice++) {
      const tableConfig = TABLES_IN_ORDER[indice];
      console.log(`\n===== TABLA ${indice + 1}/${TABLES_IN_ORDER.length}: ${tableConfig.name} =====`);

      const padresConError = (DEPENDENCIAS_FK[tableConfig.name] || []).filter((p) =>
        tablasConError.has(p)
      );

      let detalle;
      if (padresConError.length > 0) {
        // No intentamos sincronizar esta tabla: su(s) tabla(s) padre
        // fallaron en esta misma pasada, así que Postgres puede no tener
        // todavía los IDs que esta tabla referencia por FK. Mejor
        // posponerla a la siguiente pasada (sus cursores no avanzan, así
        // que no se pierde nada) que dejarla romperse fila a fila contra
        // la constraint.
        const motivo = `Omitida en esta pasada: depende de ${padresConError.join(", ")}, que falló al sincronizar.`;
        console.warn(`[${tableConfig.name}] ${motivo}`);
        detalle = { table: tableConfig.name, inserted: 0, updated: 0, deleted: 0, errors: [motivo], skipped: true };
      } else {
        detalle = await sincronizarTabla(client, tableConfig, { runId });
      }

      if (detalle.errors.length > 0) {
        tablasConError.add(tableConfig.name);
      }

      detallesPorTabla.push(detalle);
      resumen.processed += detalle.inserted + detalle.updated + detalle.deleted;
      resumen.inserted += detalle.inserted;
      resumen.updated += detalle.updated;
      resumen.deleted += detalle.deleted;
      resumen.errors += detalle.errors.length;
    }

    const status = resumen.errors === 0 ? "ok" : "error";
    await registrarFin(client, {
      runId,
      status,
      resumen,
      detail: { tables: detallesPorTabla },
    });

    console.log(
      `Sincronización incremental ${status.toUpperCase()} en ${Date.now() - inicio}ms — ` +
        `insertados=${resumen.inserted} actualizados=${resumen.updated} borrados=${resumen.deleted} errores=${resumen.errors}`
    );

    return { runId, status, resumen, detail: detallesPorTabla };
  } catch (error) {
    await registrarFin(client, {
      runId,
      status: "error",
      resumen: {},
      detail: { fatal: error.message },
    }).catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

// Permite ejecutarlo directamente: node sync/incremental.mjs
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ejecutarSincronizacionIncremental()
    .then((r) => {
      if (r.skipped) process.exit(0);
      process.exit(r.status === "ok" ? 0 : 1);
    })
    .catch((error) => {
      console.error("ERROR FATAL:", error);
      process.exit(1);
    });
}
