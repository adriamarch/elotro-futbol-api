// Anuncios por correo dirigidos a GRUPOS DE TRABAJO.
//   node --no-warnings --test tests/anuncios-grupos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/anuncios-grupos.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

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
const crear = (username, nombre, rol, activo = 1) => Number(sqlite.prepare(
  "INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email, activo) VALUES (?, 'x', 'x', ?, ?, 1, ?, ?)"
).run(username, nombre, rol, username + "@x.es", activo).lastInsertRowid);

const adminId = crear("boss", "Boss", "admin");
const ana = crear("ana", "Ana", "redactor");
const luis = crear("luis", "Luis", "fotografo");
const marta = crear("marta", "Marta", "redactor");
const eva = crear("eva", "Eva", "redactor");
const baja = crear("baja", "Baja", "redactor", 0);
const sola = crear("sola", "Sola", "redactor");

let enviados = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === "https://api.resend.com/emails" && init.method === "POST") {
    enviados.push(JSON.parse(init.body).to[0].toLowerCase());
    return new Response(JSON.stringify({ id: "e" + enviados.length }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

let token;
async function api(ruta, { method = "GET", body } = {}) {
  token ||= await jwt({ uid: adminId, rol: "admin", nombre: "Boss", tfa: true });
  const res = await worker.fetch(new Request("https://api.test" + ruta, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }), env, ctx);
  const data = await res.json().catch(() => ({}));
  await Promise.all(pendientes); pendientes = [];
  return { status: res.status, data };
}

let previas, fotos;
test("preparación: dos grupos con personas asignadas", async () => {
  let r = await api("/api/grupos-trabajo", { method: "PUT", body: { grupos: [{ nombre: "Previas" }, { nombre: "Fotografía" }, { nombre: "Vacío" }] } });
  assert.equal(r.status, 200);
  previas = r.data.grupos.find((g) => g.nombre === "Previas").id;
  fotos = r.data.grupos.find((g) => g.nombre === "Fotografía").id;
  for (const [u, g] of [[ana, previas], [eva, previas], [baja, previas], [marta, fotos]]) {
    r = await api("/api/grupos-trabajo/asignar", { method: "PUT", body: { user_id: u, grupo_id: g } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // Los fotógrafos no pueden estar en grupos de trabajo
  r = await api("/api/grupos-trabajo/asignar", { method: "PUT", body: { user_id: luis, grupo_id: fotos } });
  assert.equal(r.status, 400);
});

test("audiencias y personas incluyen cada grupo de trabajo (solo personas activas)", async () => {
  const a = await api("/api/anuncios/audiencias");
  assert.equal(a.data.conteos["grupo:" + previas], 2);
  assert.equal(a.data.conteos["grupo:" + fotos], 1);
  const p = await api("/api/anuncios/personas");
  assert.deepEqual(p.data.personas["grupo:" + previas].map((x) => x.email).sort(), ["ana@x.es", "eva@x.es"]);
  assert.deepEqual(p.data.personas["grupo:" + fotos].map((x) => x.email), ["marta@x.es"]);
  assert.deepEqual(p.data.personas["grupo:" + p.data.grupos_trabajo.find((g) => g.nombre === "Vacío").id], []);
  assert.equal(p.data.grupos_trabajo.length, 3);
});

test("un anuncio a un grupo solo llega a sus miembros y queda en el historial", async () => {
  enviados = [];
  const r = await api("/api/anuncios/enviar", { method: "POST", body: { asunto: "Previas", mensaje: "Hola", seleccion: { ["grupo:" + previas]: "todos" }, tanda: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 2);
  assert.deepEqual([...enviados].sort(), ["ana@x.es", "eva@x.es"]);
  const h = await api("/api/anuncios");
  assert.deepEqual(h.data.anuncios[0].audiencias, { ["grupo:" + previas]: "todos" });
});

test("grupo + rol se combinan sin repetir correos; se puede elegir a algunas personas del grupo", async () => {
  enviados = [];
  let r = await api("/api/anuncios/enviar", { method: "POST", body: { asunto: "Mezcla", mensaje: "Hola", seleccion: { ["grupo:" + previas]: "todos", redactores: "todos" }, tanda: 0 } });
  assert.equal(r.status, 200);
  assert.deepEqual([...enviados].sort(), ["ana@x.es", "eva@x.es", "marta@x.es", "sola@x.es"]);
  enviados = [];
  r = await api("/api/anuncios/enviar", { method: "POST", body: { asunto: "Algunas", mensaje: "Hola", seleccion: { ["grupo:" + previas]: ["ana@x.es", "luis@x.es", "otra@fuera.es"] }, tanda: 0 } });
  assert.equal(r.status, 200);
  assert.deepEqual(enviados, ["ana@x.es"], "solo filtra dentro del grupo: luis y un correo ajeno no reciben nada");
});

test("grupos inexistentes, vacíos o con claves raras no mandan nada", async () => {
  enviados = [];
  for (const sel of [{ "grupo:noexiste": "todos" }, { ["grupo:" + (await api("/api/anuncios/personas")).data.grupos_trabajo.find((g) => g.nombre === "Vacío").id]: "todos" }]) {
    const r = await api("/api/anuncios/enviar", { method: "POST", body: { asunto: "Nada", mensaje: "Hola", seleccion: sel, tanda: 0 } });
    assert.ok(r.status === 400 || r.data.total === 0, JSON.stringify(r.data));
  }
  const r = await api("/api/anuncios/enviar", { method: "POST", body: { asunto: "x", mensaje: "y", seleccion: { "grupo:a/../b": "todos", "grupo:": "todos" }, tanda: 0 } });
  assert.ok(r.status === 400 || r.data.total === 0);
  assert.deepEqual(enviados, []);
});
