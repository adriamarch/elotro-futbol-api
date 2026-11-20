// Editar varios archivos de contenido a la vez: POST /api/media/editar-lote.
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que imita D1. Uso:
//   node --test tests/media-editar-lote.test.mjs
//   WORKER_ENTRY=../worker-secondary/src/index.js node --test tests/media-editar-lote.test.mjs
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
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, nivel INTEGER DEFAULT 1);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, cloudinary_public_id TEXT UNIQUE NOT NULL, cloudinary_resource_type TEXT NOT NULL, cloudinary_url TEXT NOT NULL, titulo TEXT NOT NULL, descripcion TEXT, tipo TEXT NOT NULL, nombre_archivo TEXT NOT NULL, content_type TEXT NOT NULL, tamano_bytes INTEGER NOT NULL, autor_id INTEGER, autor_nombre TEXT, club TEXT, hash_archivo TEXT, portada_segundo REAL, portada_foco TEXT, visibilidad TEXT NOT NULL DEFAULT 'publico', created_at TEXT NOT NULL DEFAULT (datetime('now')));
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
  async batch(sentencias) {
    const out = [];
    sqlite.exec("BEGIN");
    try { for (const s of sentencias) out.push(await s.run()); sqlite.exec("COMMIT"); }
    catch (err) { sqlite.exec("ROLLBACK"); throw err; }
    return out;
  },
};
const env = { DB, JWT_SECRET };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

