// Comunicados oficiales del medio (Fase 1: los escriben los Responsables desde el panel).
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria. Uso:
//   node --test tests/comunicados.test.mjs
//   (en worker-secondary: node --test test/comunicados.test.mjs)
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
const env = { DB, JWT_SECRET };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
async function tokenDe(username, rol) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)").run(username, "Nombre " + username, rol, username + "@x.es");
  const uid = Number(r.lastInsertRowid);
  return { uid, token: await jwt({ uid, rol, nombre: "Nombre " + username, tfa: true }) };
}
async function api(token, metodo, ruta, cuerpo) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const TEXTO = "Este es el texto del comunicado oficial.\n\nSegundo párrafo con más detalle.";
const nuevo = (extra = {}) => ({ titulo: "Cambios en la redacción", contenido: TEXTO, ...extra });
const e = {};

test("preparación", async () => {
  e.admin = await tokenDe("responsable1", "admin");
  e.admin2 = await tokenDe("responsable2", "admin");
  e.redactor = await tokenDe("redactor1", "redactor");
  e.foto = await tokenDe("fotografo1", "fotografo");
});

test("solo los Responsables gestionan comunicados", async () => {
  for (const quien of [null, e.redactor.token, e.foto.token]) {
    assert.equal((await api(quien, "GET", "/api/comunicados/admin")).status, quien ? 403 : 401);
    assert.equal((await api(quien, "POST", "/api/comunicados", nuevo())).status, quien ? 403 : 401);
    assert.equal((await api(quien, "PUT", "/api/comunicados/abc", nuevo())).status, quien ? 403 : 401);
    assert.equal((await api(quien, "DELETE", "/api/comunicados/abc")).status, quien ? 403 : 401);
  }
  assert.equal((await api(e.admin.token, "GET", "/api/comunicados/admin")).status, 200);
});

test("validación de los campos", async () => {
  const malos = [
    [{ titulo: "" }, /título/i],
    [{ titulo: "x".repeat(151) }, /título/i],
    [{ contenido: "corto" }, /corto/i],
    [{ contenido: "y".repeat(8001) }, /largo/i],
    [{ resumen: "z".repeat(281) }, /resumen/i],
    [{ tipo: "otro" }, /tipo/i],
    [{ fecha: "2026-02-30" }, /fecha/i],
    [{ fecha: "hoy" }, /fecha/i],
    [{ firma: "f".repeat(81) }, /firma/i],
  ];
  for (const [extra, re] of malos) {
    const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo(extra));
    assert.equal(r.status, 400, JSON.stringify(extra).slice(0, 60));
    assert.match(r.data.error, re);
  }
});

test("crear: borrador por defecto, slug estable, firma con el cargo y texto limpio", async () => {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('responsables_funciones', ?)").run(JSON.stringify({ [e.admin.uid]: ["el Sitio Web", "los Recursos Humanos"] }));
  const r = await api(e.admin.token, "POST", "/api/comunicados", nuevo({ titulo: "  Cambios   en la\nredacción  ", contenido: "Línea uno.\r\n\r\n\r\n\r\nLínea dos con <b>etiqueta</b> incluida." }));
  assert.equal(r.status, 200);
  assert.match(r.data.slug, /^cambios-en-la-redaccion-[0-9a-f]{6}$/);
  assert.equal(r.data.firma, "Responsable del Sitio Web y los Recursos Humanos");
  e.id = r.data.id; e.slug = r.data.slug;
  const lista = (await api(e.admin.token, "GET", "/api/comunicados/admin")).data.items;
  assert.equal(lista.length, 1);
  const c = lista[0];
  assert.equal(c.titulo, "Cambios en la redacción");
  assert.equal(c.contenido, "Línea uno.\n\nLínea dos con <b>etiqueta</b> incluida."); // texto plano: no se interpreta ni se toca el HTML
  assert.equal(c.publicado, false);
  assert.equal(c.fijado, false);
  assert.equal(c.tipo, "comunicado");
  assert.equal(c.autor, "Nombre responsable1");
  assert.equal(c.editado, false);
  assert.match(c.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

test("un Responsable sin funciones firma solo como Responsable", async () => {
  const r = await api(e.admin2.token, "POST", "/api/comunicados", nuevo({ titulo: "Otro aviso", tipo: "aviso", publicado: true }));
  assert.equal(r.status, 200);
  assert.equal(r.data.firma, "Responsable");
  e.id2 = r.data.id;
});

test("editar: conserva slug, autor y firma; otro Responsable no cambia la firma", async () => {
  const antes = sqlite.prepare("SELECT slug, autor_id, firma, created_at FROM comunicados WHERE id = ?").get(e.id);
  const r = await api(e.admin2.token, "PUT", "/api/comunicados/" + e.id, nuevo({ titulo: "Título corregido", publicado: true, fecha: "2026-11-20", tipo: "rectificacion" }));
  assert.equal(r.status, 200);
  const despues = sqlite.prepare("SELECT * FROM comunicados WHERE id = ?").get(e.id);
  assert.equal(despues.slug, antes.slug);
  assert.equal(despues.autor_id, antes.autor_id);
  assert.equal(despues.firma, antes.firma);
  assert.equal(despues.firma, "Responsable del Sitio Web y los Recursos Humanos");
  assert.equal(despues.titulo, "Título corregido");
  assert.equal(despues.publicado, 1);
  assert.equal(despues.tipo, "rectificacion");
  assert.equal(despues.fecha, "2026-11-20");
  // Una firma escrita a mano sí se aplica.
  assert.equal((await api(e.admin.token, "PUT", "/api/comunicados/" + e.id, nuevo({ publicado: true, firma: "Dirección" }))).status, 200);
  assert.equal(sqlite.prepare("SELECT firma FROM comunicados WHERE id = ?").get(e.id).firma, "Dirección");
});

test("solo uno publicado y fijado a la vez; un borrador fijado no quita el fijado de otro", async () => {
  assert.equal((await api(e.admin.token, "PUT", "/api/comunicados/" + e.id, nuevo({ publicado: true, fijado: true }))).status, 200);
  assert.equal((await api(e.admin.token, "PUT", "/api/comunicados/" + e.id2, nuevo({ titulo: "Otro aviso", publicado: false, fijado: true }))).status, 200);
  const fijados = () => sqlite.prepare("SELECT id FROM comunicados WHERE fijado = 1 ORDER BY id").all().map((f) => f.id).sort();
  assert.deepEqual(fijados(), [e.id, e.id2].sort());
  assert.equal((await api(e.admin.token, "PUT", "/api/comunicados/" + e.id2, nuevo({ titulo: "Otro aviso", publicado: true, fijado: true }))).status, 200);
  assert.deepEqual(fijados(), [e.id2]);
});

test("registra la actividad y borrar funciona (404 si ya no existe)", async () => {
  const acciones = sqlite.prepare("SELECT accion FROM activity_log WHERE entidad = 'comunicado'").all().map((f) => f.accion);
  assert.ok(acciones.includes("crear_comunicado") && acciones.includes("editar_comunicado"));
  assert.equal((await api(e.admin.token, "DELETE", "/api/comunicados/" + e.id)).status, 200);
  assert.equal((await api(e.admin.token, "DELETE", "/api/comunicados/" + e.id)).status, 404);
  assert.equal((await api(e.admin.token, "PUT", "/api/comunicados/" + e.id, nuevo())).status, 404);
  assert.ok(sqlite.prepare("SELECT accion FROM activity_log WHERE accion = 'borrar_comunicado'").get());
  assert.equal((await api(e.admin.token, "GET", "/api/comunicados/admin")).data.items.length, 1);
});
