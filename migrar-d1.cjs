const { Client } = require("pg");
const { execSync } = require("child_process");

const DB_NAME = "elotrofutbol";

const TABLES = [
  "users",
  "results",
  "articles",
  "match_events",
  "media",
  "sessions",
  "custom_clubs",
  "edit_requests",
  "article_slug_redirects",
  "alineaciones",
  "comments",
  "club_info",
  "club_info_solicitudes",
  "activity_log",
  "nivel_historial",
  "settings"
];

/**
 * Ejecuta una consulta en D1 remoto mediante Wrangler.
 */
function ejecutarD1(sql) {
  console.log(`   Consultando D1...`);

  const comando =
    `npx wrangler d1 execute ${DB_NAME} --remote --command "${sql.replace(/"/g, '\\"')}" --json`;

  try {
    const output = execSync(comando, {
      encoding: "utf8",
      maxBuffer: 200 * 1024 * 1024,
      windowsHide: true
    });

    const data = JSON.parse(output);

    if (
      !Array.isArray(data) ||
      !data[0] ||
      !Array.isArray(data[0].results)
    ) {
      throw new Error(
        "Respuesta inesperada de Wrangler:\n" + output
      );
    }

    return data[0].results;
  } catch (error) {
    console.error("❌ Wrangler no pudo consultar D1.");
    console.error(error.stdout || error.message);
    throw error;
  }
}

/**
 * Escapa valores para PostgreSQL.
 */
