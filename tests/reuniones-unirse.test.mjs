// Unirse a una reunión YA confirmada: el propio participante (public/unirse) o el Responsable (admin/unir).
// Ejecuta el handler REAL contra SQLite en memoria (API de D1) y simula la API de Resend. Uso:
//   node --no-warnings --test tests/reuniones-unirse.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/reuniones-unirse.test.mjs
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
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'redactor',
  activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT, puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE reunions_franges (clau TEXT PRIMARY KEY, estat TEXT NOT NULL, grup TEXT, enllac TEXT, nota TEXT, updated_at TEXT NOT NULL);
CREATE TABLE reunions_persones (pid TEXT PRIMARY KEY, nom TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, user_id INTEGER);
CREATE TABLE reunions_vots (pid TEXT NOT NULL, clau TEXT NOT NULL, PRIMARY KEY (pid, clau));
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
  batch: async (sts) => { for (const st of sts) await st.run(); return []; },
};

const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1", RESEND_API_KEY: "re_prueba" };
const correos = [];           // lo que "sale" por Resend
let respuestasResend = [];    // códigos a devolver, en orden (vacío = 200)
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.resend.com/emails")) return new Response(null, { status: 201 });
  const b = JSON.parse(init.body);
  const status = respuestasResend.length ? respuestasResend.shift() : 200;
  if (status === 200) correos.push({ para: b.to[0], asunto: b.subject, texto: b.text, html: b.html, replyTo: b.reply_to });
  return new Response(JSON.stringify({ id: "x" }), { status });
};

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const tokenDe = (uid, rol) => jwt({ uid, rol, nombre: "x", tfa: true });
function usuario(username, nombre, rol, email) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)").run(username, nombre, rol, email);
  return Number(r.lastInsertRowid);
}
async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const persona = (pid, nom, userId) => {
  const ahora = new Date().toISOString();
  sqlite.prepare("INSERT INTO reunions_persones (pid, nom, secret, created_at, updated_at, user_id) VALUES (?, ?, 's', ?, ?, ?)").run(pid, nom, ahora, ahora, userId ?? null);
};
const vota = (pid, clau) => sqlite.prepare("INSERT OR IGNORE INTO reunions_vots (pid, clau) VALUES (?, ?)").run(pid, clau);
const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const reiniciar = () => { for (const t of ["reunions_franges", "reunions_vots", "settings"]) sqlite.exec(`DELETE FROM ${t}`); correos.length = 0; respuestasResend = []; };
const paras = () => correos.map((c) => c.para).sort();

const T = {}; const U = {};
const votantesDe = (clau) => sqlite.prepare("SELECT pid FROM reunions_vots WHERE clau = ? ORDER BY pid").all(clau).map((r) => r.pid);
const confirmada = async (n, hora = "10:00", franjas = 2) => {
  const ini = dia(n) + "T" + hora;
  const r = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: franjas } });
  assert.equal(r.status, 200);
  return { ini, grup: sqlite.prepare("SELECT grup FROM reunions_franges WHERE clau = ?").get(ini).grup };
};

test("preparación", async () => {
  U.admin = usuario("admin", "Admin Jefe", "admin", "jefe@x.es");
  U.ana = usuario("ana", "Ana Pérez", "redactor", "ana@x.es");
  T.admin = await tokenDe(U.admin, "admin");
  T.ana = await tokenDe(U.ana, "redactor");
  persona("p-ana", "Ana Pérez", U.ana);
  persona("p-luis", "Luis Antiguo", null);
  await api("/api/reunions/admin", { token: T.admin });
  await api("/api/reunions/admin/config", { method: "PUT", token: T.admin, body: { obert: true } });
});

test("el Responsable apunta a un participante a una reunión ya confirmada (todas sus franjas)", async () => {
  reiniciar();
  vota("p-ana", dia(2) + "T10:00");
  const { ini, grup } = await confirmada(2);
  const r = await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "p-luis" } });
  assert.equal(r.status, 200);
  assert.deepEqual(votantesDe(ini), ["p-ana", "p-luis"]);
  assert.deepEqual(votantesDe(dia(2) + "T10:30"), ["p-luis"]);
  // Repetirlo no duplica nada
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "p-luis" } })).status, 200);
  assert.deepEqual(votantesDe(ini), ["p-ana", "p-luis"]);
});

