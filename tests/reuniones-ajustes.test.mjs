// Ajustes de reuniones desde el panel de admin (avisos, minutos, regla de una reunión por persona).
// Ejecuta el handler REAL contra SQLite en memoria (API de D1). Uso:
//   node --no-warnings --test tests/reuniones-ajustes.test.mjs
//   node --no-warnings --test tests/reuniones-ajustes.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/reuniones-ajustes.test.mjs
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
CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER, nombre TEXT, email TEXT, texto TEXT, ip TEXT, reader_id INTEGER, parent_id INTEGER, responde_a_id INTEGER);
CREATE TABLE reunions_franges (clau TEXT PRIMARY KEY, estat TEXT NOT NULL, grup TEXT, enllac TEXT, nota TEXT, updated_at TEXT NOT NULL);
CREATE TABLE reunions_persones (pid TEXT PRIMARY KEY, nom TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
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
const guardar = (body, token = T.admin) => api("/api/reunions/admin/config", { method: "PUT", body, token });

test("preparación", async () => {
  U.admin = usuario("admin", "admin", 1);
  U.part = usuario("part", "redactor", 1);
  const ahora = new Date().toISOString();
  for (const [pid, nom] of [["p-part", "Ana Pérez"], ["p-otra", "Otra Persona"]]) {
    sqlite.prepare("INSERT INTO reunions_persones (pid, nom, secret, created_at, updated_at) VALUES (?, ?, 's', ?, ?)").run(pid, nom, ahora, ahora);
  }
  T.admin = await tokenDe(U.admin, "admin");
  T.part = await tokenDe(U.part, "redactor");
  await api("/api/staff-push/estado", { token: T.part }); // crea la columna user_id
  sqlite.prepare("UPDATE reunions_persones SET user_id = ? WHERE pid = 'p-part'").run(U.part);
  for (const k of ["admin", "part"]) S[k] = await suscribir(k);
});

test("por defecto: avisos activados a 30, 10 y al empezar, y una reunión por persona", async () => {
  const r = await api("/api/reunions/admin", { token: T.admin });
  assert.equal(r.status, 200);
  assert.equal(r.data.config.avisos, true);
  assert.deepEqual(r.data.config.avisosMinutos, [30, 10, 0]);
  assert.equal(r.data.config.unaPorPersona, true);
});

test("solo un Responsable puede cambiar los ajustes", async () => {
  assert.equal((await guardar({ avisos: false }, T.part)).status, 403);
  assert.equal((await guardar({ avisos: false }, null)).status, 401);
});

test("la página /reuniones (solo título, texto y abierto) no borra los ajustes del panel", async () => {
  let r = await guardar({ avisos: false, avisosMinutos: [45, 5], unaPorPersona: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await guardar({ titol: "Acogida 2026", descripcio: "Texto", obert: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.config.titol, "Acogida 2026");
  assert.equal(r.data.config.obert, false);
  assert.equal(r.data.config.avisos, false);
  assert.deepEqual(r.data.config.avisosMinutos, [45, 5]);
  assert.equal(r.data.config.unaPorPersona, false);
  // Y al revés: el panel puede cambiar solo los avisos sin tocar el texto.
  r = await guardar({ avisos: true });
  assert.equal(r.data.config.titol, "Acogida 2026");
  assert.equal(r.data.config.avisos, true);
});

test("los minutos se validan, se ordenan y no se repiten", async () => {
  assert.equal((await guardar({ avisosMinutos: [-1] })).status, 400);
  assert.equal((await guardar({ avisosMinutos: [181] })).status, 400);
  assert.equal((await guardar({ avisosMinutos: ["abc"] })).status, 400);
  assert.equal((await guardar({ avisosMinutos: "30" })).status, 400);
  assert.equal((await guardar({ avisosMinutos: [60, 45, 30, 15, 5] })).status, 400, "máximo 4 avisos");
  const r = await guardar({ avisosMinutos: [10, 60, 10, 0, 15.4] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.config.avisosMinutos, [60, 15, 10, 0]);
});

test("con los avisos desactivados desde el panel no sale ninguna notificación", async () => {
  await guardar({ avisos: false, avisosMinutos: [60, 30, 10, 0] });
  limpiarReunion(); crearReunion("a1", ["p-part"]);
  assert.deepEqual(await correrAviso(), []);
  let marcados = 0; // la tabla puede no existir aún: con los avisos apagados ni se llega a crear
  try { marcados = sqlite.prepare("SELECT COUNT(*) AS n FROM reunions_avisos").get().n; } catch { marcados = 0; }
  assert.equal(marcados, 0, "no se marca como enviado");
});

test("una lista de avisos vacía tampoco envía nada", async () => {
  await guardar({ avisos: true, avisosMinutos: [] });
  limpiarReunion(); crearReunion("a2", ["p-part"]);
  assert.deepEqual(await correrAviso(), []);
});

test("los minutos configurados mandan: [45] avisa (la reunión está a menos de 45 min) y solo una vez", async () => {
  await guardar({ avisos: true, avisosMinutos: [45] });
  limpiarReunion(); crearReunion("a3", ["p-part"]);
  assert.deepEqual(await correrAviso(), urls(S.admin, S.part));
  assert.deepEqual(await correrAviso(), [], "no se repite");
  const tipos = sqlite.prepare("SELECT tipo FROM reunions_avisos WHERE grup = 'a3'").all().map((f) => f.tipo);
  assert.deepEqual(tipos, ["45"]);
});

test("solo 'al empezar' ([0]): una reunión que aún no ha empezado no avisa", async () => {
  await guardar({ avisos: true, avisosMinutos: [0] });
  limpiarReunion(); crearReunion("a4", ["p-part"]); // empieza dentro de 1-30 min
  assert.deepEqual(await correrAviso(), []);
});

test("regla de una reunión por persona: se puede apagar desde el panel", async () => {
  limpiarReunion();
  const ini = crearReunion("m1", ["p-otra"]);
  const base = new Date(ini + ":00Z");
  const luego = new Date(base.getTime() + 2 * 3600000).toISOString().slice(0, 16);
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'm2', NULL, 'Otra', ?)").run(luego, new Date(Date.now() + 1000).toISOString());
  sqlite.prepare("INSERT INTO reunions_vots (pid, clau) VALUES ('p-otra', ?)").run(luego);

  await guardar({ unaPorPersona: true });
  let r = await api("/api/reunions/admin", { token: T.admin });
  assert.equal(r.data.suspesos.length, 1, "con la regla activa, la segunda reunión queda en pausa");
  assert.equal(r.data.suspesos[0].grup, "m2");

  await guardar({ unaPorPersona: false });
  r = await api("/api/reunions/admin", { token: T.admin });
  assert.equal(r.data.suspesos.length, 0, "sin la regla no hay pausas");
  assert.equal(r.data.ocupats.length, 0);
});

test("editar una reunión confirmada cambia enlace y nota sin alterar su orden de programación", async () => {
  limpiarReunion();
  const ini = crearReunion("e1e1e1e1", ["p-part"]);
  const antes = sqlite.prepare("SELECT updated_at FROM reunions_franges WHERE grup = 'e1e1e1e1'").get().updated_at;
  assert.equal((await api("/api/reunions/admin/editar", { method: "POST", body: { grup: "e1e1e1e1", enllac: "http://x.es", nota: "n" }, token: T.admin })).status, 400, "solo https");
  assert.equal((await api("/api/reunions/admin/editar", { method: "POST", body: { grup: "deadbeef00", nota: "n" }, token: T.admin })).status, 404);
  assert.equal((await api("/api/reunions/admin/editar", { method: "POST", body: { grup: "e1e1e1e1", nota: "n" }, token: T.part })).status, 403);
  const r = await api("/api/reunions/admin/editar", { method: "POST", body: { grup: "e1e1e1e1", enllac: "https://meet.example/abc", nota: "  Nueva   nota " }, token: T.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const f = sqlite.prepare("SELECT enllac, nota, updated_at, clau FROM reunions_franges WHERE grup = 'e1e1e1e1'").get();
  assert.equal(f.enllac, "https://meet.example/abc");
  assert.equal(f.nota, "Nueva nota");
  assert.equal(f.updated_at, antes, "updated_at intacto: decide qué reunión se programó primero");
  assert.equal(f.clau, ini);
});

// ---- Quien ya hizo una reunión no vuelve a salir convocado salvo que lo pida de nuevo ----
const claveMas = (min) => { const b = proximaFranja(); return new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10), +b.slice(11, 13), +b.slice(14, 16)) + min * 60000).toISOString().slice(0, 16); };
const votar = (pid, clau) => sqlite.prepare("INSERT OR IGNORE INTO reunions_vots (pid, clau) VALUES (?, ?)").run(pid, clau);
const votosDe = (pid) => sqlite.prepare("SELECT clau FROM reunions_vots WHERE pid = ? ORDER BY clau").all(pid).map((r) => r.clau);

test("al terminar una reunión, sus asistentes dejan de estar convocados a otras salvo que lo pidan de nuevo", async () => {
  await guardar({ unaPorPersona: true });
  limpiarReunion();
  const pasada = claveMas(-180), futura1 = claveMas(120), futura2 = claveMas(240);
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'c1c1c1c1', NULL, 'Hecha', ?)").run(pasada, new Date(Date.now() - 86400000).toISOString());
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'c2c2c2c2', NULL, 'Otra', ?)").run(futura1, new Date().toISOString());
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, updated_at) VALUES (?, 'disponible', ?)").run(futura2, new Date().toISOString());
  votar("p-part", pasada); votar("p-part", futura1); votar("p-part", futura2);
  votar("p-otra", futura1); votar("p-otra", futura2); // p-otra NO fue a la reunión pasada

  await worker.reunionsConsumirVotos(env);
  assert.deepEqual(votosDe("p-part"), [pasada], "p-part ya hizo la reunión: solo queda el registro de esa reunión");
  assert.deepEqual(votosDe("p-otra"), [futura1, futura2], "quien no asistió conserva sus respuestas");
  const r = await api("/api/reunions/admin", { token: T.admin });
  assert.equal(r.data.vots.filter((v) => v.pid === "p-part" && v.clau === futura1).length, 0, "ya no sale convocado a la siguiente");

  // Vuelve a pedirlo: se respeta (la reunión pasada ya está consumida y no se vuelve a procesar).
  votar("p-part", futura2);
  await worker.reunionsConsumirVotos(env);
  assert.deepEqual(votosDe("p-part"), [pasada, futura2]);
});

