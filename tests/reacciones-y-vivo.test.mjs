// Reacciones a una noticia ("Útil" / "Me gusta") y estado en vivo de un partido en una petición (/vivo).
//   node --no-warnings --test tests/reacciones-y-vivo.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/reacciones-y-vivo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT, slug TEXT, publicado INTEGER NOT NULL DEFAULT 1);
CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, estado TEXT NOT NULL DEFAULT 'en_juego', goles_local INTEGER, goles_visitante INTEGER);
CREATE TABLE match_events (id INTEGER PRIMARY KEY AUTOINCREMENT, resultado_id INTEGER NOT NULL, tipo TEXT, equipo TEXT, jugador TEXT,
  jugador_sale TEXT, jugador_asistencia TEXT, minuto INTEGER, minuto_extra INTEGER, orden INTEGER, bajar_gol INTEGER, var_motivo TEXT,
  var_decision TEXT, es_penalti INTEGER, motivo_tarjeta TEXT);
`);
// La tabla real, tal cual está en la migración (sin la FK, que aquí no hace falta).
sqlite.exec(readFileSync(new URL("../migracion_reacciones_noticias.sql", import.meta.url), "utf8")
  .replace(/REFERENCES articles\(id\) ON DELETE CASCADE/, ""));

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
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef" };
const ctx = { waitUntil() {} };

async function api(ruta, { method = "GET", body } = {}) {
  const headers = body ? { "Content-Type": "application/json" } : {};
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const articulo = (publicado = 1) => Number(sqlite.prepare("INSERT INTO articles (titulo, slug, publicado) VALUES ('t','s',?)").run(publicado).lastInsertRowid);
const reaccionar = (art, votanteId, tipo, activo) => api(`/api/articles/${art}/reactions`, { method: "POST", body: { votanteId, tipo, activo } });

test("reacciones: marcar, no duplicar, combinar tipos y quitar", async () => {
  const art = articulo();
  assert.deepEqual((await api(`/api/articles/${art}/reactions`)).data, { ok: true, util: 0, me_gusta: 0 });

  let r = await reaccionar(art, "ana", "util", true);
  assert.equal(r.status, 200);
  assert.equal(r.data.util, 1);
  r = await reaccionar(art, "ana", "util", true); // repetida: no suma
  assert.equal(r.data.util, 1);
  r = await reaccionar(art, "ana", "me_gusta", true); // otro tipo del mismo votante: sí
  assert.deepEqual([r.data.util, r.data.me_gusta], [1, 1]);
  r = await reaccionar(art, "luis", "util", true);
  assert.equal(r.data.util, 2);

  r = await reaccionar(art, "ana", "util", false); // quitar
  assert.deepEqual([r.data.util, r.data.me_gusta, r.data.activo], [1, 1, false]);
  r = await reaccionar(art, "ana", "util", false); // quitar de nuevo: sin efecto ni error
  assert.equal(r.data.util, 1);
});

test("reacciones: validaciones", async () => {
  const art = articulo();
  assert.equal((await reaccionar(art, "ana", "otra", true)).status, 400);
  assert.equal((await reaccionar(art, "", "util", true)).status, 400);
  assert.equal((await reaccionar(art, "x".repeat(65), "util", true)).status, 400);
  assert.equal((await api(`/api/articles/${art}/reactions`, { method: "POST", body: { votanteId: "a", tipo: "util" } })).status, 400);
  assert.equal((await reaccionar(articulo(0), "ana", "util", true)).status, 404); // no publicada
  assert.equal((await reaccionar(999999, "ana", "util", true)).status, 404);
});

test("/vivo: marcador + eventos en una petición, y sin eventos si no han cambiado", async () => {
  const id = Number(sqlite.prepare("INSERT INTO results (estado, goles_local, goles_visitante) VALUES ('en_juego', 1, 0)").run().lastInsertRowid);
  sqlite.prepare("INSERT INTO match_events (resultado_id, tipo, equipo, jugador, minuto, orden) VALUES (?, 'gol', 'local', 'Pérez', 12, 1)").run(id);

  const a = await api(`/api/results/${id}/vivo`);
  assert.equal(a.status, 200);
  assert.equal(a.data.resultado.goles_local, 1);
  assert.equal(a.data.eventos.length, 1);
  assert.ok(a.data.firma);

  const b = await api(`/api/results/${id}/vivo?firma=${encodeURIComponent(a.data.firma)}`);
  assert.equal(b.data.eventos, null);          // mismos eventos: no se reenvían
  assert.equal(b.data.resultado.id, id);       // pero el partido (marcador, reloj) sí llega
  assert.equal(b.data.firma, a.data.firma);

  assert.equal((await api(`/api/results/999999/vivo`)).status, 404);
});

test("/vivo: un partido programado no lleva eventos", async () => {
  const id = Number(sqlite.prepare("INSERT INTO results (estado) VALUES ('programado')").run().lastInsertRowid);
  const r = await api(`/api/results/${id}/vivo`);
  assert.equal(r.data.eventos, null);
  assert.equal(r.data.firma, "");
});
