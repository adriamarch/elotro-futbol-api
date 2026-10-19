// Anuncios por correo: envío reanudable sin repetir a quien ya lo recibió.
//   node --no-warnings --test tests/anuncios-reanudar.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/anuncios-reanudar.test.mjs
//
// Esquema real (schema.sql + migracion_anuncios_email.sql) sobre SQLite en memoria; Resend simulado
// sustituyendo fetch. La tabla de destinatarios NO se crea aquí: la crea el propio Worker (migración
// automática), igual que en producción si no se ha aplicado la migración a mano.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

// Sin esperas reales entre correos (el Worker duerme ~550 ms entre cada uno).
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...a) => setTimeoutReal(fn, 0, ...a);

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../migracion_anuncios_email.sql", import.meta.url), "utf8"));
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
const env = { DB, JWT_SECRET, RESEND_API_KEY: "re_test", RESEND_FROM: "Test <no-reply@elotrofutbol.media>" };
let pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}

// 25 redactores con correo (3 tandas de 10) + 1 admin que hace el envío.
const admin = Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, email) VALUES ('boss','x','y','Boss','admin','boss@x.es')").run().lastInsertRowid);
const CORREOS = [];
for (let i = 1; i <= 25; i++) {
  const email = `r${String(i).padStart(2, "0")}@x.es`;
  CORREOS.push(email);
  sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, email) VALUES (?,?,?,?, 'redactor', ?)").run(`r${i}`, "x", "y", `Redactor ${i}`, email);
}

// Resend simulado: lo que se "envía" queda en `enviados`; `falla` = correos que devuelven 500;
// `lista` = respuesta de GET /emails (o null -> 401, clave sin permiso de lectura).
let enviados = [];
let falla = new Set();
let lista = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails" && init.method === "POST") {
    const body = JSON.parse(init.body);
    const para = body.to[0].toLowerCase();
    if (falla.has(para)) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    enviados.push(para);
    return new Response(JSON.stringify({ id: "e_" + enviados.length }), { status: 200 });
  }
  if (u.startsWith("https://api.resend.com/emails?")) {
    if (!lista) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ object: "list", has_more: false, data: lista }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

let token;
// Repite las llamadas hasta que el servidor dice que no queda nadie (con tope, por si algo falla).
async function hastaTerminar(r, id, extra = {}) {
  for (let i = 0; i < 30 && r.status === 200 && r.data.siguiente_tanda !== null; i++) {
    r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, ...extra } });
  }
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.siguiente_tanda, null, "debía terminar");
  return r;
}
async function api(ruta, { method = "GET", body } = {}) {
  token ||= await jwt({ uid: admin, rol: "admin", nombre: "Boss", tfa: true });
  const res = await worker.fetch(
    new Request("https://api.test" + ruta, {
      method,
      headers: { Authorization: "Bearer " + token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env, ctx
  );
  const data = await res.json().catch(() => ({}));
  await Promise.all(pendientes); pendientes = [];
  return { status: res.status, data };
}
const anuncio = { asunto: "Cambios importantes", mensaje: "Hola equipo", seleccion: { redactores: "todos" } };
const registro = (id) => Object.fromEntries(sqlite.prepare("SELECT email, estado FROM anuncios_email_destinatarios WHERE anuncio_id = ?").all(id).map((r) => [r.email, r.estado]));
const sinRepetidos = (l) => assert.equal(new Set(l).size, l.length, "ningún correo repetido");

test("un envío completo manda a cada persona exactamente una vez, en varias llamadas", async () => {
  enviados = [];
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { ...anuncio, tanda: 0 } });
  assert.equal(r.status, 200);
  const id = r.data.anuncio_id;
  assert.equal(r.data.total, 25);
  assert.ok(r.data.pendientes > 0, "una sola llamada no manda a las 25");
  r = await hastaTerminar(r, id);
  assert.equal(r.data.completado, true);
  assert.equal(r.data.enviados, 25);
  assert.deepEqual([...enviados].sort(), [...CORREOS]);
  sinRepetidos(enviados);
  assert.equal(sqlite.prepare("SELECT estado FROM anuncios_email WHERE id = ?").get(id).estado, "completado");
  // Y ya no se puede volver a enviar.
  assert.equal((await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id } })).status, 409);
});

test("si el envío se corta a mitad, reanudar NO repite a quien ya lo recibió", async () => {
  enviados = [];
  const r1 = await api("/api/anuncios/enviar", { method: "POST", body: { ...anuncio, asunto: "Corte a mitad", tanda: 0 } });
  const id = r1.data.anuncio_id;
  const yaEnviados = [...enviados];
  assert.ok(yaEnviados.length > 0 && yaEnviados.length < 25);
  // (el navegador se cierra aquí) -> reanudar desde el historial
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, reanudar: true } });
  assert.equal(r.status, 200);
  r = await hastaTerminar(r, id);
  assert.equal(r.data.completado, true);
  assert.deepEqual([...enviados].sort(), [...CORREOS], "llegó a las 25");
  sinRepetidos(enviados);
});