test("una reunión en pausa no consume las respuestas de quien no asistió", async () => {
  await guardar({ unaPorPersona: true });
  limpiarReunion();
  const a = claveMas(-240), b = claveMas(-180), futura = claveMas(120);
  const antigua = new Date(Date.now() - 86400000).toISOString();
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'd1d1d1d1', NULL, 'Primera', ?)").run(a, antigua);
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'd2d2d2d2', NULL, 'Segunda', ?)").run(b, new Date().toISOString());
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, updated_at) VALUES (?, 'disponible', ?)").run(futura, new Date().toISOString());
  votar("p-otra", a); votar("p-otra", futura);               // asistió a la primera
  votar("p-part", b); votar("p-part", futura);               // solo estaba en la segunda
  await worker.reunionsConsumirVotos(env);
  assert.deepEqual(votosDe("p-otra"), [a], "p-otra asistió a la primera: pierde lo posterior");
  assert.deepEqual(votosDe("p-part"), [b], "p-part asistió a la segunda: pierde lo posterior");
});

test("finalizar a mano consume las respuestas de los asistentes", async () => {
  limpiarReunion();
  const ini = crearReunion("f1f1f1f1", ["p-part"]);
  const despues = claveMas(300);
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, updated_at) VALUES (?, 'disponible', ?)").run(despues, new Date().toISOString());
  votar("p-part", despues); votar("p-otra", despues);
  const r = await api("/api/reunions/admin/finalizar", { method: "POST", body: { grup: "f1f1f1f1" }, token: T.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(votosDe("p-part"), [ini], "se conserva su respuesta de la reunión, no las posteriores");
  assert.deepEqual(votosDe("p-otra"), [despues]);
});

test("actividad de una persona: reuniones hechas, próximas y en pausa, franjas marcadas; solo para Responsables", async () => {
  await guardar({ unaPorPersona: true });
  limpiarReunion();
  const PID = "abcdef0123456789";
  sqlite.prepare("INSERT OR IGNORE INTO reunions_persones (pid, nom, secret, created_at, updated_at) VALUES (?, 'Ana Pérez Gómez', 's', ?, ?)").run(PID, new Date().toISOString(), new Date().toISOString());
  const hecha = claveMas(-300), primera = claveMas(120), segunda = claveMas(240), libre = claveMas(360);
  const ts = (d) => new Date(Date.now() + d).toISOString();
  const franja = (clau, grup, nota, t, estat = "confirmada") => sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, ?, ?, 'https://meet.example/x', ?, ?)").run(clau, estat, grup, nota, t);
  franja(hecha, "h1h1h1h1", "Pasada", ts(-9e7), "finalizada");
  franja(primera, "h2h2h2h2", "Primera", ts(-8e7));
  franja(segunda, "h3h3h3h3", "Segunda", ts(-1000));
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, updated_at) VALUES (?, 'disponible', ?)").run(libre, ts(0));
  for (const k of [hecha, primera, segunda, libre]) votar(PID, k);

  assert.equal((await api(`/api/reunions/admin/persona/${PID}/actividad`, { token: T.part })).status, 403);
  assert.equal((await api("/api/reunions/admin/persona/aaaaaaaa/actividad", { token: T.admin })).status, 404);
  const r = await api(`/api/reunions/admin/persona/${PID}/actividad`, { token: T.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const est = Object.fromEntries(r.data.reuniones.map((x) => [x.grup, x.estado]));
  assert.deepEqual(est, { h1h1h1h1: "hecha", h2h2h2h2: "proxima", h3h3h3h3: "en_pausa" });
  assert.deepEqual(r.data.franjas, [libre]);
  assert.deepEqual(r.data.resumen, { hechas: 1, proximas: 1, enPausa: 1, franjas: 1 });
  assert.equal(r.data.persona.nom, "Ana Pérez Gómez");
  assert.equal(r.data.reuniones.find((x) => x.grup === "h3h3h3h3").enllac, "", "una reunión en pausa no enseña enlace");
});
