// Regresión: el redactor cancela su propio pedido de la tienda
// (PUT /api/tienda/mis-pedidos/<id>/cancelar). Antes devolvía siempre
// "Pedido no encontrado" porque se leía el segmento equivocado de la ruta.
//   node --no-warnings --test tests/tienda-cancelar.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/tienda-cancelar.test.mjs
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
CREATE TABLE tienda_pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL, producto_id INTEGER, producto_nombre TEXT NOT NULL,
  variante TEXT, precio_centimos INTEGER NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'pendiente_pago', referencia_pago TEXT, nota_gestion TEXT,
  gestionado_por INTEGER, gestionado_en TEXT, codigo TEXT, metodo_pago TEXT, entrega TEXT, direccion_envio TEXT, created_at TEXT DEFAULT (datetime('now')));
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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const usuario = (u) => Number(sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, email) VALUES (?,?,?,?,?)").run(u, "Nombre " + u, "redactor", 1, u + "@x.es").lastInsertRowid);
const pedido = (uid, estado = "pendiente_pago") => Number(sqlite.prepare("INSERT INTO tienda_pedidos (usuario_id, producto_nombre, estado) VALUES (?,?,?)").run(uid, "Camiseta", estado).lastInsertRowid);
const estadoDe = (id) => sqlite.prepare("SELECT estado FROM tienda_pedidos WHERE id = ?").get(id).estado;
async function api(ruta, token, method = "PUT") {
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method, headers: { Authorization: "Bearer " + token } }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test("cancelar un pedido propio pendiente de pago funciona", async () => {
  const uid = usuario("ana");
  const id = pedido(uid);
  const r = await api(`/api/tienda/mis-pedidos/${id}/cancelar`, await jwt({ uid, rol: "redactor", nombre: "Ana", tfa: true }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(estadoDe(id), "cancelado");
});

test("no se puede cancelar el pedido de otra persona (404) ni uno ya pagado (400)", async () => {
  const ana = usuario("ana2"), luis = usuario("luis");
  const deAna = pedido(ana);
  const tLuis = await jwt({ uid: luis, rol: "redactor", nombre: "Luis", tfa: true });
  assert.equal((await api(`/api/tienda/mis-pedidos/${deAna}/cancelar`, tLuis)).status, 404);
  assert.equal(estadoDe(deAna), "pendiente_pago");
  const pagado = pedido(luis, "pagado");
  assert.equal((await api(`/api/tienda/mis-pedidos/${pagado}/cancelar`, tLuis)).status, 400);
  assert.equal((await api(`/api/tienda/mis-pedidos/99999/cancelar`, tLuis)).status, 404);
});
