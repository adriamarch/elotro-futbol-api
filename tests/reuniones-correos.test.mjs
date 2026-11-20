// Correos de reuniones: al confirmar una reunión (convocatoria), al cambiar su enlace o asunto, al cancelarla
// y al reenviarla a mano desde la Agenda. Solo llegan a los convocados que no están en pausa y que tienen
// cuenta con correo entregable; el Responsable recibe en la respuesta quién se ha quedado sin correo.
// Ejecuta el handler REAL contra SQLite en memoria (API de D1) y simula la API de Resend. Uso:
//   node --no-warnings --test tests/reuniones-correos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/reuniones-correos.test.mjs
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
test("preparación", async () => {
  U.admin = usuario("admin", "Admin Jefe", "admin", "jefe@x.es");
  U.ana = usuario("ana", "Ana Pérez", "redactor", "ana@x.es");
  U.luis = usuario("luis", "Luis Antiguo", "redactor", "luis@x.es");     // participante antiguo: se enlaza por nombre
  U.xx = usuario("xx", "Cuenta Sintética", "redactor", "cuenta@x.elotrofutbol.media"); // correo no entregable
  U.bea = usuario("bea", "Bea Sin Correo", "redactor", null);
  T.admin = await tokenDe(U.admin, "admin");
  T.ana = await tokenDe(U.ana, "redactor");
  persona("p-ana", "Ana Pérez", U.ana);
  persona("p-luis", "Luis Antiguo", null);
  persona("p-xx", "Cuenta Sintética", U.xx);
  persona("p-bea", "Bea Sin Correo", U.bea);
  persona("p-ext", "Persona Externa", null);                            // sin cuenta de colaborador
  // La columna user_id ya existe; el worker la crea en caliente si faltara.
  await api("/api/reunions/admin", { token: T.admin });
});

test("confirmar: convocatoria por correo a los convocados con cuenta y correo; avisa de quién no puede recibirlo", async () => {
  reiniciar();
  const ini = dia(2) + "T10:00";
  for (const p of ["p-ana", "p-luis", "p-xx", "p-bea", "p-ext"]) vota(p, ini);
  const r = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 2, enllac: "https://meet.example.com/abc", nota: "Seguimiento" } });
  assert.equal(r.status, 200);
  assert.deepEqual(paras(), ["ana@x.es", "luis@x.es"]);
  assert.equal(r.data.correo.enviados, 2);
  assert.deepEqual([...r.data.correo.sinCorreo].sort(), ["Bea Sin Correo", "Cuenta Sintética", "Persona Externa"]);
  const c = correos.find((x) => x.para === "ana@x.es");
  assert.match(c.asunto, /^Convocatoria · Reunión de ElOtroFútbol/);
  assert.match(c.asunto, /10:00–11:00/);
  assert.match(c.texto, /Hola Ana,/);
  assert.match(c.texto, /Asunto: Seguimiento/);
  assert.match(c.texto, /Videollamada: https:\/\/meet\.example\.com\/abc/);
  assert.match(c.texto, /Convocados: .*Ana Pérez/);
  assert.match(c.html, /href="https:\/\/meet\.example\.com\/abc"/);
  assert.equal(c.replyTo, "elotrofutbolmedio@gmail.com");
  // Nadie ve los correos de los demás: cada correo va a una sola persona.
  assert.ok(correos.every((x) => !x.texto.includes("luis@x.es") && !x.texto.includes("ana@x.es")));
});

test("el enlace se escapa en el HTML y un enlace sin https se rechaza", async () => {
  reiniciar();
  const ini = dia(2) + "T12:00";
  vota("p-ana", ini);
  const mal = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 1, enllac: "http://inseguro.example.com" } });
  assert.equal(mal.status, 400);
  assert.equal(correos.length, 0);
  const r = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 1, enllac: 'https://e.com/a"onmouseover="x' } });
  assert.equal(r.status, 200);
  assert.ok(!correos[0].html.includes('"onmouseover="x'));
});

test("una reunión en pausa no envía correo y se informa; al cancelar la otra, el liberado recibe su convocatoria", async () => {
  reiniciar();
  const iniA = dia(2) + "T09:00", iniB = dia(3) + "T09:00";
  vota("p-ana", iniA); vota("p-luis", iniA);
  vota("p-ana", iniB); vota("p-luis", iniB);
  const a = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: iniA, franges: 2, nota: "A" } });
  assert.equal(a.data.correo.enviados, 2);
  correos.length = 0;
  // Misma persona ya tiene la reunión A: B queda en pausa para las dos y no se envía nada.
  await new Promise((r) => setTimeout(r, 15)); // B se confirma después de A (el orden decide cuál vale)
  const b = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: iniB, franges: 2, nota: "B" } });
  assert.equal(correos.length, 0);
  assert.equal(b.data.correo.enviados, 0);
  assert.deepEqual([...b.data.correo.enPausa].sort(), ["Ana Pérez", "Luis Antiguo"]);
  // Se cancela A: avisa de la cancelación a sus convocados y B pasa a ser la suya.
  const grupA = sqlite.prepare("SELECT grup FROM reunions_franges WHERE clau = ?").get(iniA).grup;
  const c = await api("/api/reunions/admin/cancelar", { method: "POST", token: T.admin, body: { grup: grupA } });
  assert.equal(c.status, 200);
  const canc = correos.filter((x) => /^Reunión cancelada/.test(x.asunto));
  assert.deepEqual(canc.map((x) => x.para).sort(), ["ana@x.es", "luis@x.es"]);
  assert.match(canc[0].texto, /Asunto: A/);
  const conv = correos.filter((x) => /^Convocatoria/.test(x.asunto));
  assert.deepEqual(conv.map((x) => x.para).sort(), ["ana@x.es", "luis@x.es"]);
  assert.match(conv[0].texto, /Asunto: B/);
  assert.equal(c.data.correo.reactivadas, 2);
});

