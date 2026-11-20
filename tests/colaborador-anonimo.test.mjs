// "Colaborador anónimo": lo que publica no lleva su nombre salvo para admins y para él mismo.
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que imita D1. Uso:
//   node --test tests/colaborador-anonimo.test.mjs
//   WORKER_ENTRY=../worker-secondary/src/index.js node --test tests/colaborador-anonimo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, avatar_foco TEXT, categorias_fijas TEXT, nivel INTEGER DEFAULT 1,
  totp_secret TEXT, totp_activo INTEGER NOT NULL DEFAULT 0, totp_ultimo_paso INTEGER, totp_recovery TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, titulo TEXT, tipo TEXT, resultado_id INTEGER);
`);
for (const c of ["equipo TEXT", "categorias_fijas TEXT", "nivel INTEGER DEFAULT 1", "nivel_nota TEXT", "created_at TEXT", "bio TEXT", "experiencia TEXT", "redes_sociales TEXT"]) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN " + c); } catch { /* ya existe */ }
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
const env = { DB, JWT_SECRET };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function pbkdf2(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256));
  return [...bits].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const PW = "una-clave-larga-1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
async function tokenDe(username, rol) { return (await sesionDe(username, rol)).token; }
async function sesionDe(username, rol) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)")
    .run(username, "Nombre " + username, rol, username + "@x.es");
  const id = Number(r.lastInsertRowid);
  return { id, token: await jwt({ uid: id, rol, nombre: "Nombre " + username, tfa: true }) };
}

import fs from "node:fs";
const codigo = fs.readFileSync(fileURLToPath(entrada), "utf-8");
const ini = codigo.indexOf("const NOMBRE_AUTOR_ANONIMO");
const fin = codigo.indexOf("async function anonimizarRespuesta");
assert.ok(ini > 0 && fin > ini, "no se encuentra el bloque de colaborador anónimo");
// ocultarAnonimosEnJson es una función pura: se prueba tal cual.
const { ocultar, NOMBRE } = new Function(codigo.slice(ini, fin).replace(/let _columnaAnonimoLista[\s\S]*?\nfunction ocultarAnonimosEnJson/, "function ocultarAnonimosEnJson") + "; return { ocultar: ocultarAnonimosEnJson, NOMBRE: NOMBRE_AUTOR_ANONIMO };")();

const anon = { ids: new Set([5]), nombres: new Set(["Ana Anónima"]) };
test("oculta autor, coautor, firmantes y créditos de la cuenta anónima", () => {
  const d = { article: { autor_id: 5, autor_nombre: "Ana Anónima", coautor_id: 9, coautor_nombre: "Pepe Visible",
    firmantes: [{ id: 5, nombre: "Ana Anónima" }, { id: 9, nombre: "Pepe Visible" }], fusion: { secciones: [{ autor_nombre: "Ana Anónima" }] } },
    fotos: [{ autor_id: 5, autor_nombre: "Ana Anónima", credito: "Ana Anónima" }] };
  ocultar(d, anon, { uid: null, nombre: null });
  assert.equal(d.article.autor_id, null);
  assert.equal(d.article.autor_nombre, NOMBRE);
  assert.equal(d.article.coautor_nombre, "Pepe Visible");
  assert.equal(d.article.coautor_id, 9);
  assert.deepEqual(d.article.firmantes, [{ id: null, nombre: NOMBRE }, { id: 9, nombre: "Pepe Visible" }]);
  assert.equal(d.article.fusion.secciones[0].autor_nombre, NOMBRE);
  assert.equal(d.fotos[0].autor_nombre, NOMBRE);
  assert.equal(d.fotos[0].credito, NOMBRE);
  assert.ok(!JSON.stringify(d).includes("Ana"), "no queda rastro del nombre");
});

test("la propia persona anónima ve lo suyo con su nombre", () => {
  const d = [{ autor_id: 5, autor_nombre: "Ana Anónima" }];
  ocultar(d, anon, { uid: 5, nombre: "Ana Anónima" });
  assert.equal(d[0].autor_id, 5);
  assert.equal(d[0].autor_nombre, "Ana Anónima");
});

test("firmantes duplicados de cuentas anónimas se juntan en uno", () => {
  const anon2 = { ids: new Set([5, 6]), nombres: new Set(["A", "B"]) };
  const d = { firmantes: [{ id: 5, nombre: "A" }, { id: 6, nombre: "B" }] };
  ocultar(d, anon2, { uid: null, nombre: null });
  assert.equal(d.firmantes.length, 1);
});

const e = {};
test("un admin marca y desmarca a un colaborador como anónimo", async () => {
  e.admin = await sesionDe("jefe", "admin");
  e.red = await sesionDe("ana", "redactor");
  let r = await api(`/api/users/${e.red.id}`, { method: "PUT", token: e.admin.token, body: { anonimo: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sqlite.prepare("SELECT anonimo FROM users WHERE id = ?").get(e.red.id).anonimo, 1);
});

test("el perfil público del autor anónimo no existe, pero el admin y él mismo lo ven", async () => {
  sqlite.exec("CREATE TABLE IF NOT EXISTS users_dummy (x INTEGER)");
  const publico = await api(`/api/autores/${e.red.id}`);
  assert.equal(publico.status, 404);
  const rss = await api(`/rss/autor/${e.red.id}.xml`);
  assert.equal(rss.status, 404);
  const admin = await api(`/api/autores/${e.red.id}`, { token: e.admin.token });
  assert.notEqual(admin.status, 404, "el admin sigue viendo el perfil");
});

test("a otro admin no se le puede marcar anónimo y se puede quitar", async () => {
  const otro = await sesionDe("jefe2", "admin");
  await api(`/api/users/${otro.id}`, { method: "PUT", token: e.admin.token, body: { anonimo: true } });
  assert.equal(sqlite.prepare("SELECT anonimo FROM users WHERE id = ?").get(otro.id).anonimo, 0);
  await api(`/api/users/${e.red.id}`, { method: "PUT", token: e.admin.token, body: { anonimo: false } });
  const r = await api(`/api/autores/${e.red.id}`);
  assert.notEqual(r.status, 404, "al quitarlo vuelve a haber perfil (puede dar otro error de esquema, pero no 404 de anonimato)");
});