async function api(ruta, { method = "GET", body, token, form } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { ...(form ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
// Los admins exigen 2FA en el login: se firma el token directamente (tfa: true).
async function tokenDe(username, rol) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)")
    .run(username, "Nombre " + username, rol, username + "@x.es");
  return jwt({ uid: Number(r.lastInsertRowid), rol, nombre: "Nombre " + username, tfa: true });
}
const subirEnlace = (token, enlace, extra = {}) => {
  const f = new FormData();
  f.set("enlaceExterno", enlace);
  f.set("enlaceTipo", "video");
  f.set("enlaceTamano", "1000");
  f.set("titulo", "Vídeo pesado");
  f.set("avisoLote", "1");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return api("/api/media", { method: "POST", token, form: f });
};

const e = {};
const url = "/api/media/editar-lote";
const lote = (token, ids, cambios) => api(url, { method: "POST", token, body: { ids, cambios } });
const fila = (id) => sqlite.prepare("SELECT titulo t, descripcion d, club c, visibilidad v, carpeta_id f FROM media WHERE id = ?").get(id);
const enlace = (id) => sqlite.prepare("SELECT result_id r, equipo e, orden o FROM match_gallery WHERE media_id = ?").get(id);
const uidDe = (u) => sqlite.prepare("SELECT id FROM users WHERE username = ?").get(u).id;
const nuevoMedia = (autorId, { visibilidad = "privado", carpeta = null, titulo = "Archivo", club = null } = {}) => {
  const n = sqlite.prepare("SELECT COALESCE(MAX(id),0)+1 n FROM media").get().n;
  const r = sqlite.prepare(
    "INSERT INTO media (cloudinary_public_id, cloudinary_resource_type, cloudinary_url, titulo, tipo, nombre_archivo, content_type, tamano_bytes, autor_id, visibilidad, carpeta_id, club) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(`pid-${n}`, "image", `https://res.cloudinary.com/x/image/upload/v1/pid-${n}.jpg`, titulo, "foto", `f${n}.jpg`, "image/jpeg", 10, autorId, visibilidad, carpeta, club);
  return Number(r.lastInsertRowid);
};

test("preparación: tablas de carpetas, partidos y galería", async () => {
  sqlite.exec(`
    CREATE TABLE media_carpetas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, creada_por_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    ALTER TABLE media ADD COLUMN carpeta_id INTEGER REFERENCES media_carpetas(id) ON DELETE SET NULL;
    CREATE TABLE results (id INTEGER PRIMARY KEY, equipo_local TEXT, equipo_visitante TEXT, slug TEXT);
    CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER, media_id INTEGER, orden INTEGER, vinculado_por_id INTEGER, equipo TEXT);
    INSERT INTO results (id, equipo_local, equipo_visitante) VALUES (1, 'Racing', 'Eibar'), (2, 'Celta B', 'Fabril');
  `);
  e.admin = await tokenDe("admin1", "admin");
  e.redac = await tokenDe("redac1", "redactor");
  e.otro = await tokenDe("redac2", "redactor");
  e.carpetaA = Number(sqlite.prepare("INSERT INTO media_carpetas (nombre) VALUES ('Galas')").run().lastInsertRowid);
  e.carpetaB = Number(sqlite.prepare("INSERT INTO media_carpetas (nombre) VALUES ('Entrevistas')").run().lastInsertRowid);
});

test("validación: sesión, ids, cambios, título, visibilidad, partido y carpeta", async () => {
  const mio = nuevoMedia(uidDe("redac1"), { titulo: "Original" });
  assert.equal((await lote(undefined, [mio], { descripcion: "x" })).status, 401);
  assert.equal((await lote(e.redac, [], { descripcion: "x" })).status, 400, "sin archivos");
  assert.equal((await lote(e.redac, Array.from({ length: 201 }, (_, i) => i + 1), { descripcion: "x" })).status, 400, "más de 200");
  assert.equal((await lote(e.redac, [mio], {})).status, 400, "sin ningún cambio");
  assert.equal((await lote(e.redac, [mio], { titulo: "   " })).status, 400, "título vacío");
  assert.equal((await lote(e.redac, [mio], { visibilidad: "secreto" })).status, 400);
  assert.equal((await lote(e.redac, [mio], { resultId: 999 })).status, 404, "partido inexistente");
  assert.equal((await lote(e.redac, [mio], { resultId: "abc" })).status, 400);
  const mala = await lote(e.redac, [mio], { titulo: "Cambiado", carpeta_id: 99999 });
  assert.equal(mala.status, 400, "carpeta inexistente");
  assert.equal(fila(mio).t, "Original", "todo o nada: no se guarda NADA si algo no valida");
});

test("un redactor solo edita lo suyo; lo ajeno se omite; título numerado en el orden de ids", async () => {
  const redacId = uidDe("redac1");
  const a = nuevoMedia(redacId, { titulo: "A" });
  const b = nuevoMedia(redacId, { titulo: "B" });
  const ajeno = nuevoMedia(uidDe("redac2"), { titulo: "Ajeno" });
  const r = await lote(e.redac, [b, ajeno, a], { titulo: "Racing - Eibar", numerar: true, descripcion: "Crónica del partido" });
  assert.equal(r.status, 200);
  assert.equal(r.data.editados, 2);
  assert.equal(r.data.omitidos, 1);
  assert.equal(fila(b).t, "Racing - Eibar 1", "numera según el orden de ids que llega");
  assert.equal(fila(a).t, "Racing - Eibar 2");
  assert.equal(fila(a).d, "Crónica del partido");
  assert.equal(fila(ajeno).t, "Ajeno", "lo de otra persona no se toca");
  assert.equal((await lote(e.redac, [ajeno], { descripcion: "x" })).status, 403, "si no puede tocar nada: 403");

  const sinNumerar = await lote(e.redac, [a, b], { titulo: "Mismo título" });
  assert.equal(sinNumerar.status, 200);
  assert.equal(fila(a).t, "Mismo título");
  assert.equal(fila(b).t, "Mismo título");
  assert.equal(fila(a).d, "Crónica del partido", "lo que no se marca se queda como estaba");
  const vaciar = await lote(e.redac, [a], { descripcion: "" });
  assert.equal(vaciar.status, 200);
  assert.equal(fila(a).d, null, "descripción vacía = se borra");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity_log WHERE accion = 'editar_media_lote'").get().n, 3);
});

test("un admin edita lo ajeno", async () => {
  const ajeno = nuevoMedia(uidDe("redac2"), { titulo: "Ajeno" });
  const r = await lote(e.admin, [ajeno], { titulo: "Retocado" });
  assert.equal(r.status, 200);
  assert.equal(r.data.editados, 1);
  assert.equal(fila(ajeno).t, "Retocado");
});

test("visibilidad y carpeta: público desvincula; la carpeta solo afecta a lo privado", async () => {
  const redacId = uidDe("redac1");
  const priv = nuevoMedia(redacId, { visibilidad: "privado" });
  const pub = nuevoMedia(redacId, { visibilidad: "publico" });
  // Solo carpeta (sin tocar visibilidad): el privado entra, el público se queda sin carpeta.
  const c = await lote(e.redac, [priv, pub], { carpeta_id: String(e.carpetaA) });
  assert.equal(c.status, 200);
  assert.equal(fila(priv).f, e.carpetaA);
  assert.equal(fila(pub).f, null, "el público nunca tiene carpeta");
  // Público + carpeta: gana público (se desvincula).
  assert.equal((await lote(e.redac, [priv], { visibilidad: "publico", carpeta_id: String(e.carpetaB) })).status, 200);
  assert.equal(fila(priv).v, "publico");
  assert.equal(fila(priv).f, null);
  // Privado + carpeta: se aplican las dos a todos.
  assert.equal((await lote(e.redac, [priv, pub], { visibilidad: "privado", carpeta_id: e.carpetaB })).status, 200);
  assert.equal(fila(priv).v, "privado");
  assert.equal(fila(pub).v, "privado");
  assert.equal(fila(priv).f, e.carpetaB);
  assert.equal(fila(pub).f, e.carpetaB);
  // "Sin carpeta" explícito.
  assert.equal((await lote(e.redac, [priv, pub], { carpeta_id: "" })).status, 200);
  assert.equal(fila(priv).f, null);
  assert.equal(fila(pub).f, null);
});

test("club: se fija y se quita en todos", async () => {
  const redacId = uidDe("redac1");
  const a = nuevoMedia(redacId);
  const b = nuevoMedia(redacId, { club: "Racing de Ferrol" });
  assert.equal((await lote(e.redac, [a, b], { club: "Deportivo" })).status, 200);
  assert.equal(fila(a).c, "Deportivo");
  assert.equal(fila(b).c, "Deportivo");
  assert.equal((await lote(e.redac, [a, b], { club: "" })).status, 200);
  assert.equal(fila(a).c, null);
  assert.equal(fila(b).c, null);
});

test("partido: vincula varios a la vez (órdenes consecutivos), cambia de partido y lo quita; el club se anula", async () => {
  const redacId = uidDe("redac1");
  const a = nuevoMedia(redacId, { club: "Deportivo" });
  const b = nuevoMedia(redacId);
  const c = nuevoMedia(redacId);
  // Una ya vinculada al partido 1 para comprobar que no se duplica.
  sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, orden, vinculado_por_id, equipo) VALUES (1, ?, 0, ?, NULL)").run(c, redacId);

  const v = await lote(e.redac, [a, b, c], { resultId: 1, equipo: "local" });
  assert.equal(v.status, 200);
  for (const id of [a, b, c]) {
    assert.equal(enlace(id).r, 1);
    assert.equal(enlace(id).e, "local");
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery WHERE media_id = ?").get(c).n, 1, "la ya vinculada se actualiza, no se duplica");
  const ordenes = [a, b].map((id) => enlace(id).o).sort((x, y) => x - y);
  assert.deepEqual(ordenes, [1, 2], "las nuevas siguen al máximo orden del partido");
  assert.equal(fila(a).c, null, "con partido el club de texto libre se anula");

  const otroPartido = await lote(e.redac, [a, b], { resultId: 2, equipo: "visitante" });
  assert.equal(otroPartido.status, 200);
  assert.equal(enlace(a).r, 2);
  assert.equal(enlace(a).e, "visitante");
  assert.equal(enlace(c).r, 1, "lo no seleccionado no cambia");

  const quitar = await lote(e.redac, [a, b, c], { resultId: null });
  assert.equal(quitar.status, 200);
  for (const id of [a, b, c]) assert.equal(enlace(id), undefined);
});

test("la edición en lote no toca archivos de otras personas al vincular partido", async () => {
  const ajeno = nuevoMedia(uidDe("redac2"));
  const mio = nuevoMedia(uidDe("redac1"));
  const r = await lote(e.redac, [mio, ajeno], { resultId: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.editados, 1);
  assert.ok(enlace(mio));
  assert.equal(enlace(ajeno), undefined);
});