function escaparPostgres(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  return "'" + String(value).replace(/'/g, "''") + "'";
}

/**
 * Escapa identificadores SQL.
 */
function escaparIdentificador(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Obtiene las columnas de una tabla PostgreSQL.
 */
async function obtenerColumnasPostgres(client, table) {
  const result = await client.query(
    `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `,
    [table]
  );

  return result.rows;
}

/**
 * Obtiene las claves primarias de una tabla PostgreSQL.
 */
async function obtenerPrimaryKeys(client, table) {
  const result = await client.query(
    `
      SELECT
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
      ORDER BY kcu.ordinal_position;
    `,
    [table]
  );

  return result.rows.map(row => row.column_name);
}

/**
 * Cuenta registros en PostgreSQL.
 */
async function contarPostgres(client, table) {
  const result = await client.query(
    `SELECT COUNT(*)::bigint AS count FROM ${escaparIdentificador(table)};`
  );

  return Number(result.rows[0].count);
}

/**
 * Comprueba si existe una tabla en PostgreSQL.
 */
async function existeTablaPostgres(client, table) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists;
    `,
    [table]
  );

  return result.rows[0].exists;
}

/**
 * Obtiene las columnas de D1 a partir de la primera fila.
 */
function obtenerColumnasD1(rows) {
  if (!rows.length) {
    return [];
  }

  return Object.keys(rows[0]);
}

/**
 * Compara columnas D1 vs PostgreSQL.
 */
function compararColumnas(columnasD1, columnasPG) {
  const setD1 = new Set(columnasD1);
  const setPG = new Set(columnasPG);

  const faltanEnPostgres = columnasD1.filter(
    columna => !setPG.has(columna)
  );

  const sobranEnPostgres = columnasPG.filter(
    columna => !setD1.has(columna)
  );

  return {
    faltanEnPostgres,
    sobranEnPostgres
  };
}

/**
 * Construye la condición para detectar si un registro ya existe.
 */
function construirCondicionExistencia(primaryKeys, row) {
  return primaryKeys
    .map(column => {
      const value = escaparPostgres(row[column]);

      if (value === "NULL") {
        return `${escaparIdentificador(column)} IS NULL`;
      }

      return `${escaparIdentificador(column)} = ${value}`;
    })
    .join(" AND ");
}

/**
 * Inserta una fila utilizando ON CONFLICT cuando existe PK.
 */
async function insertarFila(
  client,
  table,
  row,
  columnas,
  primaryKeys
) {
  const columnasDisponibles = columnas.filter(
    columna =>
      Object.prototype.hasOwnProperty.call(row, columna)
  );

  const nombresColumnas = columnasDisponibles
    .map(escaparIdentificador)
    .join(", ");

  const valores = columnasDisponibles
    .map(columna => escaparPostgres(row[columna]))
    .join(", ");

  let sql;

  if (primaryKeys.length > 0) {
    sql = `
      INSERT INTO ${escaparIdentificador(table)}
        (${nombresColumnas})
      VALUES
        (${valores})
      ON CONFLICT (${primaryKeys
        .map(escaparIdentificador)
        .join(", ")})
      DO NOTHING;
    `;
  } else {
    /*
     * Si la tabla no tiene PK, hacemos una comprobación
     * antes de insertar para evitar duplicados exactos.
     */
    const condicion = construirCondicionExistencia(
      columnasDisponibles,
      row
    );

    const check = await client.query(`
      SELECT 1
      FROM ${escaparIdentificador(table)}
      WHERE ${condicion}
      LIMIT 1;
    `);

    if (check.rowCount > 0) {
      return false;
    }

    sql = `
      INSERT INTO ${escaparIdentificador(table)}
        (${nombresColumnas})
      VALUES
        (${valores});
    `;
  }

  const result = await client.query(sql);

  return result.rowCount > 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "❌ Falta DATABASE_URL en las variables de entorno."
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  await client.connect();

  console.log("");
  console.log("======================================");
  console.log("   MIGRACIÓN D1 → POSTGRESQL");
  console.log("   MODO INCREMENTAL / SIN DUPLICADOS");
  console.log("======================================");
  console.log("");

  let totalInsertados = 0;
  let totalExistentes = 0;
  let totalErrores = 0;

  for (const table of TABLES) {
    console.log("");
    console.log("--------------------------------------");
    console.log(`TABLA: ${table}`);
    console.log("--------------------------------------");

    try {
      /*
       * ----------------------------------------------------
       * 1. Comprobar que la tabla existe en PostgreSQL
       * ----------------------------------------------------
       */

      const existe = await existeTablaPostgres(
        client,
        table
      );

      if (!existe) {
        console.log(
          `❌ La tabla "${table}" NO existe en PostgreSQL.`
        );
        console.log(
          `   Se omite para no modificar el esquema automáticamente.`
        );

        totalErrores++;
        continue;
      }

      /*
       * ----------------------------------------------------
       * 2. Obtener datos D1
       * ----------------------------------------------------
       */

      const rows = ejecutarD1(
        `SELECT * FROM ${table};`
      );

      const totalD1 = rows.length;

      console.log(
        `D1:          ${totalD1} registros`
      );

      /*
       * ----------------------------------------------------
       * 3. Contar PostgreSQL
       * ----------------------------------------------------
       */

      const totalPGAntes = await contarPostgres(
        client,
        table
      );

      console.log(
        `PostgreSQL:  ${totalPGAntes} registros`
      );

      /*
       * ----------------------------------------------------
       * 4. Tabla vacía en D1
       * ----------------------------------------------------
       */

      if (rows.length === 0) {
        console.log(
          `✅ ${table.padEnd(18)} 0/0`
        );
        continue;
      }

      /*
       * ----------------------------------------------------
       * 5. Detectar columnas
       * ----------------------------------------------------
       */

      const columnasD1 = obtenerColumnasD1(rows);

      const columnasPGInfo =
        await obtenerColumnasPostgres(
          client,
          table
        );

      const columnasPG =
        columnasPGInfo.map(row => row.column_name);

      const {
        faltanEnPostgres,
        sobranEnPostgres
      } = compararColumnas(
        columnasD1,
        columnasPG
      );

      console.log("");
      console.log("Columnas D1:");
      console.log(
        `  ${columnasD1.join(", ")}`
      );

      console.log("");
      console.log("Columnas PostgreSQL:");
      console.log(
        `  ${columnasPG.join(", ")}`
      );

      /*
       * ----------------------------------------------------
       * 6. Avisar diferencias de columnas
       * ----------------------------------------------------
       */

      if (faltanEnPostgres.length > 0) {
        console.log("");
        console.log(
          "⚠️ COLUMNAS QUE ESTÁN EN D1 PERO NO EN POSTGRESQL:"
        );

        for (const columna of faltanEnPostgres) {
          console.log(`   - ${columna}`);
        }

        console.log("");
        console.log(
          "⚠️ No se insertarán esas columnas."
        );
      }

      if (sobranEnPostgres.length > 0) {
        console.log("");
        console.log(
          "ℹ️ COLUMNAS QUE ESTÁN EN POSTGRESQL PERO NO EN D1:"
        );

        for (const columna of sobranEnPostgres) {
          console.log(`   - ${columna}`);
        }

        console.log(
          "   Se utilizarán sus valores DEFAULT cuando existan."
        );
      }

      /*
       * ----------------------------------------------------
       * 7. Solo utilizar columnas existentes en PG
       * ----------------------------------------------------
       */

      const columnasUtilizables =
        columnasD1.filter(columna =>
          columnasPG.includes(columna)
        );

      if (columnasUtilizables.length === 0) {
        console.log(
          `❌ No hay columnas compatibles entre D1 y PostgreSQL.`
        );

        totalErrores++;
        continue;
      }

      /*
       * ----------------------------------------------------
       * 8. Detectar Primary Key
       * ----------------------------------------------------
       */

      const primaryKeys =
        await obtenerPrimaryKeys(
          client,
          table
        );

      if (primaryKeys.length > 0) {
        console.log("");
        console.log(
          `🔑 Primary Key: ${primaryKeys.join(", ")}`
        );
      } else {
        console.log("");
        console.log(
          "⚠️ Esta tabla no tiene Primary Key."
        );
        console.log(
          "   Se comprobarán duplicados mediante coincidencia exacta."
        );
      }

      /*
       * ----------------------------------------------------
       * 9. Si ya está completa
       * ----------------------------------------------------
       */

      if (totalPGAntes >= totalD1) {
        console.log("");
        console.log(
          `✅ ${table.padEnd(18)} ${totalPGAntes}/${totalD1}`
        );

        totalExistentes += totalD1;

        continue;
      }

      /*
       * ----------------------------------------------------
       * 10. Insertar registros
       * ----------------------------------------------------
       */

      console.log("");
      console.log(
        `Migrando ${totalD1 - totalPGAntes} registros...`
      );

      let insertados = 0;
      let existentes = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          const insertado = await insertarFila(
            client,
            table,
            row,
            columnasUtilizables,
            primaryKeys
          );

          if (insertado) {
            insertados++;
            totalInsertados++;
          } else {
            existentes++;
            totalExistentes++;
          }

          /*
           * Mostrar progreso cada 10 registros
           */
          if (
            (i + 1) % 10 === 0 ||
            i === rows.length - 1
          ) {
            console.log(
              `   Progreso: ${i + 1}/${rows.length}`
            );
          }
        } catch (error) {
          console.error("");
          console.error(
            `❌ Error insertando registro ${i + 1} de ${table}`
          );

          console.error(
            error.message
          );

          /*
           * Mostrar la fila problemática
           */
          console.error(
            "Registro:",
            JSON.stringify(row, null, 2)
          );

          totalErrores++;

          /*
           * Continuamos con el siguiente registro.
           */
          continue;
        }
      }

      /*
       * ----------------------------------------------------
       * 11. Contar PostgreSQL después
       * ----------------------------------------------------
       */

      const totalPGDespues =
        await contarPostgres(
          client,
          table
        );

      console.log("");
      console.log(
        `   Nuevos:      ${insertados}`
      );

      console.log(
        `   Ya estaban:  ${existentes}`
      );

      console.log(
        `   PostgreSQL:  ${totalPGDespues}/${totalD1}`
      );

      if (totalPGDespues === totalD1) {
        console.log(
          `   ✅ ${table}: COMPLETA`
        );
      } else if (totalPGDespues < totalD1) {
        console.log(
          `   ⚠️ ${table}: FALTAN ${totalD1 - totalPGDespues}`
        );
      } else {
        console.log(
          `   ⚠️ ${table}: PostgreSQL tiene MÁS registros que D1`
        );
      }
    } catch (error) {
      console.error("");
      console.error(
        `❌ ERROR GENERAL EN TABLA ${table}`
      );
      console.error(error.message);

      totalErrores++;

      /*
       * No paramos toda la migración.
       * Continuamos con la siguiente tabla.
       */
      continue;
    }
  }

  /*
   * ======================================================
   * RESUMEN FINAL
   * ======================================================
   */

  console.log("");
  console.log("");
  console.log("======================================");
  console.log("       RESUMEN DE MIGRACIÓN");
  console.log("======================================");
  console.log("");

  for (const table of TABLES) {
    try {
      const existe = await existeTablaPostgres(
        client,
        table
      );

      if (!existe) {
        console.log(
          `${table.padEnd(22)} ❌ TABLA NO EXISTE`
        );
        continue;
      }

      const pgCount =
        await contarPostgres(
          client,
          table
        );

      const d1Rows = ejecutarD1(
        `SELECT COUNT(*) AS total FROM ${table};`
      );

      const d1Count =
        Number(d1Rows[0]?.total || 0);

      if (pgCount === d1Count) {
        console.log(
          `${table.padEnd(22)} ${pgCount}/${d1Count} ✅`
        );
      } else {
        console.log(
          `${table.padEnd(22)} ${pgCount}/${d1Count} ⚠️`
        );
      }
    } catch (error) {
      console.log(
        `${table.padEnd(22)} ❌ ERROR`
      );
    }
  }

  console.log("");
  console.log("--------------------------------------");
  console.log(
    `Registros insertados: ${totalInsertados}`
  );
  console.log(
    `Registros ya existentes: ${totalExistentes}`
  );
  console.log(
    `Errores: ${totalErrores}`
  );
  console.log("--------------------------------------");
  console.log("");

  if (totalErrores === 0) {
    console.log(
      "✅ MIGRACIÓN FINALIZADA SIN ERRORES."
    );
  } else {
    console.log(
      "⚠️ MIGRACIÓN FINALIZADA CON ALGUNOS ERRORES."
    );

    console.log(
      "Puedes volver a ejecutar el script."
    );

    console.log(
      "Los registros ya migrados no deberían duplicarse."
    );
  }

  console.log("");

  await client.end();
}

main().catch(async error => {
  console.error("");
  console.error("======================================");
  console.error("❌ ERROR FATAL");
  console.error("======================================");
  console.error("");
  console.error(error);

  process.exit(1);
});