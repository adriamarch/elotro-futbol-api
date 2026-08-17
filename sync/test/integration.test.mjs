// Pruebas de integración exigidas por FASE4.md sección 14.
//
// Requieren DATABASE_URL real (PostgreSQL) y credenciales de Wrangler con
// acceso a D1 remoto (misma exigencia que ya tenía Fase 3 en
// scripts/validate-railway.mjs). Si no están disponibles, las pruebas se
// omiten explícitamente en vez de simular un resultado, tal y como pide
// el documento de Fase 4 ("si alguna parte depende de infraestructura
// que no está disponible, no simular resultados").
//
// Ejecutar con: DATABASE_URL=... npm run test:sync

import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const TIENE_DB = Boolean(DATABASE_URL);

test("migración inicial: D1 -> PostgreSQL sin duplicados al repetir", { skip: !TIENE_DB && "requiere DATABASE_URL" }, async () => {
  const { ejecutarMigracionInicial } = await import("../initial-migration.mjs");
  const { obtenerColumnasPostgres } = await import("../pg-writer.mjs");
  const { Client } = pg;

  const primera = await ejecutarMigracionInicial();
  assert.equal(primera.status, "ok", `primera migración con errores: ${JSON.stringify(primera.detail)}`);

  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const conteosAntes = {};
  for (const t of primera.detail) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t.table}";`);
    conteosAntes[t.table] = r.rows[0].n;
  }
  await client.end();

  const segunda = await ejecutarMigracionInicial();
  assert.equal(segunda.status, "ok");
  assert.equal(segunda.resumen.inserted, 0, "la segunda pasada no debería insertar nada nuevo");

  const client2 = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client2.connect();
  for (const [table, n] of Object.entries(conteosAntes)) {
    const r = await client2.query(`SELECT COUNT(*)::int AS n FROM "${table}";`);
    assert.equal(r.rows[0].n, n, `${table}: el recuento cambió al repetir la migración (posible duplicado)`);
  }
  await client2.end();

  await client2.end().catch(() => {});
});

test("comparador: no reporta diferencias tras la migración inicial", { skip: !TIENE_DB && "requiere DATABASE_URL" }, async () => {
  const { ejecutarComparacion } = await import("../comparator.mjs");
  const reportes = await ejecutarComparacion();
  const conDiferencias = reportes.filter((r) => r.estado !== "OK");
  assert.deepEqual(conDiferencias, [], `tablas con diferencias: ${conDiferencias.map((r) => r.table).join(", ")}`);
});

test("sincronización incremental: no falla en una base ya al día (no-op)", { skip: !TIENE_DB && "requiere DATABASE_URL" }, async () => {
  const { ejecutarSincronizacionIncremental } = await import("../incremental.mjs");
  const resultado = await ejecutarSincronizacionIncremental();
  assert.notEqual(resultado.status, "error", JSON.stringify(resultado.detail));
});

test("réplica caliente: la API secundaria puede leer lo migrado (settings)", { skip: !TIENE_DB && "requiere DATABASE_URL" }, async () => {
  const { Client } = pg;
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query(`SELECT key, value FROM settings WHERE key = 'redes_sociales';`);
    assert.equal(r.rows.length, 1, "settings.redes_sociales debería existir tras la migración inicial");
  } finally {
    await client.end();
  }
});
