// Comunicados oficiales, Fase 2: lectura pública y avisos por push/correo al publicar.
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria, con fetch simulado para Resend y el push. Uso:
//   node --test tests/comunicados-publico.test.mjs
//   (en worker-secondary: node --test test/comunicados-publico.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const entrada = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, nivel INTEGER DEFAULT 1);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE newsletter_suscriptores (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, baja_token TEXT, activo INTEGER DEFAULT 1);
CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, noticias INTEGER DEFAULT 1, partidos INTEGER DEFAULT 1, solo_clubes INTEGER DEFAULT 0, user_agent TEXT);
CREATE TABLE push_subscription_clubs (subscription_id INTEGER, club TEXT);
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
};

// ---- claves de prueba para el push (VAPID del servidor y un navegador suscrito) ----
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const vapid = await crypto.subtle.exportKey("jwk", par.privateKey);
const env = { DB, JWT_SECRET, VAPID_PRIVATE_JWK: JSON.stringify(vapid), RESEND_API_KEY: "re_prueba" };

const pendientes = [];
const ctx = { waitUntil: (p) => { pendientes.push(Promise.resolve(p).catch(() => {})); } };

// fetch simulado: anota las llamadas a Resend y al endpoint del push
const resend = [];
const push = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("api.resend.com")) { resend.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
  if (u.startsWith("https://push.test/")) { push.push({ url: u, headers: init.headers }); return new Response(null, { status: 201 }); }
  return fetchReal(url, init);
};

async function jwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
async function tokenDe(username, rol) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)").run(username, "Nombre Secreto " + username, rol, username + "@x.es");
  const uid = Number(r.lastInsertRowid);
  return { uid, token: await jwt({ uid, rol, nombre: "Nombre Secreto " + username, tfa: true }) };
}
async function api(token, metodo, ruta, cuerpo) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), env, ctx);
  const data = await res.json().catch(() => ({}));
  await Promise.all(pendientes.splice(0)); // deja terminar los avisos en segundo plano
  return { status: res.status, data };
}

const TEXTO = "Este es el texto del comunicado oficial.\n\nSegundo párrafo con más detalle.";
const nuevo = (extra = {}) => ({ titulo: "Cambios en la redacción", contenido: TEXTO, ...extra });
const e = {};
const ids = {};

test("preparación", async () => {
  e.admin = await tokenDe("responsable1", "admin");
  // 2 suscriptores activos y 1 de baja; 1 navegador suscrito al push de noticias
  const ins = sqlite.prepare("INSERT INTO newsletter_suscriptores (email, baja_token, activo) VALUES (?,?,?)");
  ins.run("a@lector.es", "tok-a", 1); ins.run("b@lector.es", "tok-b", 1); ins.run("baja@lector.es", "tok-baja", 0);
  const nav = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = b64u(await crypto.subtle.exportKey("raw", nav.publicKey));
  sqlite.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?,?,?)").run("https://push.test/sub1", p256dh, b64u(crypto.getRandomValues(new Uint8Array(16))));
});

test("lectura pública: solo publicados, sin texto y sin datos del autor", async () => {
  const pub1 = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Primero publicado", fecha: "2026-11-01", publicado: true, firma: "Responsable del Sitio Web" }));
  const pub2 = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Segundo publicado", fecha: "2026-11-10", publicado: true, resumen: "Resumen corto" }));
  const borrador = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Borrador secreto", fecha: "2026-11-20" }));
  ids.pub1 = pub1.data; ids.pub2 = pub2.data; ids.borrador = borrador.data;

  const r = await api(null, "GET", "/api/comunicados"); // sin sesión: es público
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((i) => i.titulo), ["Segundo publicado", "Primero publicado"]); // más reciente primero, sin el borrador
  const it = r.data.items[0];
  assert.equal(it.resumen, "Resumen corto");
  assert.equal(it.contenido, undefined, "el listado no lleva el texto");
  // Se comprueban las CLAVES (no el texto: un título puede contener "publicado").
  const permitidas = ["slug", "tipo", "titulo", "resumen", "fecha", "fijado", "firma", "actualizado"];
  for (const item of r.data.items) assert.deepEqual(Object.keys(item).sort(), permitidas.slice().sort(), "claves públicas exactas");
  assert.ok(!JSON.stringify(r.data).includes("Nombre Secreto"), "no se filtra el nombre del autor");
  assert.equal(r.data.items[1].firma, "Responsable del Sitio Web");
});

test("detalle por slug: con texto; el borrador y lo inexistente dan 404", async () => {
  const ok = await api(null, "GET", "/api/comunicados/" + ids.pub1.slug);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.item.contenido, TEXTO);
  assert.deepEqual(Object.keys(ok.data.item).sort(), ["actualizado", "contenido", "fecha", "fijado", "firma", "resumen", "slug", "tipo", "titulo"]);
  assert.ok(!JSON.stringify(ok.data).includes("Nombre Secreto"));
  assert.equal((await api(null, "GET", "/api/comunicados/" + ids.borrador.slug)).status, 404);
  assert.equal((await api(null, "GET", "/api/comunicados/no-existe-abc123")).status, 404);
  // "admin" sigue siendo la ruta privada, no un slug
  assert.equal((await api(null, "GET", "/api/comunicados/admin")).status, 401);
});

