#!/usr/bin/env node
// Backfill de "usa_url_bonita" y "ficha_tecnica" para los artículos que
// ya existían en PostgreSQL antes de la migración 013.
//
// Por qué hace falta un script aparte y no basta con el ALTER TABLE de
// la migración 013: "articles" sincroniza en modo incremental por
// updated_at (ver sync/tables.mjs), así que sync/incremental.mjs solo
// vuelve a copiar una fila si su updated_at en D1 avanza más allá del
// cursor ya guardado. Un ALTER TABLE ADD COLUMN no cambia updated_at en
// D1, así que los artículos ya sincronizados antes de esta migración se
// quedarían con el DEFAULT de Postgres (usa_url_bonita = 1) en vez de su
// valor real en D1 -que, para la mayoría de artículos antiguos, es 0
// tras el UPDATE masivo que hizo migracion_formato_enlace.sql en D1-.
//
// Este script lee TODOS los artículos de D1 (una vez, no es incremental)
// y corrige ambas columnas en Postgres para los que ya existían, sin
// tocar updated_at ni ningún otro campo ni pasar por el sincronizador
// normal.
//
// Uso (tras aplicar db/migrations/013_articulos_url_y_ficha.sql):
//   node scripts/backfill-usa-url-bonita.mjs

import { pathToFileURL } from "node:url";
import pg from "pg";
import { ejecutarD1 } from "../sync/d1-client.mjs";

const { Client } = pg;
const LOTE = 250;

export async function ejecutarBackfill() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL en las variables de entorno.");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("Leyendo D1 (articles: id, usa_url_bonita, ficha_tecnica)...");
    const filas = await ejecutarD1(
      "SELECT id, usa_url_bonita, ficha_tecnica FROM articles ORDER BY id ASC;"
    );
    console.log(`D1: ${filas.length} artículos.`);

    let actualizados = 0;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      for (const fila of lote) {
        const resultado = await client.query(
          `UPDATE articles SET usa_url_bonita = $2, ficha_tecnica = $3 WHERE id = $1;`,
          [fila.id, fila.usa_url_bonita, fila.ficha_tecnica]
        );
        if (resultado.rowCount > 0) actualizados++;
      }
      console.log(`Progreso ${Math.min(i + lote.length, filas.length)}/${filas.length}`);
    }

    console.log(`\nBackfill completo: ${actualizados} artículo(s) actualizado(s) en PostgreSQL.`);
    return { actualizados, total: filas.length };
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ejecutarBackfill().catch((error) => {
    console.error("ERROR FATAL:", error);
    process.exit(1);
  });
}