test("los fallidos quedan como incompleto y se reintentan al reanudar, sin repetir al resto", async () => {
  enviados = []; falla = new Set(["r03@x.es", "r17@x.es"]);
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { ...anuncio, asunto: "Con fallos", tanda: 0 } });
  const id = r.data.anuncio_id;
  r = await hastaTerminar(r, id);
  assert.equal(r.data.pendientes, 0, "no se queda en bucle con los fallidos");
  assert.equal(r.data.fallidos, 2);
  assert.equal(r.data.completado, false);
  assert.equal(sqlite.prepare("SELECT estado FROM anuncios_email WHERE id = ?").get(id).estado, "enviando");
  assert.equal(enviados.length, 23);

  falla = new Set(); // Resend se recupera
  r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, reanudar: true } });
  r = await hastaTerminar(r, id);
  assert.equal(r.data.completado, true);
  assert.deepEqual([...enviados].sort(), [...CORREOS]);
  sinRepetidos(enviados);
});

test("anuncio antiguo sin registro: se reconstruye desde Resend y no se repite a quien ya le llegó", async () => {
  enviados = []; falla = new Set();
  const id = Number(sqlite.prepare(
    "INSERT INTO anuncios_email (asunto, mensaje, audiencias, total_destinatarios, estado, created_at) VALUES ('Anuncio viejo', 'Hola', ?, 25, 'enviando', datetime('now', '-1 hour'))"
  ).run(JSON.stringify({ redactores: "todos" })).lastInsertRowid);
  const hace = new Date(Date.now() - 30 * 60000).toISOString();
  lista = [
    { id: "a", to: ["r01@x.es"], subject: "Anuncio viejo", created_at: hace, last_event: "delivered" },
    { id: "b", to: ["r02@x.es"], subject: "Anuncio viejo", created_at: hace, last_event: "sent" },
    { id: "c", to: ["r03@x.es"], subject: "Anuncio viejo", created_at: hace, last_event: "bounced" },       // rebotó: se reintenta
    { id: "d", to: ["r04@x.es"], subject: "Otro asunto", created_at: hace, last_event: "delivered" },        // otro correo
    { id: "e", to: ["r05@x.es"], subject: "Anuncio viejo", created_at: new Date(Date.now() - 5 * 3600e3).toISOString(), last_event: "delivered" }, // anterior al anuncio
    { id: "f", to: ["boss@x.es"], subject: "[PRUEBA] Anuncio viejo", created_at: hace, last_event: "delivered" },
  ];
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, reanudar: true } });
  assert.equal(r.status, 200);
  assert.match(r.data.aviso, /2 correo/);
  r = await hastaTerminar(r, id);
  assert.equal(r.data.completado, true);
  assert.ok(!enviados.includes("r01@x.es") && !enviados.includes("r02@x.es"), "a r01 y r02 no se les repite");
  assert.ok(enviados.includes("r03@x.es") && enviados.includes("r04@x.es") && enviados.includes("r05@x.es"));
  assert.equal(enviados.length, 23);
  sinRepetidos(enviados);
  lista = null;
});

test("anuncio antiguo y Resend sin permiso de lectura: no envía a ciegas; con la lista a mano sí, sin repetir", async () => {
  enviados = []; lista = null; // GET /emails -> 401
  const id = Number(sqlite.prepare(
    "INSERT INTO anuncios_email (asunto, mensaje, audiencias, total_destinatarios, estado) VALUES ('Sin permiso', 'Hola', ?, 25, 'enviando')"
  ).run(JSON.stringify({ redactores: "todos" })).lastInsertRowid);
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, reanudar: true } });
  assert.equal(r.status, 409);
  assert.equal(r.data.codigo, "SIN_REGISTRO");
  assert.equal(enviados.length, 0, "no se ha mandado nada a ciegas");

  r = await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id, reanudar: true, ya_recibieron: "R01@x.es, r02@x.es\nr03@x.es; no-es-un-correo" } });
  assert.equal(r.status, 200);
  r = await hastaTerminar(r, id);
  assert.equal(r.data.completado, true);
  assert.equal(enviados.length, 22);
  assert.ok(!["r01@x.es", "r02@x.es", "r03@x.es"].some((c) => enviados.includes(c)));
  sinRepetidos(enviados);
  assert.equal(registro(id)["r01@x.es"], "enviado");
});

test("dos llamadas a la vez no mandan el mismo correo dos veces", async () => {
  enviados = []; falla = new Set();
  const r1 = await api("/api/anuncios/enviar", { method: "POST", body: { ...anuncio, asunto: "Concurrente", tanda: 0 } });
  const id = r1.data.anuncio_id;
  await Promise.all([1, 2, 3].map(() => api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id } })));
  // Si las llamadas simultáneas no bastaron, se sigue hasta terminar (si ya terminó, el servidor responde 409).
  for (let i = 0; i < 30 && sqlite.prepare("SELECT estado FROM anuncios_email WHERE id = ?").get(id).estado !== "completado"; i++) {
    await api("/api/anuncios/enviar", { method: "POST", body: { anuncio_id: id } });
  }
  sinRepetidos(enviados);
  assert.equal(enviados.length, 25);
  assert.equal(Object.values(registro(id)).filter((e) => e === "enviado").length, 25);
});