test("editar: solo avisa si cambia el enlace o el asunto", async () => {
  reiniciar();
  const ini = dia(4) + "T16:00";
  vota("p-ana", ini);
  await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 2, nota: "Antes", enllac: "https://meet.example.com/uno" } });
  const grup = sqlite.prepare("SELECT grup FROM reunions_franges WHERE clau = ?").get(ini).grup;
  correos.length = 0;
  await api("/api/reunions/admin/editar", { method: "POST", token: T.admin, body: { grup, nota: "Antes", enllac: "https://meet.example.com/uno" } });
  assert.equal(correos.length, 0, "guardar sin cambios no manda nada");
  const r = await api("/api/reunions/admin/editar", { method: "POST", token: T.admin, body: { grup, nota: "Antes", enllac: "https://meet.example.com/dos" } });
  assert.equal(r.status, 200);
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /^Reunión actualizada/);
  assert.match(correos[0].texto, /meet\.example\.com\/dos/);
});

test("una reunión ya celebrada no manda correos al cancelarla ni se puede reenviar", async () => {
  reiniciar();
  const ini = dia(-2) + "T10:00";
  sqlite.prepare("INSERT INTO reunions_franges (clau, estat, grup, enllac, nota, updated_at) VALUES (?, 'confirmada', 'ab12cd34ef', NULL, 'Pasada', ?)").run(ini, new Date().toISOString());
  vota("p-ana", ini);
  const re = await api("/api/reunions/admin/correo", { method: "POST", token: T.admin, body: { grup: "ab12cd34ef" } });
  assert.equal(re.status, 404);
  const c = await api("/api/reunions/admin/cancelar", { method: "POST", token: T.admin, body: { grup: "ab12cd34ef" } });
  assert.equal(c.status, 200);
  assert.equal(correos.length, 0);
});

test("ajuste «correos» desactivado: no se envía al confirmar, pero el reenvío manual sí funciona", async () => {
  reiniciar();
  const cfg = await api("/api/reunions/admin/config", { method: "PUT", token: T.admin, body: { correos: false } });
  assert.equal(cfg.data.config.correos, false);
  const ini = dia(5) + "T11:00";
  vota("p-ana", ini);
  const r = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 2, nota: "Manual" } });
  assert.equal(r.data.correo.activado, false);
  assert.equal(correos.length, 0);
  const grup = sqlite.prepare("SELECT grup FROM reunions_franges WHERE clau = ?").get(ini).grup;
  const re = await api("/api/reunions/admin/correo", { method: "POST", token: T.admin, body: { grup } });
  assert.equal(re.status, 200);
  assert.equal(re.data.correo.enviados, 1);
  assert.deepEqual(paras(), ["ana@x.es"]);
  await api("/api/reunions/admin/config", { method: "PUT", token: T.admin, body: { correos: true } });
});

test("solo un Responsable puede reenviar la convocatoria", async () => {
  const r = await api("/api/reunions/admin/correo", { method: "POST", token: T.ana, body: { grup: "ab12cd34ef" } });
  assert.equal(r.status, 403);
  const s = await api("/api/reunions/admin/correo", { method: "POST", body: { grup: "ab12cd34ef" } });
  assert.equal(s.status, 401);
});

test("fallos de Resend: un 422 se informa como fallido; un 429 se reintenta y llega", async () => {
  reiniciar();
  const ini = dia(6) + "T10:00";
  vota("p-ana", ini); vota("p-luis", ini);
  respuestasResend = [422];
  const r = await api("/api/reunions/admin/confirmar", { method: "POST", token: T.admin, body: { clau: ini, franges: 2 } });
  assert.equal(r.status, 200, "un fallo de correo no rompe la confirmación");
  assert.equal(r.data.correo.enviados + r.data.correo.fallidos.length, 2);
  assert.equal(r.data.correo.fallidos.length, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM reunions_franges WHERE estat = 'confirmada'").get().n, 2);
  correos.length = 0;
  const grup = sqlite.prepare("SELECT grup FROM reunions_franges WHERE clau = ?").get(ini).grup;
  respuestasResend = [429];
  const re = await api("/api/reunions/admin/correo", { method: "POST", token: T.admin, body: { grup } });
  assert.equal(re.data.correo.fallidos.length, 0);
  assert.equal(re.data.correo.enviados, 2);
});

test("sin Resend configurado: la reunión se confirma y se avisa de que el correo no está configurado", async () => {
  reiniciar();
  const ini = dia(7) + "T10:00";
  vota("p-ana", ini);
  const entorno = { ...env, RESEND_API_KEY: undefined };
  const req = new Request("https://api.test/api/reunions/admin/confirmar", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + T.admin }, body: JSON.stringify({ clau: ini, franges: 1 }),
  });
  const res = await worker.fetch(req, entorno, { waitUntil() {} });
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.correo.configurado, false);
  assert.equal(d.correo.enviados, 0);
});
