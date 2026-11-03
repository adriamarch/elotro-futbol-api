// "Penalti pitado" del panel de Minuto a Minuto: gol de penalti (match_events.es_penalti).
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que imita D1.
//   node --no-warnings --test tests/gol-penalti.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/gol-penalti.test.mjs
//
// Qué protege:
//   1. Un "gol" con es_penalti se guarda, se devuelve en GET y suma al marcador como cualquier gol.
//   2. Un gol de penalti no lleva asistencia, y es_penalti solo vale para tipo "gol".
//   3. El penalti fallado (tipo "penalti_fallado") no toca el marcador.
//   4. Editar un evento sin mandar es_penalti (editores antiguos) NO le quita la marca.
//   5. La migración (D1 y PostgreSQL) y schema.sql incluyen la columna, y los goles ya guardados quedan en 0.
//   6. Etiquetas del panel y de la web pública.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const leer = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

// Las tablas "results" y "match_events" son las REALES de schema.sql: si alguien quita la columna, el test falla.
const sqlite = new DatabaseSync(":memory:");
const schema = leer("../schema.sql");
const tabla = (nombre) => {
  const a = schema.indexOf(`CREATE TABLE ${nombre} (`);
  const b = schema.indexOf("\n);", a);
  assert.ok(a >= 0 && b > a, `schema.sql: no encuentro CREATE TABLE ${nombre}`);
  return schema.slice(a, b + 3);
};
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT,
  rol TEXT NOT NULL DEFAULT 'redactor', activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT,
  equipo TEXT, categorias_fijas TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, user_agent TEXT, ip TEXT,
  created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT,
  entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE edit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo_entidad TEXT, entidad_id INTEGER, solicitante_id INTEGER,
  autor_id INTEGER, estado TEXT, permiso_expira_at TEXT, resuelta_at TEXT);
