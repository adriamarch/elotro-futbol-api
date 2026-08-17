// Helpers de escritura en PostgreSQL, compartidos por la migración inicial
// y la sincronización incremental. Toda escritura pasa por aquí para que
// el comportamiento (columnas usadas, ON CONFLICT, parámetros) sea
// idéntico en ambos flujos.

function escaparIdentificador(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export async function obtenerColumnasPostgres(client, table) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position;`,
    [table]
  );
  return result.rows.map((r) => r.column_name);
}

export async function existeTablaPostgres(client, table) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists;`,
    [table]
  );
  return result.rows[0].exists;
}

export async function contarPostgres(client, table) {
  const result = await client.query(
    `SELECT COUNT(*)::bigint AS count FROM ${escaparIdentificador(table)};`
  );
  return Number(result.rows[0].count);
}

/**
 * Inserta o actualiza (upsert) una fila usando su clave primaria.
 * A diferencia de la migración inicial (que usaba DO NOTHING porque D1
 * seguía siendo autoritativa y bastaba con rellenar huecos), la
 * sincronización incremental necesita DO UPDATE: una fila que cambió en
 * D1 tiene que sobrescribir la versión anterior en PostgreSQL.
 *
 * onConflictAction: "update" (por defecto) o "nothing".
 */
export async function upsertFila(client, table, row, columnas, primaryKeys, { onConflictAction = "update" } = {}) {
  const columnasDisponibles = columnas.filter((c) =>
    Object.prototype.hasOwnProperty.call(row, c)
  );

  const nombresColumnas = columnasDisponibles.map(escaparIdentificador).join(", ");
  const placeholders = columnasDisponibles.map((_, i) => `$${i + 1}`).join(", ");
  const valores = columnasDisponibles.map((c) => row[c]);

  if (primaryKeys.length === 0) {
    // Sin PK (no ocurre en las 16 tablas de este proyecto, pero se deja
    // resuelto por si aparece una tabla nueva sin PK en el futuro): usamos
    // una comprobación de existencia exacta antes de insertar.
    const condiciones = columnasDisponibles
      .map((c, i) => `${escaparIdentificador(c)} = $${i + 1}`)
      .join(" AND ");
    const check = await client.query(
      `SELECT 1 FROM ${escaparIdentificador(table)} WHERE ${condiciones} LIMIT 1;`,
      valores
    );
    if (check.rowCount > 0) return "unchanged";

    await client.query(
      `INSERT INTO ${escaparIdentificador(table)} (${nombresColumnas}) VALUES (${placeholders});`,
      valores
    );
    return "inserted";
  }

  const pkList = primaryKeys.map(escaparIdentificador).join(", ");

  if (onConflictAction === "nothing") {
    const sql = `
      INSERT INTO ${escaparIdentificador(table)} (${nombresColumnas})
      VALUES (${placeholders})
      ON CONFLICT (${pkList}) DO NOTHING;
    `;
    const result = await client.query(sql, valores);
    return result.rowCount > 0 ? "inserted" : "unchanged";
  }

  const columnasNoClave = columnasDisponibles.filter((c) => !primaryKeys.includes(c));

  if (columnasNoClave.length === 0) {
    // Tabla compuesta solo por columnas clave: no hay nada que actualizar,
    // nos comportamos como DO NOTHING.
    const sql = `
      INSERT INTO ${escaparIdentificador(table)} (${nombresColumnas})
      VALUES (${placeholders})
      ON CONFLICT (${pkList}) DO NOTHING;
    `;
    const result = await client.query(sql, valores);
    return result.rowCount > 0 ? "inserted" : "unchanged";
  }

  const setClause = columnasNoClave
    .map((c) => `${escaparIdentificador(c)} = EXCLUDED.${escaparIdentificador(c)}`)
    .join(", ");

  // xmax = 0 es el truco estándar de Postgres para distinguir INSERT de
  // UPDATE dentro de un mismo "INSERT ... ON CONFLICT DO UPDATE".
  const sql = `
    INSERT INTO ${escaparIdentificador(table)} (${nombresColumnas})
    VALUES (${placeholders})
    ON CONFLICT (${pkList}) DO UPDATE SET ${setClause}
    RETURNING (xmax = 0) AS inserted;
  `;
  const result = await client.query(sql, valores);
  return result.rows[0]?.inserted ? "inserted" : "updated";
}


