// Invitaciones de formulario: personas añadidas sin editar el formulario, con caducidad (7 días por defecto).
//   node --no-warnings --test tests/formularios-invitados.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/formularios-invitados.test.mjs
//
// SQLite en memoria con las migraciones REALES de formularios, invitaciones y registro de actividad.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
  nombre TEXT NOT NULL, rol TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, email TEXT, equipo TEXT, categorias_fijas TEXT
);`);
for (const f of ["migracion_formularios.sql", "migracion_formularios_invitados.sql", "migracion_activity_log.sql"]) {
  sqlite.exec(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  // El worker firma con b64url(String.fromCharCode(...bytes)): se replica tal cual para que la firma coincida.
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const adminId = Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('admin','x','y','Admin','admin')").run().lastInsertRowid);
const redactorId = Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('red','x','y','Red','redactor')").run().lastInsertRowid);
const tokenAdmin = await jwt({ uid: adminId, rol: "admin", nombre: "Admin", username: "admin", tfa: true });
const tokenRedactor = await jwt({ uid: redactorId, rol: "redactor", nombre: "Red", username: "red", tfa: true });

async function api(ruta, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(
    new Request("https://api.test" + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env, ctx);
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// Formulario con un desplegable que admite invitaciones y UNA opción fija ("Fija").
const crear = async (extra = {}) => {
  const r = await api("/api/formularios", { method: "POST", token: tokenAdmin, body: {
    titulo: "Prueba " + Math.random().toString(36).slice(2, 7),
    campos: [
      { id: "nombre", tipo: "desplegable", etiqueta: "Tu nombre", obligatorio: true, opciones: extra.sinFijas ? [] : ["Fija"], invitaciones: true },
      { id: "correo", tipo: "email", etiqueta: "Correo", obligatorio: true },
    ],
  } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { id: r.json.id, slug: r.json.slug };
};
const publico = async (slug) => (await api("/api/formularios-publicos/" + slug)).json;
const opciones = async (slug) => (await publico(slug)).campos.find((c) => c.id === "nombre").opciones;
const responder = (slug, nombre) => api("/api/formularios-publicos/responder", { method: "POST", body: { slug, respuestas: { nombre, correo: "a@b.es" } } });
const invitar = (id, personas, dias) => api(`/api/formularios/${id}/invitados`, { method: "POST", token: tokenAdmin, body: { campo_id: "nombre", personas, ...(dias !== undefined ? { dias } : {}) } });
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 19).replace("T", " ");

test("un campo con invitaciones puede crearse sin opciones fijas", async () => {
  const { id } = await crear({ sinFijas: true });
  assert.ok(id);
});

test("solo un admin gestiona invitaciones", async () => {
  const { id } = await crear();
  assert.equal((await api(`/api/formularios/${id}/invitados`)).status, 401);
  assert.equal((await api(`/api/formularios/${id}/invitados`, { token: tokenRedactor })).status, 403);
});

test("por defecto la invitación caduca a los 7 días y aparece en el formulario público", async () => {
  const { id, slug } = await crear();
  const r = await invitar(id, "Marta López\nPablo Ruiz");
  assert.equal(r.status, 200);
  assert.equal(r.json.anadidas, 2);
  const dias = (Date.parse(r.json.expira_at.replace(" ", "T") + "Z") - Date.now()) / 86400000;
  assert.ok(dias > 6.99 && dias <= 7.0001, `caduca en ${dias} días`);
  assert.deepEqual(await opciones(slug), ["Fija", "Marta López", "Pablo Ruiz"]);
  const lista = (await api(`/api/formularios/${id}/invitados`, { token: tokenAdmin })).json;
  assert.equal(lista.dias_defecto, 7);
  assert.deepEqual(lista.invitados.map((i) => i.estado), ["activa", "activa"]);
});

test("una invitación caducada desaparece del formulario y no se puede usar", async () => {
  const { id, slug } = await crear();
  await invitar(id, "Caducada Pérez");
  sqlite.prepare("UPDATE formularios_invitados SET expira_at = ? WHERE formulario_id = ?").run(hace(1), id);
  assert.deepEqual(await opciones(slug), ["Fija"]);
  const r = await responder(slug, "Caducada Pérez");
  assert.equal(r.status, 400);
  assert.match(r.json.error, /caducado/);
  const lista = (await api(`/api/formularios/${id}/invitados`, { token: tokenAdmin })).json.invitados;
  assert.equal(lista[0].estado, "caducada");
});

test("renovar devuelve la invitación a la lista; quitar la elimina", async () => {
  const { id, slug } = await crear();
  await invitar(id, "Renovable");
  const invId = sqlite.prepare("SELECT id FROM formularios_invitados WHERE formulario_id = ?").get(id).id;
  sqlite.prepare("UPDATE formularios_invitados SET expira_at = ? WHERE id = ?").run(hace(2), invId);
  assert.deepEqual(await opciones(slug), ["Fija"]);
  const ren = await api(`/api/formularios/invitados/${invId}`, { method: "PATCH", token: tokenAdmin, body: {} });
  assert.equal(ren.status, 200);
  assert.deepEqual(await opciones(slug), ["Fija", "Renovable"]);
  assert.equal((await api(`/api/formularios/invitados/${invId}`, { method: "DELETE", token: tokenAdmin })).status, 200);
  assert.deepEqual(await opciones(slug), ["Fija"]);
});

test("volver a invitar a alguien con la invitación caducada la renueva (sin duplicar)", async () => {
  const { id, slug } = await crear();
  await invitar(id, "Vuelve");
  sqlite.prepare("UPDATE formularios_invitados SET expira_at = ? WHERE formulario_id = ?").run(hace(3), id);
  const r = await invitar(id, "vuelve");
  assert.equal(r.json.renovadas, 1);
  assert.equal(r.json.anadidas, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM formularios_invitados WHERE formulario_id = ?").get(id).n, 1);
  assert.deepEqual(await opciones(slug), ["Fija", "Vuelve"]);
});

test("sin caducidad (dias = 0) la invitación no expira", async () => {
  const { id, slug } = await crear();
  const r = await invitar(id, "Para siempre", 0);
  assert.equal(r.json.expira_at, null);
  assert.deepEqual(await opciones(slug), ["Fija", "Para siempre"]);
});

test("días no válidos se rechazan", async () => {
  const { id } = await crear();
  for (const dias of [-1, 1.5, 366, "abc"]) assert.equal((await invitar(id, "X Y", dias)).status, 400, String(dias));
});

test("al responder, la invitación se consume y no puede usarla otra persona", async () => {
  const { id, slug } = await crear();
  await invitar(id, "Una sola vez");
  assert.equal((await responder(slug, "Una sola vez")).status, 200);
  assert.deepEqual(await opciones(slug), ["Fija"]);
  assert.equal((await responder(slug, "Una sola vez")).status, 409);
  const lista = (await api(`/api/formularios/${id}/invitados`, { token: tokenAdmin })).json.invitados;
  assert.equal(lista[0].estado, "usada");
  // Invitar de nuevo a quien ya ha respondido se omite con motivo.
  const otra = await invitar(id, "Una sola vez");
  assert.equal(otra.json.anadidas, 0);
  assert.match(otra.json.omitidas[0].motivo, /ya ha respondido/i);
});

test("se omiten duplicados: ya invitada y ya en la lista fija", async () => {
  const { id } = await crear();
  await invitar(id, "Dos Veces");
  const r = await invitar(id, "dos veces\nFija\nNueva Persona");
  assert.equal(r.json.anadidas, 1);
  assert.deepEqual(r.json.omitidas.map((o) => o.motivo).sort(), ["Ya está en la lista fija del formulario", "Ya está invitada"]);
});

test("un campo que no admite invitaciones se rechaza", async () => {
  const { id } = await crear();
  const r = await api(`/api/formularios/${id}/invitados`, { method: "POST", token: tokenAdmin, body: { campo_id: "correo", personas: "X" } });
  assert.equal(r.status, 400);
});

test("el formulario público no expone alias de usuarios y borrar el formulario borra sus invitaciones", async () => {
  const r = await api("/api/formularios", { method: "POST", token: tokenAdmin, body: {
    titulo: "Con alta",
    campos: [{ id: "nombre", tipo: "desplegable", etiqueta: "Tu nombre", opciones: ["Ana — AD Ceuta"], unica: true, alta_usuario: "redactor", alias_usuarios: { "Ana — AD Ceuta": "ana_ceuta" } }],
  } });
  assert.equal(r.status, 200);
  const pub = await publico(r.json.slug);
  assert.equal(pub.campos[0].alias_usuarios, undefined);
  // Con alta de usuario, una entrada sin nombre (solo un teléfono) se detecta al invitar, no al responder.
  const mala = await api(`/api/formularios/${r.json.id}/invitados`, { method: "POST", token: tokenAdmin, body: { campo_id: "nombre", personas: ["(600 000 000)", "Marta — AD Ceuta"] } });
  assert.equal(mala.json.anadidas, 1);
  assert.deepEqual(mala.json.omitidas.map((o) => o.motivo), ["Falta el nombre"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM formularios_invitados WHERE formulario_id = ?").get(r.json.id).n, 1);
  assert.equal((await api(`/api/formularios/${r.json.id}`, { method: "DELETE", token: tokenAdmin })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM formularios_invitados WHERE formulario_id = ?").get(r.json.id).n, 0);
});