`);
sqlite.exec(tabla("results"));
sqlite.exec(tabla("match_events"));

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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { pendientes: [], waitUntil(p) { this.pendientes.push(Promise.resolve(p).catch(() => {})); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const ahora = Math.floor(Date.now() / 1000);
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ iat: ahora, exp: ahora + 600, ...payload })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(ctx.pendientes.splice(0));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let token, partido;
const marcador = () => sqlite.prepare("SELECT goles_local, goles_visitante FROM results WHERE id = ?").get(partido);
const eventos = async () => (await api(`/api/results/${partido}/eventos`)).data.eventos;
const crear = (body) => api(`/api/results/${partido}/eventos`, { method: "POST", token, body: { minuto: 10, equipo: "local", ...body } });

test("preparación: admin con sesión y un partido en juego", async () => {
  const uid = Number(sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, activo, email) VALUES ('admin','Admin','admin',4,1,'a@x.es')").run().lastInsertRowid);
  sqlite.prepare("INSERT INTO sessions (id, user_id) VALUES ('sid-pen', ?)").run(uid);
  token = await jwt({ uid, rol: "admin", nombre: "Admin", tfa: true, sid: "sid-pen" });
  partido = Number(sqlite.prepare("INSERT INTO results (competicion, jornada, autor_id, equipo_local, equipo_visitante, estado, goles_local, goles_visitante) VALUES ('hypermotion', 1, ?, 'Local', 'Visitante', 'en_juego', 0, 0)").run(uid).lastInsertRowid);
});

test("1. gol de penalti: se guarda, se devuelve en GET y suma al marcador", async () => {
  const r = await crear({ tipo: "gol", jugador: "9 · Delantero", es_penalti: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ev = (await eventos()).find((e) => e.id === r.data.id);
  assert.equal(ev.tipo, "gol");
  assert.equal(ev.es_penalti, 1);
  assert.equal(ev.jugador, "9 · Delantero");
  assert.deepEqual({ ...marcador() }, { goles_local: 1, goles_visitante: 0 });
});

test("1. gol normal: es_penalti = 0 (también si el cliente no manda el campo)", async () => {
  const r = await crear({ tipo: "gol", jugador: "Otro", minuto: 20 });
  assert.equal(r.status, 200);
  const ev = (await eventos()).find((e) => e.id === r.data.id);
  assert.equal(ev.es_penalti, 0);
  assert.equal(marcador().goles_local, 2);
});

test("2. un gol de penalti no guarda asistencia; uno normal sí", async () => {
  const pen = await crear({ tipo: "gol", jugador: "A", jugador_asistencia: "Nadie", es_penalti: true, minuto: 30, equipo: "visitante" });
  const normal = await crear({ tipo: "gol", jugador: "B", jugador_asistencia: "Pasador", minuto: 31, equipo: "visitante" });
  const evs = await eventos();
  assert.equal(evs.find((e) => e.id === pen.data.id).jugador_asistencia, null);
  assert.equal(evs.find((e) => e.id === normal.data.id).jugador_asistencia, "Pasador");
  assert.deepEqual({ ...marcador() }, { goles_local: 2, goles_visitante: 2 });
});

test("2. es_penalti solo vale para tipo \"gol\" (en una amarilla se ignora)", async () => {
  const r = await crear({ tipo: "amarilla", jugador: "C", es_penalti: true, minuto: 40 });
  assert.equal(r.status, 200);
  assert.equal((await eventos()).find((e) => e.id === r.data.id).es_penalti, 0);
});

test("3. penalti fallado: queda registrado y NO toca el marcador", async () => {
  const antes = { ...marcador() };
  const r = await crear({ tipo: "penalti_fallado", jugador: "Lanzador", minuto: 50 });
  assert.equal(r.status, 200);
  const ev = (await eventos()).find((e) => e.id === r.data.id);
  assert.equal(ev.tipo, "penalti_fallado");
  assert.equal(ev.es_penalti, 0);
  assert.deepEqual({ ...marcador() }, antes);
});

test("4. editar SIN mandar es_penalti (editor antiguo) conserva la marca", async () => {
  const id = (await crear({ tipo: "gol", jugador: "P", es_penalti: true, minuto: 60 })).data.id;
  const r = await api(`/api/results/${partido}/eventos/${id}`, { method: "PUT", token, body: { tipo: "gol", equipo: "local", jugador: "P corregido", minuto: 61 } });
  assert.equal(r.status, 200);
  const ev = (await eventos()).find((e) => e.id === id);
  assert.equal(ev.es_penalti, 1, "la marca de penalti se ha perdido al editar");
  assert.equal(ev.jugador, "P corregido");
  assert.equal(ev.minuto, 61);
});

test("4. editar mandando es_penalti: false la quita; true la pone; cambiar de tipo la limpia", async () => {
  const id = (await crear({ tipo: "gol", jugador: "Q", es_penalti: true, minuto: 70 })).data.id;
  const put = (body) => api(`/api/results/${partido}/eventos/${id}`, { method: "PUT", token, body: { equipo: "local", minuto: 70, ...body } });
  assert.equal((await put({ tipo: "gol", es_penalti: false })).status, 200);
  assert.equal((await eventos()).find((e) => e.id === id).es_penalti, 0);
  assert.equal((await put({ tipo: "gol", es_penalti: true, jugador_asistencia: "X" })).status, 200);
  const ev = (await eventos()).find((e) => e.id === id);
  assert.equal(ev.es_penalti, 1);
  assert.equal(ev.jugador_asistencia, null);
  assert.equal((await put({ tipo: "penalti_fallado" })).status, 200);
  assert.equal((await eventos()).find((e) => e.id === id).es_penalti, 0, "al dejar de ser gol no debe quedar la marca");
});

test("4. borrar un gol de penalti baja el marcador", async () => {
  const antes = marcador().goles_local;
  const id = (await crear({ tipo: "gol", jugador: "R", es_penalti: true, minuto: 80 })).data.id;
  assert.equal(marcador().goles_local, antes + 1);
  assert.equal((await api(`/api/results/${partido}/eventos/${id}`, { method: "DELETE", token })).status, 200);
  assert.equal(marcador().goles_local, antes);
});

test("5. migración D1: añade la columna y los goles ya guardados quedan como gol normal (0)", () => {
  const bd = new DatabaseSync(":memory:");
  bd.exec("CREATE TABLE match_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, equipo TEXT NOT NULL, minuto INTEGER NOT NULL);");
  bd.exec("INSERT INTO match_events (tipo, equipo, minuto) VALUES ('gol', 'local', 5)");
  bd.exec(leer("../migracion_gol_penalti.sql"));
  assert.equal(bd.prepare("SELECT es_penalti FROM match_events").get().es_penalti, 0);
  assert.ok(bd.prepare("PRAGMA table_info(match_events)").all().some((c) => c.name === "es_penalti" && c.notnull === 1));
});

test("5. esquemas y migración de PostgreSQL incluyen la columna", () => {
  for (const f of ["../schema.sql", "../../worker-secondary/schema.sql"]) {
    const s = leer(f);
    const a = s.indexOf("CREATE TABLE match_events (");
    const t = s.slice(a, s.indexOf("\n);", a));
    assert.match(t, /es_penalti INTEGER NOT NULL DEFAULT 0/, f);
  }
  assert.match(leer("../../worker-secondary/db/migrations/071_gol_penalti.sql"), /ADD COLUMN IF NOT EXISTS es_penalti INTEGER NOT NULL DEFAULT 0/);
  assert.match(leer("../../worker-secondary/verify-postgres-schema.mjs"), /"es_penalti"/);
});

// ---- Etiquetas (panel de redacción y web pública) ----
const corte = (src, desde, hasta) => { const a = src.indexOf(desde), b = src.indexOf(hasta, a); assert.ok(a >= 0 && b > a, "no encuentro " + desde); return src.slice(a, b); };

test("6. panel: el gol de penalti se rotula \"Gol de penalti\" y el resto no cambia", () => {
  const mam = leer("../../public/admin/js/minuto-a-minuto.js");
  const c = vm.createContext({});
  vm.runInContext(corte(mam, "const MAM_ETIQUETAS", "// Revisión VAR:") + corte(mam, "function mamEtiquetaTipo", "// ---------- Penalti pitado") + "\nthis.et = mamEtiquetaTipo;", c);
  assert.equal(c.et("gol", true), "Gol de penalti");
  assert.equal(c.et("gol", false), "Gol");
  assert.equal(c.et("penalti_fallado", false), "Penalti fallado");
  assert.equal(c.et("penalti_fallado", true), "Penalti fallado");
  assert.equal(c.et("tipo_raro", false), "tipo_raro");
});

test("6. web pública: etiqueta del gol de penalti", () => {
  const cfg = leer("../../public/js/config.js");
  const c = vm.createContext({});
  vm.runInContext(corte(cfg, "const ETIQUETAS_EVENTO_PUBLICO", "// Revisión VAR") .replace(/\n\/\/[^\n]*$/, "") + "\n" + corte(cfg, "function etiquetaEventoPublico", "function formatMinutoEventoPublico") + "\nthis.et = etiquetaEventoPublico;", c);
  assert.equal(c.et({ tipo: "gol", es_penalti: 1 }), "Gol de penalti");
  assert.equal(c.et({ tipo: "gol", es_penalti: 0 }), "Gol");
  assert.equal(c.et({ tipo: "gol" }), "Gol");
  assert.equal(c.et({ tipo: "penalti_fallado" }), "Penalti fallado");
});
