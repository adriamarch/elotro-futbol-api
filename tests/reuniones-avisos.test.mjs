// Avisos push de reuniones (30 min, 10 min y al empezar): solo a los Responsables (admin) y a los
// participantes convocados a ESA reunión. Va por la campanita del equipo.
// Ejecuta el handler REAL contra SQLite en memoria (API de D1). Uso:
//   node --no-warnings --test tests/reuniones-avisos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/reuniones-avisos.test.mjs
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
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, publicado INTEGER DEFAULT 1);
CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER, nombre TEXT, email TEXT, texto TEXT, ip TEXT, reader_id INTEGER, parent_id INTEGER, responde_a_id INTEGER,
  estado TEXT NOT NULL DEFAULT 'pendiente', oculto_por_denuncia INTEGER NOT NULL DEFAULT 0,
  aviso_aprobado INTEGER NOT NULL DEFAULT 0, respuesta_avisada INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reunions_franges (clau TEXT PRIMARY KEY, estat TEXT NOT NULL, grup TEXT, enllac TEXT, nota TEXT, updated_at TEXT NOT NULL);
CREATE TABLE reunions_persones (pid TEXT PRIMARY KEY, nom TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE reunions_vots (pid TEXT NOT NULL, clau TEXT NOT NULL, PRIMARY KEY (pid, clau));
`);
sqlite.exec(fs.readFileSync(new URL("../migracion_staff_push.sql", import.meta.url), "utf8"));

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

const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1", VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey)) };

const envios = [];
let estadoServicio = 201;
globalThis.fetch = async (url) => { envios.push(String(url)); return new Response(null, { status: estadoServicio }); };

async function crearSuscripcion(id) {
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = Buffer.from(await crypto.subtle.exportKey("raw", par.publicKey)).toString("base64url");
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: pub, auth } };
}
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
function usuario(username, rol, nivel) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, email) VALUES (?,?,?,?,?)").run(username, "Nombre " + username, rol, nivel, `${username}@x.es`);
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
async function suscribir(id) {
  const sub = await crearSuscripcion(id);
  sqlite.prepare("INSERT INTO staff_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(U[id], sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  return sub;
}

// Hora de Madrid como "YYYY-MM-DDTHH:MM" y próxima franja de :00/:30 (entre 1 y 30 min vista).
function ahoraMadrid() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function proximaFranja() {
  const a = ahoraMadrid();
  const base = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10), +a.slice(11, 13), +a.slice(14, 16));
  const mm = +a.slice(14, 16);
  const t = new Date(base + (mm < 30 ? 30 - mm : 60 - mm) * 60000);
  return t.toISOString().slice(0, 16);
}
// pids: participantes convocados (votan la primera franja). Las personas se crean en preparación.
function crearReunion(grup, pids = ["p-part"]) {
  const ini = proximaFranja();
  const ahora = new Date().toISOString();
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', ?, NULL, 'Acogida', ?)").run(ini, grup, ahora);
  for (const pid of pids) sqlite.prepare("INSERT OR IGNORE INTO reunions_vots (pid, clau) VALUES (?, ?)").run(pid, ini);
  return ini;
}
async function correrAviso() { envios.length = 0; await worker.reunionsAvisarProximas(env); return [...envios].sort(); }
const limpiarReunion = () => { for (const t of ["reunions_franges", "reunions_vots", "reunions_avisos"]) { try { sqlite.exec(`DELETE FROM ${t}`); } catch {} } };
const urls = (...subs) => subs.map((x) => x.endpoint).sort();

const U = {}; const S = {}; const T = {};
const tokenDe = (uid, rol) => jwt({ uid, rol, nombre: "x", tfa: true });
test("preparación", async () => {
  U.admin = usuario("admin", "admin", 1);
  U.n4 = usuario("n4", "redactor", 4);            // Nivel 4 que NO participa: ya no recibe avisos de reuniones
  U.part = usuario("part", "redactor", 1);        // participante enlazado por user_id (nivel bajo)
  U.antiguo = usuario("antiguo", "redactor", 1);  // participante antiguo: sin user_id, se enlaza por nombre
  U.otro = usuario("otro", "redactor", 1);        // participa en OTRA reunión
  U.ajeno = usuario("ajeno", "redactor", 1);      // no participa en nada
  sqlite.prepare("UPDATE users SET nombre = 'Luis Antiguo' WHERE id = ?").run(U.antiguo);
  const ahora = new Date().toISOString();
  // Personas del calendario con la tabla ANTIGUA (sin user_id): el worker añade la columna en caliente.
  for (const [pid, nom] of [["p-part", "Ana Pérez"], ["p-antiguo", "Luis Antiguo"], ["p-otro", "Otro Persona"]]) {
    sqlite.prepare("INSERT INTO reunions_persones (pid, nom, secret, created_at, updated_at) VALUES (?, ?, 's', ?, ?)").run(pid, nom, ahora, ahora);
  }
  // Fuerza la creación de la columna como haría cualquier llamada a /api/reunions o a la campanita.
  T.part = await tokenDe(U.part, "redactor");
  await api("/api/staff-push/estado", { token: T.part });
  sqlite.prepare("UPDATE reunions_persones SET user_id = ? WHERE pid = 'p-part'").run(U.part);
  sqlite.prepare("UPDATE reunions_persones SET user_id = ? WHERE pid = 'p-otro'").run(U.otro);
  for (const k of ["admin", "n4", "part", "antiguo", "otro", "ajeno"]) S[k] = await suscribir(k);
  T.admin = await tokenDe(U.admin, "admin");
  T.n4 = await tokenDe(U.n4, "redactor");
  T.antiguo = await tokenDe(U.antiguo, "redactor");
  T.ajeno = await tokenDe(U.ajeno, "redactor");
  // El admin guardó sus preferencias cuando "reuniones" aún no existía.
  sqlite.prepare("INSERT INTO staff_push_prefs (user_id, categoria) VALUES (?, 'comentarios')").run(U.admin);
});

test("solo avisa a los Responsables y a los convocados a ESA reunión", async () => {
  crearReunion("g1", ["p-part", "p-antiguo"]);
  const destinos = await correrAviso();
  assert.deepEqual(destinos, urls(S.admin, S.part, S.antiguo));
  assert.ok(!destinos.includes(S.n4.endpoint), "un Nivel 4 que no participa no recibe");
  assert.ok(!destinos.includes(S.otro.endpoint), "quien participa en otra reunión no recibe esta");
  assert.ok(!destinos.includes(S.ajeno.endpoint), "quien no participa no recibe");
});

test("el Responsable lo recibe aunque guardara sus preferencias antes de existir 'reuniones' (fallo original)", async () => {
  const e = await api("/api/staff-push/estado", { token: T.admin });
  assert.ok(e.data.activas.includes("reuniones"));
  assert.deepEqual(e.data.activas.sort(), ["comentarios", "reuniones"]);
});

test("el mismo aviso no se repite en el siguiente minuto", async () => {
  assert.deepEqual(await correrAviso(), []);
});

test("un Responsable recibe también las reuniones en las que no participa", async () => {
  limpiarReunion(); crearReunion("g2", ["p-otro"]);
  assert.deepEqual(await correrAviso(), urls(S.admin, S.otro));
});

test("un participante usa la campanita solo para 'reuniones'", async () => {
  const e = await api("/api/staff-push/estado", { token: T.part });
  assert.equal(e.status, 200);
  assert.deepEqual(e.data.categorias.map((c) => c.id), ["reuniones"]);
  const r = await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios", "noticias", "reuniones"] }, token: T.part });
  assert.deepEqual(r.data.activas, ["reuniones"]);
  const filas = sqlite.prepare("SELECT categoria FROM staff_push_prefs WHERE user_id = ?").all(U.part).map((f) => f.categoria);
  assert.deepEqual(filas, ["reuniones"], "no se guardan categorías que no le corresponden");
  // Una cuenta que no participa en nada sigue sin acceso.
  assert.equal((await api("/api/staff-push/estado", { token: T.ajeno })).status, 403);
  assert.equal((await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["reuniones"] }, token: T.ajeno })).status, 403);
});

test("un participante no recibe avisos de otras categorías aunque tuviera filas guardadas", async () => {
  sqlite.prepare("INSERT OR IGNORE INTO staff_push_prefs (user_id, categoria) VALUES (?, 'comentarios')").run(U.part);
  sqlite.prepare("INSERT INTO articles (publicado) VALUES (1)").run();
  envios.length = 0;
  const r = await api("/api/articles/1/comments", { method: "POST", body: { nombre: "Lector", email: "l@x.es", texto: "Buen artículo" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await new Promise((ok) => setTimeout(ok, 50));
  assert.ok(envios.includes(S.admin.endpoint), "el admin sí (tiene 'comentarios')");
  assert.ok(!envios.includes(S.part.endpoint), "el participante no");
  sqlite.prepare("DELETE FROM staff_push_prefs WHERE user_id = ? AND categoria = 'comentarios'").run(U.part);
});

test("apagar 'reuniones' a propósito se respeta (participante y Responsable)", async () => {
  limpiarReunion();
  await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: [] }, token: T.part });
  await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios"] }, token: T.admin });
  crearReunion("g3", ["p-part"]);
  assert.deepEqual(await correrAviso(), [], "ninguno de los dos la quiere");
  await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios", "reuniones"] }, token: T.admin });
  limpiarReunion(); crearReunion("g4", ["p-part"]);
  assert.deepEqual(await correrAviso(), urls(S.admin));
  await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["reuniones"] }, token: T.part });
});

test("una reunión sin participantes avisa solo a los Responsables", async () => {
  limpiarReunion(); crearReunion("g5", []);
  assert.deepEqual(await correrAviso(), urls(S.admin));
});

test("quien aún no ha usado la campanita no tiene nada marcado", async () => {
  const nuevo = usuario("nuevo", "redactor", 4);
  const e = await api("/api/staff-push/estado", { token: await tokenDe(nuevo, "redactor") });
  assert.deepEqual(e.data.activas, []);
  assert.equal(e.data.dispositivos, 0);
});

test("si el servicio push falla del todo, el aviso se reintenta y no se pierde", async () => {
  limpiarReunion(); crearReunion("g6", ["p-part"]);
  estadoServicio = 500;
  await correrAviso();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM reunions_avisos").get().n, 0, "el reclamo se suelta si no llegó a nadie");
  estadoServicio = 201;
  assert.deepEqual(await correrAviso(), urls(S.admin, S.part));
  assert.deepEqual(await correrAviso(), [], "y ya no se repite");
});

test("dos crons a la vez no duplican el aviso", async () => {
  limpiarReunion(); crearReunion("g7", ["p-part"]);
  envios.length = 0;
  await Promise.all([worker.reunionsAvisarProximas(env), worker.reunionsAvisarProximas(env)]);
  const porDestino = envios.reduce((a, u) => (a[u] = (a[u] || 0) + 1, a), {});
  assert.ok(Object.keys(porDestino).length === 2 && Object.values(porDestino).every((n) => n === 1), JSON.stringify(porDestino));
});

test("al guardar sus respuestas en /reuniones, el participante queda enlazado a su cuenta", async () => {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`);
  const nueva = usuario("nueva", "redactor", 1);
  const t = await tokenDe(nueva, "redactor");
  const ahora = new Date().toISOString();
  const clau = proximaFranja();
  sqlite.prepare("INSERT OR REPLACE INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'disponible', NULL, NULL, NULL, ?)").run(clau, ahora);
  sqlite.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('reunions_config', ?, ?)").run(JSON.stringify({ obert: true }), ahora);
  const r = await api("/api/reunions/public/vots", { method: "POST", token: t, body: { nom: "Nueva Persona", claus: [clau] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const fila = sqlite.prepare("SELECT user_id FROM reunions_persones WHERE pid = ?").get(r.data.pid);
  assert.equal(fila.user_id, nueva);
  // Y desde ese momento puede usar la campanita para reuniones.
  assert.equal((await api("/api/staff-push/estado", { token: t })).status, 200);
  // Al volver a guardar desde otra sesión de la MISMA persona (pid + secreto) se mantiene el enlace.
  const r2 = await api("/api/reunions/public/vots", { method: "POST", token: t, body: { nom: "Nueva Persona", claus: [clau], pid: r.data.pid, secret: r.data.secret } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(sqlite.prepare("SELECT user_id FROM reunions_persones WHERE pid = ?").get(r.data.pid).user_id, nueva);
});