test("solo un Responsable puede usar admin/unir; participante o reunión inexistentes dan error", async () => {
  reiniciar();
  const { grup } = await confirmada(2);
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.ana, body: { grup, pid: "p-luis" } })).status, 403);
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "no-existe" } })).status, 404);
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup: "aaaaaaaa", pid: "p-luis" } })).status, 404);
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup: "../x", pid: "p-luis" } })).status, 400);
});

test("una reunión cancelada o ya celebrada no admite a nadie", async () => {
  reiniciar();
  const { grup } = await confirmada(2);
  await api("/api/reunions/admin/cancelar", { method: "POST", token: T.admin, body: { grup } });
  assert.equal((await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "p-luis" } })).status, 404);
  const pasada = dia(-2) + "T10:00";
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, updated_at) VALUES (?, 'confirmada', 'bbbbbbbb', ?)").run(pasada, new Date().toISOString());
  const r = await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup: "bbbbbbbb", pid: "p-luis" } });
  assert.equal(r.status, 409);
  assert.deepEqual(votantesDe(pasada), []);
});

test("el participante se une él mismo con su identidad; con calendario cerrado no puede", async () => {
  reiniciar();
  const { ini, grup } = await confirmada(3);
  sqlite.prepare("UPDATE reunions_persones SET secret = 'sec-luis' WHERE pid = 'p-luis'").run();
  const mal = await api("/api/reunions/public/unirse", { method: "POST", token: T.ana, body: { grup, pid: "p-luis", secret: "otro", nom: "" } });
  assert.equal(mal.status, 400); // identidad no válida y sin nombre: no se une
  assert.deepEqual(votantesDe(ini), []);
  const ok = await api("/api/reunions/public/unirse", { method: "POST", token: T.ana, body: { grup, pid: "p-luis", secret: "sec-luis" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(votantesDe(ini), ["p-luis"]);
  await api("/api/reunions/admin/config", { method: "PUT", token: T.admin, body: { obert: false } });
  const cerrado = await api("/api/reunions/public/unirse", { method: "POST", token: T.ana, body: { grup, pid: "p-ana", secret: "s" } });
  assert.equal(cerrado.status, 403);
  await api("/api/reunions/admin/config", { method: "PUT", token: T.admin, body: { obert: true } });
});

test("una persona nueva se une dando su nombre; un nombre repetido se rechaza", async () => {
  reiniciar();
  const { ini, grup } = await confirmada(3, "12:00", 1);
  const r = await api("/api/reunions/public/unirse", { method: "POST", token: T.ana, body: { grup, nom: "Marta Nueva" } });
  assert.equal(r.status, 200);
  assert.ok(r.data.pid && r.data.secret);
  assert.deepEqual(votantesDe(ini), [r.data.pid]);
  const dup = await api("/api/reunions/public/unirse", { method: "POST", token: T.ana, body: { grup, nom: "marta nueva" } });
  assert.equal(dup.status, 409);
});

test("al unirse se envía la convocatoria por correo solo a esa persona (si tiene cuenta con correo)", async () => {
  reiniciar();
  const { grup } = await confirmada(4);
  correos.length = 0;
  const r = await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "p-ana" } });
  assert.equal(r.status, 200);
  assert.deepEqual(correos.map((c) => c.para), ["ana@x.es"]);
  assert.match(correos[0].asunto, /^Convocatoria/);
  assert.equal(r.data.correo.enviados, 1);
  // Sin cuenta con correo: se une igualmente, pero no sale ningún correo.
  correos.length = 0;
  const r2 = await api("/api/reunions/admin/unir", { method: "POST", token: T.admin, body: { grup, pid: "p-luis" } });
  assert.equal(r2.status, 200);
  assert.equal(correos.length, 0);
  assert.equal(r2.data.correo.enviados, 0);
});
