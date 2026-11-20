// Sitemap de partidos (/sitemap-partidos.xml): URLs del centro de partido.
//   node --no-warnings --test tests/sitemap-partidos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/sitemap-partidos.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const columnas = (t) => sqlite.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [tabla, col, mig] of [
  ["articles", "banner_urgente", "migracion_banner_urgente.sql"],
  ["results", "mvp_jugador", "migracion_mvp_partido.sql"],
  ["results", "finalizado_no_cubierto", "migracion_fin_no_cubierto.sql"],
]) {
  if (!columnas(tabla).includes(col)) sqlite.exec(readFileSync(new URL("../" + mig, import.meta.url), "utf8"));
}

const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...limpiar(args)) ?? null,
      all: async () => ({ results: st.all(...limpiar(args)) }),
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
};
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef", TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil() {} };
const pedir = (ruta, entorno = env) => worker.fetch(new Request("https://api.test" + ruta), entorno, ctx);

const dia = (delta) => new Date(Date.now() + delta * 86400000).toISOString().slice(0, 10);
const insertar = (local, estado, fecha, sinCubrir = 0) => Number(sqlite.prepare(
  `INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado, finalizado_no_cubierto)
   VALUES ('hypermotion', 1, ?, 'Rival & Co', 1, 0, ?, ?, ?)`).run(local, fecha, estado, sinCubrir).lastInsertRowid);

const finalizado = insertar("CD Lugo", "finalizado", `${dia(-3)}T18:00`);
const enJuego = insertar("Real Oviedo", "en_juego", `${dia(0)}T20:00`);
const proximo = insertar("Racing", "programado", `${dia(5)}T16:30`);
const lejano = insertar("Albacete", "programado", `${dia(90)}T16:30`);
const olvidado = insertar("Eibar", "programado", `${dia(-20)}T16:30`);
const aplazado = insertar("Mirandés", "anulado", `${dia(2)}T16:30`);
const sinCubrir = insertar("Tenerife", "finalizado", `${dia(-6)}T16:30`, 1);
const sinFecha = insertar("Cartagena", "programado", null);

const url = (id) => `https://elotrofutbol.media/minuto-a-minuto?id=${id}`;

test("sitemap-partidos.xml: XML válido con los partidos que merecen indexarse", async () => {
  const r = await pedir("/sitemap-partidos.xml");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /application\/xml/);
  const xml = await r.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  for (const id of [finalizado, enJuego, proximo]) assert.ok(xml.includes(`<loc>${url(id)}</loc>`), `falta el partido ${id}`);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.ok(!/&(?!amp;)/.test(xml), "ningún & sin escapar");
});

test("sitemap-partidos.xml: sin aplazados, sin cubrir, sin fecha, lejanos ni programados olvidados", async () => {
  const xml = await (await pedir("/sitemap-partidos.xml")).text();
  for (const id of [lejano, olvidado, aplazado, sinCubrir, sinFecha]) assert.ok(!xml.includes(`<loc>${url(id)}</loc>`), `no debería estar el partido ${id}`);
});

test("sitemap-partidos.xml: si la base de datos falla responde 503, no un sitemap vacío", async () => {
  const roto = { ...env, DB: { prepare() { throw new Error("D1 caída"); } } };
  const r = await pedir("/sitemap-partidos.xml", roto);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("Retry-After"), "300");
});