/** Upsert de varias filas en una sola consulta. Reduce drásticamente el número
 * de round-trips a PostgreSQL en tablas como activity_log. */
export async function upsertFilasLote(client, table, rows, columnas, primaryKeys) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const columnasDisponibles = columnas.filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
  const nombres = columnasDisponibles.map(escaparIdentificador).join(", ");
  const valores = [];
  const grupos = rows.map((row, r) => {
    const placeholders = columnasDisponibles.map((c, i) => {
      valores.push(row[c]);
      return `$${r * columnasDisponibles.length + i + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  }).join(", ");
  const pkList = primaryKeys.map(escaparIdentificador).join(", ");
  const noPk = columnasDisponibles.filter((c) => !primaryKeys.includes(c));
  let sql;
  if (!noPk.length) {
    sql = `INSERT INTO ${escaparIdentificador(table)} (${nombres}) VALUES ${grupos} ON CONFLICT (${pkList}) DO NOTHING RETURNING (xmax = 0) AS inserted;`;
  } else {
    const setClause = noPk.map((c) => `${escaparIdentificador(c)} = EXCLUDED.${escaparIdentificador(c)}`).join(", ");
    sql = `INSERT INTO ${escaparIdentificador(table)} (${nombres}) VALUES ${grupos} ON CONFLICT (${pkList}) DO UPDATE SET ${setClause} RETURNING (xmax = 0) AS inserted;`;
  }
  const result = await client.query(sql, valores);
  let inserted = 0;
  for (const row of result.rows) if (row.inserted) inserted++;
  return { inserted, updated: result.rows.length - inserted };
}

export async function eliminarFila(client, table, primaryKeys, pkValues) {
  const condiciones = primaryKeys
    .map((c, i) => `${escaparIdentificador(c)} = $${i + 1}`)
    .join(" AND ");
  const result = await client.query(
    `DELETE FROM ${escaparIdentificador(table)} WHERE ${condiciones};`,
    pkValues
  );
  return result.rowCount > 0;
}

export async function obtenerIdsPostgres(client, table, primaryKeys) {
  const cols = primaryKeys.map(escaparIdentificador).join(", ");
  const result = await client.query(`SELECT ${cols} FROM ${escaparIdentificador(table)};`);
  return result.rows;
}

export { escaparIdentificador };

/**
 * Reconciliación autoritativa D1 -> PostgreSQL.
 *
 * Se usa en tablas pequeñas/sensibles donde PostgreSQL debe quedar como una
 * copia exacta de D1: hace UPSERT de todas las filas de D1 y elimina cualquier
 * PK que exista en PostgreSQL pero no en D1. Todo ocurre dentro de una única
 * transacción de PostgreSQL para evitar estados parcialmente reconciliados.
 *
 * El llamador debe envolver esta función con conReintentos(), porque un error
 * dentro de una transacción deja la transacción abortada y no se puede reintentar
 * una sentencia aislada sobre el mismo cliente.
 */
export async function reconciliarTablaAutoritativa(client, table, filasD1, columnas, primaryKeys) {
  const mapaD1 = new Map(
    filasD1.map((row) => [
      primaryKeys.map((c) => String(row[c])).join("\u0000"),
      row,
    ])
  );

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  await client.query("BEGIN");
  try {
    const TAMANO_LOTE = 250;
    for (let i = 0; i < filasD1.length; i += TAMANO_LOTE) {
      const lote = filasD1.slice(i, i + TAMANO_LOTE);
      const resultado = await upsertFilasLote(client, table, lote, columnas, primaryKeys);
      inserted += resultado.inserted;
      updated += resultado.updated;
    }

    const filasPG = await obtenerIdsPostgres(client, table, primaryKeys);
    for (const rowPG of filasPG) {
      const key = primaryKeys.map((c) => String(rowPG[c])).join("\u0000");
      if (!mapaD1.has(key)) {
        const values = primaryKeys.map((c) => rowPG[c]);
        const eliminado = await eliminarFila(client, table, primaryKeys, values);
        if (eliminado) deleted++;
      }
    }

    await client.query("COMMIT");
    return { inserted, updated, deleted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
