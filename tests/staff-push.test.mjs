// Prueba de integración del push del equipo (campanita del panel de redactores).
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que
// imita la API de D1, y captura los envíos a los servicios push. Uso:
//   node --no-warnings --test tests/staff-push.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/staff-push.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

// ---- D1 falso sobre node:sqlite ----
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'redactor',
  activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT, puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, publicado INTEGER DEFAULT 1);
CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER, nombre TEXT, email TEXT, texto TEXT, ip TEXT, reader_id INTEGER, parent_id INTEGER, responde_a_id INTEGER);
`);
// La migración real, tal cual: así se prueba también el SQL que se despliega.
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
};

// ---- Clave VAPID de pruebas y captura de envíos ----
const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1", VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey)) };
const ctx = { pendientes: [], waitUntil(p) { this.pendientes.push(Promise.resolve(p).catch(() => {})); } };
const esperarEnvios = async () => { await Promise.all(ctx.pendientes.splice(0)); };

const envios = [];
globalThis.fetch = async (url, init = {}) => {
  envios.push({ url: String(url) });
  return new Response(null, { status: 201 });
};

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
test("preparación: admin, redactor nivel 4, redactor nivel 2 y fotógrafo", async () => {
  U.admin = usuario("admin", "admin", 1);
  U.n4 = usuario("nivel4", "redactor", 4);
  U.n4b = usuario("nivel4b", "redactor", 4);
  U.n2 = usuario("nivel2", "redactor", 2);
  U.foto = usuario("foto", "fotografo", 4);
  U.tAdmin = await tokenDe(U.admin, "admin");
  U.tN4 = await tokenDe(U.n4, "redactor");
  U.tN4b = await tokenDe(U.n4b, "redactor");
  U.tN2 = await tokenDe(U.n2, "redactor");
  U.tFoto = await tokenDe(U.foto, "fotografo");
});

test("solo admin y Nivel 4 pueden usar la campanita; el resto recibe 403 y sin sesión 401", async () => {
  assert.equal((await api("/api/staff-push/estado")).status, 401);
  assert.equal((await api("/api/staff-push/estado", { token: U.tN2 })).status, 403);
  assert.equal((await api("/api/staff-push/estado", { token: U.tFoto })).status, 403);
  const a = await api("/api/staff-push/estado", { token: U.tAdmin });
  assert.equal(a.status, 200);
  const b = await api("/api/staff-push/estado", { token: U.tN4 });
  assert.equal(b.status, 200);
  assert.deepEqual(b.data.categorias.map((c) => c.id), [
    "contenido", "acreditaciones", "incorporaciones", "noticias", "fichas", "tienda", "ediciones", "comentarios", "anuncios",
  ]);
  assert.deepEqual(b.data.activas, []);
  assert.equal(b.data.dispositivo_suscrito, false);
});

test("un redactor de nivel bajo tampoco puede suscribirse ni guardar preferencias", async () => {
  const sub = await crearSuscripcion("n2");
  assert.equal((await api("/api/staff-push/suscribir", { method: "POST", body: { suscripcion: sub, categorias: ["comentarios"] }, token: U.tN2 })).status, 403);
  assert.equal((await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios"] }, token: U.tN2 })).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions").get().n, 0);
});

test("suscribirse guarda dispositivo y categorías (ignora las desconocidas) y el estado lo refleja", async () => {
  U.subN4 = await crearSuscripcion("n4");
  const r = await api("/api/staff-push/suscribir", { method: "POST", body: { suscripcion: U.subN4, categorias: ["comentarios", "tienda", "inventada"] }, token: U.tN4 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.activas.sort(), ["comentarios", "tienda"]);
  const e = await api("/api/staff-push/estado?endpoint=" + encodeURIComponent(U.subN4.endpoint), { token: U.tN4 });
  assert.equal(e.data.dispositivo_suscrito, true);
  assert.equal(e.data.dispositivos, 1);
  // Un endpoint que no es de un servicio push conocido se rechaza (SSRF).
  const mala = { endpoint: "https://evil.example.com/x", keys: U.subN4.keys };
  assert.equal((await api("/api/staff-push/suscribir", { method: "POST", body: { suscripcion: mala }, token: U.tN4 })).status, 400);
});

test("cambiar preferencias reemplaza la lista", async () => {
  const r = await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios", "noticias", "anuncios"] }, token: U.tN4 });
  assert.deepEqual(r.data.activas.sort(), ["anuncios", "comentarios", "noticias"]);
  assert.equal((await api("/api/staff-push/prefs", { method: "PUT", body: {}, token: U.tN4 })).status, 400);
});

test("un comentario nuevo avisa solo a quien tiene 'comentarios' activado", async () => {
  U.subAdmin = await crearSuscripcion("admin");
  U.subN4b = await crearSuscripcion("n4b");
  await api("/api/staff-push/suscribir", { method: "POST", body: { suscripcion: U.subAdmin, categorias: ["comentarios"] }, token: U.tAdmin });
  // nivel4b se suscribe pero SIN comentarios
  await api("/api/staff-push/suscribir", { method: "POST", body: { suscripcion: U.subN4b, categorias: ["tienda"] }, token: U.tN4b });
  sqlite.prepare("INSERT INTO articles (publicado) VALUES (1)").run();
  envios.length = 0;
  const r = await api("/api/articles/1/comments", { method: "POST", body: { nombre: "Lector", email: "l@x.es", texto: "Buen artículo" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await esperarEnvios();
  const destinos = envios.map((x) => x.url).sort();
  assert.deepEqual(destinos, [U.subAdmin.endpoint, U.subN4.endpoint].sort());
});

test("si baja de nivel o lo desactivan, deja de recibir sin tocar nada más", async () => {
  sqlite.prepare("UPDATE users SET nivel = 3 WHERE id = ?").run(U.n4);
  envios.length = 0;
  await api("/api/articles/1/comments", { method: "POST", body: { nombre: "Lector", email: "l@x.es", texto: "Otro" } });
  await esperarEnvios();
  assert.deepEqual(envios.map((x) => x.url), [U.subAdmin.endpoint]);
  sqlite.prepare("UPDATE users SET nivel = 4 WHERE id = ?").run(U.n4);
});

test("compras en la tienda: solo a quien gestiona la tienda (admin o con permiso)", async () => {
  // nivel4b tiene 'tienda' activada pero no gestiona la tienda; el admin la activa y sí gestiona.
  await api("/api/staff-push/prefs", { method: "PUT", body: { categorias: ["comentarios", "tienda"] }, token: U.tAdmin });
  const e = await api("/api/staff-push/estado", { token: U.tN4b });
  assert.equal(e.data.puede_gestionar_tienda, false);
  assert.equal((await api("/api/staff-push/estado", { token: U.tAdmin })).data.puede_gestionar_tienda, true);
});

test("prueba: manda una notificación solo a los dispositivos propios", async () => {
  envios.length = 0;
  const r = await api("/api/staff-push/prueba", { method: "POST", token: U.tAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.data.enviados, 1);
  assert.deepEqual(envios.map((x) => x.url), [U.subAdmin.endpoint]);
});

test("renovar (service worker): sustituye la suscripción de equipo existente y no toca las desconocidas", async () => {
  const nueva = await crearSuscripcion("n4-nueva");
  const noHay = await api("/api/staff-push/renovar", { method: "POST", body: { suscripcion: nueva, endpoint_anterior: "https://fcm.googleapis.com/fcm/send/nadie" } });
  assert.equal(noHay.status, 200);
  assert.equal(noHay.data.encontrada, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions WHERE endpoint = ?").get(nueva.endpoint).n, 0);
  const si = await api("/api/staff-push/renovar", { method: "POST", body: { suscripcion: nueva, endpoint_anterior: U.subN4.endpoint } });
  assert.equal(si.data.encontrada, true);
  const fila = sqlite.prepare("SELECT user_id FROM staff_push_subscriptions WHERE endpoint = ?").get(nueva.endpoint);
  assert.equal(fila.user_id, U.n4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions WHERE endpoint = ?").get(U.subN4.endpoint).n, 0);
  U.subN4 = nueva;
  // Las preferencias son de la persona, no del dispositivo: se conservan.
  const e = await api("/api/staff-push/estado", { token: U.tN4 });
  assert.deepEqual(e.data.activas.sort(), ["anuncios", "comentarios", "noticias"]);
});

test("baja: quita solo el dispositivo propio (no el de otra persona)", async () => {
  const ajena = await api("/api/staff-push/baja", { method: "POST", body: { endpoint: U.subAdmin.endpoint }, token: U.tN4 });
  assert.equal(ajena.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions WHERE endpoint = ?").get(U.subAdmin.endpoint).n, 1);
  await api("/api/staff-push/baja", { method: "POST", body: { endpoint: U.subN4.endpoint }, token: U.tN4 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions WHERE endpoint = ?").get(U.subN4.endpoint).n, 0);
  const e = await api("/api/staff-push/estado?endpoint=" + encodeURIComponent(U.subN4.endpoint), { token: U.tN4 });
  assert.equal(e.data.dispositivo_suscrito, false);
});

test("push caducado (410) se elimina solo", async () => {
  const antes = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 410 });
  try {
    await api("/api/articles/1/comments", { method: "POST", body: { nombre: "Lector", email: "l@x.es", texto: "Más" } });
    await esperarEnvios();
  } finally { globalThis.fetch = antes; }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM staff_push_subscriptions WHERE endpoint = ?").get(U.subAdmin.endpoint).n, 0);
});
