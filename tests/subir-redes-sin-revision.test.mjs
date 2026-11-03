// Noticias publicadas SIN revisión por redactores de Nivel 2 (el 3 ya puede subir a redes): el listado del panel las marca
// (sin_revision_redes) para que alguien de Nivel 4 las suba a redes; si no, nadie lo haría.
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que imita D1. Uso:
//   node --test tests/subir-redes-sin-revision.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --test tests/subir-redes-sin-revision.test.mjs
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
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, avatar_foco TEXT, categorias_fijas TEXT, nivel INTEGER DEFAULT 1,
  totp_secret TEXT, totp_activo INTEGER NOT NULL DEFAULT 0, totp_ultimo_paso INTEGER, totp_recovery TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, titulo TEXT, subtitulo TEXT, contenido TEXT, tipo TEXT DEFAULT 'noticia', categoria TEXT DEFAULT 'hypermotion',
  categorias_adicionales TEXT, club TEXT, imagen_url TEXT, imagenes TEXT, resultado_id INTEGER, autor_id INTEGER, autor_nombre TEXT, coautor_id INTEGER, coautor_nombre TEXT,
  destacado INTEGER DEFAULT 0, publicado INTEGER DEFAULT 1, estado_borrador TEXT, programado_para TEXT, fecha_preferencia_desde TEXT, fecha_preferencia_hasta TEXT,
  slug_congelado INTEGER DEFAULT 0, fecha_publicacion TEXT, created_at TEXT, updated_at TEXT,
  titulo_eu TEXT, contenido_eu TEXT, titulo_ca TEXT, contenido_ca TEXT, titulo_gl TEXT, contenido_gl TEXT, titulo_en TEXT, contenido_en TEXT,
  ficha_tecnica TEXT, fuera_calendario INTEGER DEFAULT 0, banner_urgente INTEGER DEFAULT 0, banner_urgente_hasta TEXT, redes_destino TEXT);
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

async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function pbkdf2(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256));
  return [...bits].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const PW = "una-clave-larga-1";
async function usuario(username, rol, nivel) {
  const salt = "00112233445566778899aabbccddeeff";
  const id = Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email) VALUES (?,?,?,?,?,?,?)")
    .run(username, await pbkdf2(PW, salt), salt, "Nombre " + username, rol, nivel, username + "@x.es").lastInsertRowid);
  const l = await api("/api/login", { method: "POST", body: { username, password: PW } });
  assert.ok(l.data.token, "entra solo con contraseña: " + username);
  return { id, token: l.data.token };
}
// fecha_publicacion como la guarda SQLite ("YYYY-MM-DD HH:MM:SS", UTC).
const art = (titulo, autor, { publicado = 1, redes = null, hace = "-1 hours" } = {}) =>
  Number(sqlite.prepare(
    "INSERT INTO articles (slug, titulo, autor_id, autor_nombre, publicado, redes_destino, fecha_publicacion) VALUES (?,?,?,?,?,?, datetime('now', ?))"
  ).run(titulo.toLowerCase().replace(/\W+/g, "-"), titulo, autor.id, "Autor", publicado, redes, hace).lastInsertRowid);

const U = {};
const A = {};
const lista = async () => {
  const r = await api("/api/articles?admin=1&limit=100", { token: U.n4.token });
  assert.equal(r.status, 200);
  return new Map(r.data.articles.map((a) => [a.id, a]));
};

test("preparación: autores de cada nivel y noticias de ejemplo", async () => {
  U.n1 = await usuario("n1", "redactor", 1);
  U.n2 = await usuario("n2", "redactor", 2);
  U.n3 = await usuario("n3", "redactor", 3);
  U.n4 = await usuario("n4", "redactor", 4);
  // El admin exige 2FA para entrar y aquí solo hace falta que exista como autor.
  U.adm = { id: Number(sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, email) VALUES ('adm', 'Nombre adm', 'admin', 1, 'adm@x.es')").run().lastInsertRowid) };
  A.deN2 = art("Noticia de nivel 2", U.n2);
  A.deN3 = art("Noticia de nivel 3", U.n3);
  A.deN2b = art("Otra noticia de nivel 2", U.n2);
  A.deN1 = art("Noticia de nivel 1", U.n1);
  A.deN4 = art("Noticia de nivel 4", U.n4);
  A.deAdmin = art("Noticia de admin", U.adm);
  A.etiquetada = art("Nivel 2 ya etiquetada", U.n2, { redes: "individual" });
  A.antigua = art("Nivel 2 antigua", U.n2, { hace: "-5 days" });
  A.borrador = art("Nivel 2 borrador", U.n2, { publicado: 0 });
  A.subida = art("Nivel 2 ya subida", U.n2);
  sqlite.prepare("INSERT INTO activity_log (accion, entidad, entidad_id) VALUES ('compartir_redes', 'articulo', ?)").run(String(A.subida));
});

test("las de Nivel 2 recién publicadas salen marcadas como pendientes de subir a redes", async () => {
  const l = await lista();
  assert.equal(l.get(A.deN2).sin_revision_redes, 1);
});

test("no se marcan las de Nivel 1 (pasan por revisión), Nivel 3 (ya sube a redes), Nivel 4 ni admin", async () => {
  const l = await lista();
  assert.equal(l.get(A.deN3).sin_revision_redes, 0);
  assert.equal(l.get(A.deN1).sin_revision_redes, 0);
  assert.equal(l.get(A.deN4).sin_revision_redes, 0);
  assert.equal(l.get(A.deAdmin).sin_revision_redes, 0);
});

test("dejan de estar pendientes si ya tienen etiqueta de redes, están anotadas como subidas, son antiguas o son borrador", async () => {
  const l = await lista();
  assert.equal(l.get(A.etiquetada).sin_revision_redes, 0);
  assert.equal(l.get(A.subida).sin_revision_redes, 0);
  assert.equal(l.get(A.antigua).sin_revision_redes, 0);
  assert.equal(l.get(A.borrador).sin_revision_redes, 0);
});

test("al etiquetarla para redes (Nivel 4) sale de la lista de pendientes", async () => {
  const r = await api("/api/articles/redes-destino", { method: "PUT", token: U.n4.token, body: { ids: [A.deN2], destino: "individual" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.actualizadas, [A.deN2]);
  const l = await lista();
  assert.equal(l.get(A.deN2).sin_revision_redes, 0);
  assert.equal(l.get(A.deN2b).sin_revision_redes, 1, "las demás de Nivel 2 siguen pendientes");
});

test("la vista pública no expone nada de esto", async () => {
  const r = await api("/api/articles?limit=100");
  assert.equal(r.status, 200);
  for (const a of r.data.articles) assert.equal(a.sin_revision_redes, 0);
});
