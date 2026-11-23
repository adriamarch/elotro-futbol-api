// Descuento de la tienda por nivel: redactor de Nivel 3 o superior y fotógrafo de Nivel 2 (F2).
//   node --no-warnings --test tests/tienda-descuento.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/tienda-descuento.test.mjs
// Comprueba que (1) el catálogo llega rebajado solo a quien corresponde, (2) el pedido guarda el
// precio rebajado calculado en el servidor, (3) la ruta de gestión del catálogo NO se rebaja.
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
CREATE TABLE tienda_productos (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, descripcion TEXT, precio_centimos INTEGER NOT NULL,
  imagen_url TEXT, imagenes TEXT, variantes TEXT, stock INTEGER, requiere_para_acreditacion INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
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
const usuario = (u, rol, nivel, gestor = 0) => Number(sqlite.prepare(
  "INSERT INTO users (username, nombre, rol, nivel, email, puede_gestionar_tienda) VALUES (?,?,?,?,?,?)"
).run(u, "Nombre " + u, rol, nivel, u + "@x.es", gestor).lastInsertRowid);
const token = (uid, rol) => jwt({ uid, rol, nombre: "N" + uid, tfa: true });
async function api(ruta, tk, method = "GET", body) {
  const res = await worker.fetch(new Request("https://api.test" + ruta, {
    method, headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const PRODUCTO = Number(sqlite.prepare("INSERT INTO tienda_productos (nombre, precio_centimos) VALUES ('Gorra', 2000)").run().lastInsertRowid);

test("redactor N3, N4 y fotógrafo F2: catálogo con -10% y precio original", async () => {
  for (const [u, rol, nivel] of [["red3", "redactor", 3], ["red4", "redactor", 4], ["fot2", "fotografo", 2]]) {
    const uid = usuario(u, rol, nivel);
    const r = await api("/api/tienda/productos", await token(uid, rol));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.descuento.porcentaje, 10, u);
    assert.equal(r.data.productos[0].precio_centimos, 1800, u);
    assert.equal(r.data.productos[0].precio_original_centimos, 2000, u);
  }
});

test("redactor N1/N2, fotógrafo F1: sin descuento", async () => {
  for (const [u, rol, nivel] of [["red1", "redactor", 1], ["red2", "redactor", 2], ["fot1", "fotografo", 1]]) {
    const uid = usuario(u, rol, nivel);
    const r = await api("/api/tienda/productos", await token(uid, rol));
    assert.equal(r.data.descuento, null, u);
    assert.equal(r.data.productos[0].precio_centimos, 2000, u);
    assert.equal(r.data.productos[0].precio_original_centimos, undefined, u);
  }
});

test("un fotógrafo con nivel mayor que 2 se trata como F2 (con descuento)", async () => {
  // El nivel de un fotógrafo se interpreta con su escala (F1-F2); aquí nivel 3 >= 2 sigue siendo F2+.
  const uid = usuario("fot3", "fotografo", 3);
  const r = await api("/api/tienda/productos", await token(uid, "fotografo"));
  assert.equal(r.data.productos[0].precio_centimos, 1800);
});

test("el pedido guarda el precio rebajado y el total cuadra (nunca fiándose del navegador)", async () => {
  const uid = usuario("pedr3", "redactor", 3);
  const r = await api("/api/tienda/pedidos", await token(uid, "redactor"), "POST",
    { producto_id: PRODUCTO, cantidad: 2, precio_centimos: 1, metodo_pago: "bizum", entrega: "mano" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total_centimos, 3600);
  assert.equal(r.data.descuento_pct, 10);
  const filas = sqlite.prepare("SELECT precio_centimos FROM tienda_pedidos WHERE usuario_id = ?").all(uid);
  assert.deepEqual(filas.map((f) => f.precio_centimos), [1800, 1800]);
});

test("sin descuento el pedido sigue al precio normal", async () => {
  const uid = usuario("pedr1", "redactor", 1);
  const r = await api("/api/tienda/pedidos", await token(uid, "redactor"), "POST", { producto_id: PRODUCTO, cantidad: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total_centimos, 2000);
  assert.equal(r.data.descuento_pct, 0);
});

test("la gestión del catálogo (productos/todos) siempre devuelve el precio real", async () => {
  const uid = usuario("gest3", "redactor", 3, 1);
  const r = await api("/api/tienda/productos/todos", await token(uid, "redactor"));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.productos[0].precio_centimos, 2000);
});