test("fijado: null sin ninguno; devuelve el publicado y fijado, nunca un borrador fijado", async () => {
  assert.deepEqual((await api(null, "GET", "/api/comunicados/fijado")).data, { item: null });
  await api(e.admin.token, "PUT", "/api/comunicados/" + ids.borrador.id, nuevo({ titulo: "Borrador secreto", fijado: true, publicado: false }));
  assert.deepEqual((await api(null, "GET", "/api/comunicados/fijado")).data, { item: null }, "un borrador fijado no sale");
  await api(e.admin.token, "PUT", "/api/comunicados/" + ids.pub2.id, nuevo({ titulo: "Segundo publicado", fecha: "2026-11-10", fijado: true, publicado: true }));
  const f = await api(null, "GET", "/api/comunicados/fijado");
  assert.equal(f.data.item.titulo, "Segundo publicado");
  assert.equal(f.data.item.fijado, true);
  assert.equal(f.data.item.contenido, undefined);
});

test("retirar a borrador lo quita de la web; editar marca 'actualizado'", async () => {
  await api(e.admin.token, "PUT", "/api/comunicados/" + ids.pub1.id, nuevo({ titulo: "Primero publicado", publicado: false }));
  assert.equal((await api(null, "GET", "/api/comunicados/" + ids.pub1.slug)).status, 404);
  assert.ok(!(await api(null, "GET", "/api/comunicados")).data.items.some((i) => i.titulo === "Primero publicado"));
  const det = (await api(null, "GET", "/api/comunicados/" + ids.pub2.slug)).data.item;
  assert.equal(typeof det.actualizado, "string");
});

test("un fallo de base de datos da 503, no un listado vacío", async () => {
  const roto = { JWT_SECRET, DB: { prepare() { throw new Error("BD caída"); } } };
  const res = await worker.fetch(new Request("https://api.test/api/comunicados"), roto, ctx);
  assert.equal(res.status, 503);
  const res2 = await worker.fetch(new Request("https://api.test/api/comunicados/fijado"), roto, ctx);
  assert.equal(res2.status, 503);
});

test("sin casillas marcadas no se avisa a nadie", async () => {
  resend.length = 0; push.length = 0;
  const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Sin avisos", publicado: true }));
  assert.equal(r.status, 200);
  assert.equal(r.data.avisos, null);
  assert.equal(resend.length + push.length, 0);
});

test("publicar con avisar_correo: un correo por suscriptor ACTIVO, con baja y texto escapado", async () => {
  resend.length = 0; push.length = 0;
  const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo({
    titulo: "Aviso <b>importante</b>", contenido: "Primer párrafo <script>alert(1)</script> del texto.\n\nSegundo párrafo.", publicado: true, tipo: "aviso", avisar_correo: true,
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.avisos, { push: false, correo: true });
  assert.equal(resend.length, 2, "solo los 2 activos, no el de baja");
  assert.deepEqual(resend.map((m) => m.to[0]).sort(), ["a@lector.es", "b@lector.es"]);
  const m = resend.find((x) => x.to[0] === "a@lector.es");
  assert.match(m.subject, /^Aviso: Aviso /);
  assert.ok(m.html.includes("tok-a") && m.html.includes("/api/newsletter/baja?token="), "enlace de baja individual");
  assert.ok(m.html.includes("/comunicados/"), "botón hacia el comunicado en la web");
  assert.ok(!m.html.includes("<script>alert(1)</script>") && !m.html.includes("<b>importante</b>"), "el texto va escapado");
  assert.equal(push.length, 0, "sin avisar_push no hay push");
});

test("publicar con avisar_push: una notificación al navegador suscrito", async () => {
  resend.length = 0; push.length = 0;
  const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Novedad con push", publicado: true, tipo: "novedad", avisar_push: true }));
  assert.deepEqual(r.data.avisos, { push: true, correo: false });
  assert.equal(push.length, 1);
  assert.equal(push[0].url, "https://push.test/sub1");
  assert.equal(resend.length, 0, "sin avisar_correo no hay correo");
});

test("un borrador con casillas marcadas NO avisa; al publicarlo después, sí (una sola vez)", async () => {
  resend.length = 0; push.length = 0;
  const b = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Para publicar luego", avisar_push: true, avisar_correo: true }));
  assert.equal(b.data.avisos, null);
  assert.equal(resend.length + push.length, 0);
  const pub = await api(e.admin.token, "PUT", "/api/comunicados/" + b.data.id, nuevo({ titulo: "Para publicar luego", publicado: true, avisar_push: true, avisar_correo: true }));
  assert.deepEqual(pub.data.avisos, { push: true, correo: true });
  assert.equal(resend.length, 2);
  assert.equal(push.length, 1);
  // editar uno ya publicado, aunque lleve las casillas, no vuelve a avisar
  resend.length = 0; push.length = 0;
  const ed = await api(e.admin.token, "PUT", "/api/comunicados/" + b.data.id, nuevo({ titulo: "Para publicar luego (corregido)", publicado: true, avisar_push: true, avisar_correo: true }));
  assert.equal(ed.data.avisos, null);
  assert.equal(resend.length + push.length, 0);
});

test("solo es true estricto: 'true' como texto o 1 no disparan avisos", async () => {
  resend.length = 0; push.length = 0;
  const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "Casillas raras", publicado: true, avisar_push: "true", avisar_correo: 1 }));
  assert.equal(r.data.avisos, null);
  assert.equal(resend.length + push.length, 0);
});
