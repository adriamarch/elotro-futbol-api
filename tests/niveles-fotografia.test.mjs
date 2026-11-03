// Niveles de fotografía (F1–F2): escala propia, guardada en users.nivel (1 = F1, 2 = F2).
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria que imita D1.
//   node --no-warnings --test tests/niveles-fotografia.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/niveles-fotografia.test.mjs
//
// Qué protege:
//   1. Un admin puede poner a un fotógrafo en F1 o F2 (nunca 3 ni 4); un redactor sigue en N1–N4.
//   2. "Mi progreso" de un fotógrafo devuelve su escala (2 niveles, 7 criterios, sin cifras mínimas).
//   3. Un fotógrafo arrastrando un nivel de redacción alto se muestra recortado a F2.
//   4. Pasar de redactor a fotógrafo (o al revés) reinicia el nivel: un N2 no se convierte en F2 ni
//      un F2 en N2 (que daría publicación directa sin revisión).
//   5. Solo un admin cambia niveles.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT,
  rol TEXT NOT NULL DEFAULT 'redactor', activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, nivel_nota TEXT, email TEXT,
  equipo TEXT, categorias_fijas TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, user_agent TEXT, ip TEXT,
  created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT,
  entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE nivel_historial (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL, usuario_nombre TEXT NOT NULL,
  nivel_anterior INTEGER NOT NULL, nivel_nuevo INTEGER NOT NULL, motivo TEXT, cambiado_por_id INTEGER, cambiado_por_nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, autor_id INTEGER, coautor_id INTEGER, tipo TEXT, publicado INTEGER DEFAULT 1);
CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL, media_id INTEGER NOT NULL, orden INTEGER NOT NULL DEFAULT 0,
  vinculado_por_id INTEGER, equipo TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

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
function usuario(username, rol, nivel = 1) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, activo, email) VALUES (?,?,?,?,1,?)")
    .run(username, "Nombre " + username, rol, nivel, `${username}@x.es`);
  return Number(r.lastInsertRowid);
}
let contador = 0;
async function sesion(uid, rol) {
  const sid = `sid-nf-${++contador}`;
  sqlite.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(sid, uid);
  return { sid, token: await jwt({ uid, rol, nombre: "Nombre", tfa: true, sid }) };
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
const nivelEnBD = (id) => sqlite.prepare("SELECT nivel FROM users WHERE id = ?").get(id).nivel;

const U = {};
test("preparación: admin, fotógrafo y redactor", async () => {
  U.admin = usuario("admin", "admin", 4);
  U.foto = usuario("foto", "fotografo", 1);
  U.red = usuario("redactor", "redactor", 1);
  U.sAdmin = await sesion(U.admin, "admin");
  U.sFoto = await sesion(U.foto, "fotografo");
  U.sRed = await sesion(U.red, "redactor");
});

test("1. un admin pone a un fotógrafo en F2 y vuelve a F1; F3/F4/F0 se rechazan", async () => {
  let r = await api(`/api/users/${U.foto}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 2, nota: "Muy buena evolución" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.es_fotografo, true);
  assert.equal(r.data.nivel_actual, 2);
  assert.equal(r.data.nivel_info.etiqueta, "F2");
  assert.equal(r.data.nivel_maximo, true);
  assert.equal(r.data.siguiente_nivel, null);
  assert.equal(nivelEnBD(U.foto), 2);

  for (const malo of [3, 4, 0, "x"]) {
    r = await api(`/api/users/${U.foto}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: malo } });
    assert.equal(r.status, 400, `nivel ${malo} no vale para un fotógrafo`);
    assert.match(r.data.error, /F1 o F2/);
  }
  assert.equal(nivelEnBD(U.foto), 2, "los rechazos no tocan el nivel");

  r = await api(`/api/users/${U.foto}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.nivel_info.etiqueta, "F1");
  assert.equal(r.data.siguiente_nivel, 2);

  const hist = sqlite.prepare("SELECT nivel_anterior, nivel_nuevo FROM nivel_historial WHERE usuario_id = ? ORDER BY id").all(U.foto);
  assert.deepEqual(hist.map((h) => [h.nivel_anterior, h.nivel_nuevo]), [[1, 2], [2, 1]]);
  const log = sqlite.prepare("SELECT descripcion FROM activity_log WHERE accion = 'cambiar_nivel_usuario' ORDER BY id").all();
  assert.match(log[0].descripcion, /de F1 a F2/);
});

test("1. un redactor sigue pudiendo llegar a N4 y no pasa de ahí", async () => {
  let r = await api(`/api/users/${U.red}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 4 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.nivel_actual, 4);
  assert.equal(r.data.es_fotografo, undefined);
  r = await api(`/api/users/${U.red}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 5 } });
  assert.equal(r.status, 400);
  await api(`/api/users/${U.red}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 1 } });
});

