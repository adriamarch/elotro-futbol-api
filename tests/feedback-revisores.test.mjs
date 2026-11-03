// Feedback de revisores: endpoints /api/feedback* contra una SQLite en memoria
// que imita D1 (migración real). Uso:
//   node --no-warnings --test tests/feedback-revisores.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/feedback-revisores.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'redactor',
  activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT, puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id INTEGER, descripcion TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, titulo TEXT, autor_id INTEGER, coautor_id INTEGER, publicado INTEGER DEFAULT 1);
`);
sqlite.exec(fs.readFileSync(new URL("../migracion_article_feedback.sql", import.meta.url), "utf8"));

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
globalThis.fetch = async () => new Response(null, { status: 200 });

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
function usuario(username, rol, nivel, extra = {}) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, email, puede_gestionar_tienda) VALUES (?,?,?,?,?,?)")
    .run(username, "Nombre " + username, rol, nivel, `${username}@x.es`, extra.tienda ? 1 : 0);
  return Number(r.lastInsertRowid);
}
const tokenDe = (uid, rol) => jwt({ uid, rol, nombre: "Nombre", tfa: true });

async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const U = {};
test("preparación", async () => {
  U.admin = usuario("admin", "admin", 1);
  U.n4 = usuario("nivel4", "redactor", 4);
  U.n2 = usuario("nivel2", "redactor", 2);
  U.co = usuario("coautor", "redactor", 1);
  U.tAdmin = await jwt({ uid: U.admin, rol: "admin", nombre: "Admin", tfa: true });
  U.tN4 = await jwt({ uid: U.n4, rol: "redactor", nombre: "Revisor", tfa: true });
  U.tN2 = await jwt({ uid: U.n2, rol: "redactor", nombre: "Redactora", tfa: true });
  U.tCo = await jwt({ uid: U.co, rol: "redactor", nombre: "Coautor", tfa: true });
  U.art = Number(sqlite.prepare("INSERT INTO articles (slug, titulo, autor_id, coautor_id) VALUES (?,?,?,?)").run("mi-pieza", "Mi pieza", U.n2, U.co).lastInsertRowid);
});

test("sin sesión no hay acceso", async () => {
  assert.equal((await api("/api/feedback")).status, 401);
  assert.equal((await api("/api/feedback/resumen")).status, 401);
  assert.equal((await api("/api/feedback/leido", { method: "POST", body: {} })).status, 401);
});

test("ya no existe POST /api/feedback (la nota solo se da al subir o programar)", async () => {
  const r = await api("/api/feedback", { method: "POST", body: { article_id: U.art, nota: "x" }, token: U.tN4 });
  assert.notEqual(r.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM article_feedback").get().n, 0);
});

test("el redactor ve su feedback con contador (filas de prueba)", async () => {
  const ins = sqlite.prepare("INSERT INTO article_feedback (article_id, article_titulo, destinatario_id, autor_feedback_id, autor_feedback_nombre, tipo, nota) VALUES (?,?,?,?,?,?,?)");
  ins.run(U.art, "Mi pieza", U.n2, U.n4, "Revisor", "aprobada", "Buen titular");
  ins.run(U.art, "Mi pieza", U.co, U.n4, "Revisor", "aprobada", "Buen titular");
  const r = await api("/api/feedback", { token: U.tN2 });
  assert.equal(r.status, 200);
  assert.equal(r.data.no_leidos, 1);
  assert.equal(r.data.feedback[0].tipo, "aprobada");
  assert.equal(r.data.feedback[0].autor_feedback_nombre, "Revisor");
  assert.equal((await api("/api/feedback", { token: U.tAdmin })).data.feedback.length, 0);
  assert.equal((await api("/api/feedback/resumen", { token: U.tCo })).data.no_leidos, 1);
});

test("marcar como leído solo afecta al propio usuario", async () => {
  assert.equal((await api("/api/feedback/leido", { method: "POST", body: {}, token: U.tN2 })).status, 200);
  assert.equal((await api("/api/feedback/resumen", { token: U.tN2 })).data.no_leidos, 0);
  assert.equal((await api("/api/feedback/resumen", { token: U.tCo })).data.no_leidos, 1);
});