test("2. /api/me/nivel de un fotógrafo: 2 niveles, 7 criterios, sin cifras mínimas", async () => {
  const gal = sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (?,?,?)");
  gal.run(10, 1, U.foto); gal.run(10, 2, U.foto); gal.run(11, 3, U.foto); gal.run(12, 4, U.red);
  const r = await api("/api/me/nivel", { token: U.sFoto.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.es_fotografo, true);
  assert.equal(r.data.nivel_actual, 1);
  assert.equal(r.data.niveles.length, 2);
  assert.deepEqual(r.data.niveles.map((n) => n.etiqueta), ["F1", "F2"]);
  assert.ok(r.data.niveles.every((n) => n.requisitos === null && n.funciones.length > 0));
  assert.equal(r.data.criterios.length, 7);
  assert.equal(r.data.progreso, null, "no hay barras de progreso numéricas");
  assert.deepEqual(r.data.actividad, { partidos: 2, fotos: 3 });
});

test("3. un fotógrafo con nivel de redacción alto en la base se muestra como F2, no como N3", async () => {
  const id = usuario("foto-viejo", "fotografo", 3);
  const s = await sesion(id, "fotografo");
  const r = await api("/api/me/nivel", { token: s.token });
  assert.equal(r.data.nivel_actual, 2);
  assert.equal(r.data.nivel_info.etiqueta, "F2");
});

test("4. cambiar de redactor a fotógrafo (y al revés) reinicia el nivel", async () => {
  const idR = usuario("n2", "redactor", 2);
  let r = await api(`/api/users/${idR}`, { method: "PUT", token: U.sAdmin.token, body: { rol: "fotografo" } });
  assert.equal(r.status, 200);
  assert.equal(nivelEnBD(idR), 1, "un N2 pasa a F1, no a F2");

  await api(`/api/users/${idR}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 2 } });
  assert.equal(nivelEnBD(idR), 2);
  r = await api(`/api/users/${idR}`, { method: "PUT", token: U.sAdmin.token, body: { rol: "redactor" } });
  assert.equal(r.status, 200);
  assert.equal(nivelEnBD(idR), 1, "un F2 vuelve a N1: no hereda publicación directa");

  // Editar solo el nombre no toca el nivel
  await api(`/api/users/${idR}/nivel`, { method: "PUT", token: U.sAdmin.token, body: { nivel: 3 } });
  await api(`/api/users/${idR}`, { method: "PUT", token: U.sAdmin.token, body: { nombre: "Otro Nombre" } });
  assert.equal(nivelEnBD(idR), 3);
});

test("5. solo un admin cambia niveles", async () => {
  let r = await api(`/api/users/${U.foto}/nivel`, { method: "PUT", token: U.sFoto.token, body: { nivel: 2 } });
  assert.equal(r.status, 403);
  r = await api(`/api/users/${U.foto}/nivel`, { method: "PUT", token: U.sRed.token, body: { nivel: 2 } });
  assert.equal(r.status, 403);
  assert.equal(nivelEnBD(U.foto), 1);
});
