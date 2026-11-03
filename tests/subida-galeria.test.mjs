// Subida de fotos a la galería de partido: que casi nunca falle.
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria y un Cloudinary simulado. Uso:
//   node --test tests/subida-galeria.test.mjs
//   WORKER_ENTRY=../worker-secondary/src/index.js node --test tests/subida-galeria.test.mjs
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
CREATE UNIQUE INDEX idx_media_hash_unico ON media(hash_archivo) WHERE hash_archivo IS NOT NULL;
CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, equipo_local TEXT, equipo_visitante TEXT, fecha_partido TEXT, slug TEXT);
CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL, media_id INTEGER NOT NULL, orden INTEGER NOT NULL DEFAULT 0, vinculado_por_id INTEGER, equipo TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX idx_match_gallery_unico ON match_gallery(result_id, media_id);
INSERT INTO results (equipo_local, equipo_visitante, fecha_partido) VALUES ('Real Oviedo', 'Sporting', '2026-10-18');
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
const env = { DB, JWT_SECRET, CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

// Cloudinary simulado: se puede programar una cola de respuestas.
let cola = [];
let llamadasCloudinary = 0;
let contador = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.cloudinary.com")) return fetchOriginal(url, init);
  llamadasCloudinary++;
  const siguiente = cola.shift();
  if (siguiente === "red") throw new TypeError("fetch failed");
  if (typeof siguiente === "number") return new Response(JSON.stringify({ error: { message: "Server hiccup" } }), { status: siguiente });
  const id = ++contador;
  const esVideo = String(url).includes("/video/") || siguiente === "video";
  return new Response(JSON.stringify({
    public_id: `eof/p${id}`, resource_type: esVideo ? "video" : "image",
    secure_url: `https://res.cloudinary.com/demo/image/upload/v1/eof/p${id}.jpg`,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
async function tokenDe(username, rol) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, email) VALUES (?,?,?,?)").run(username, "Nombre " + username, rol, username + "@x.es");
  return jwt({ uid: Number(r.lastInsertRowid), rol, nombre: "Nombre " + username, tfa: true });
}
async function subir(token, { bytes, nombre = "foto.jpg", tipo = "image/jpeg", extra = {} }) {
  const f = new FormData();
  f.set("archivo", new File([bytes], nombre, { type: tipo }));
  f.set("titulo", "Foto del partido");
  f.set("avisoLote", "1");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  const res = await worker.fetch(new Request("https://api.test/api/media", { method: "POST", headers: { Authorization: "Bearer " + token }, body: f }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const bytesUnicos = (n) => new TextEncoder().encode("contenido-unico-" + n + "-" + "x".repeat(50));

const e = {};
test("preparación", async () => {
  e.foto1 = await tokenDe("fotografo1", "fotografo");
  e.foto2 = await tokenDe("fotografo2", "fotografo");
});

test("foto pública con partido: queda subida, vinculada y devuelve el enlace público", async () => {
  const r = await subir(e.foto1, { bytes: bytesUnicos(1), extra: { resultId: "1", equipo: "local", visibilidad: "publico" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.galeriaVinculada, true);
  assert.ok(r.data.mediaId > 0);
  assert.match(r.data.galeriaPartidoSlug, /real-oviedo/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery WHERE result_id = 1").get().n, 1);
});

test("reintento tras perderse la respuesta: el mismo autor NO recibe error de duplicado y no se duplica nada", async () => {
  const bytes = bytesUnicos(2);
  const a = await subir(e.foto1, { bytes, extra: { resultId: "1" } });
  assert.equal(a.status, 200);
  const antes = sqlite.prepare("SELECT COUNT(*) n FROM media").get().n;
  const b = await subir(e.foto1, { bytes, extra: { resultId: "1" } });
  assert.equal(b.status, 200, "debe ser idempotente");
  assert.equal(b.data.reutilizado, true);
  assert.equal(b.data.mediaId, a.data.mediaId);
  assert.equal(b.data.galeriaVinculada, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM media").get().n, antes, "no se crea otra fila");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery WHERE media_id = ?").get(a.data.mediaId).n, 1, "no se vincula dos veces");
});

test("el mismo archivo subido por OTRA persona sigue siendo duplicado (409)", async () => {
  const bytes = bytesUnicos(3);
  assert.equal((await subir(e.foto1, { bytes })).status, 200);
  const r = await subir(e.foto2, { bytes });
  assert.equal(r.status, 409);
  assert.equal(r.data.duplicado, true);
});

test("el mismo autor mucho después (>15 min) sí recibe el aviso de duplicado", async () => {
  const bytes = bytesUnicos(4);
  const a = await subir(e.foto1, { bytes });
  sqlite.prepare("UPDATE media SET created_at = datetime('now', '-2 hours') WHERE id = ?").run(a.data.mediaId);
  const b = await subir(e.foto1, { bytes });
  assert.equal(b.status, 409);
});

test("Cloudinary falla una vez (503) y a la segunda va bien: el usuario ni se entera", async () => {
  cola = [503];
  llamadasCloudinary = 0;
  const r = await subir(e.foto1, { bytes: bytesUnicos(5), extra: { resultId: "1" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(llamadasCloudinary, 2);
});

test("corte de red hacia Cloudinary una vez: se reintenta", async () => {
  cola = ["red"];
  const r = await subir(e.foto1, { bytes: bytesUnicos(6) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("un .mov de iPhone con tipo MIME vacío ya no se rechaza", async () => {
  cola = ["video"];
  const r = await subir(e.foto1, { bytes: bytesUnicos(7), nombre: "IMG_0001.MOV", tipo: "" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("image/jpg (tipo no estándar) se admite", async () => {
  const r = await subir(e.foto1, { bytes: bytesUnicos(8), nombre: "x.jpg", tipo: "image/jpg" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("sin la columna 'equipo' en match_gallery la foto se vincula igualmente", async () => {
  sqlite.exec(`
    ALTER TABLE match_gallery RENAME TO match_gallery_v2;
    CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL, media_id INTEGER NOT NULL, orden INTEGER NOT NULL DEFAULT 0, vinculado_por_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE UNIQUE INDEX idx_match_gallery_unico2 ON match_gallery(result_id, media_id);
  `);
  const r = await subir(e.foto1, { bytes: bytesUnicos(9), extra: { resultId: "1", equipo: "visitante" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.galeriaVinculada, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery").get().n, 1);
  sqlite.exec("DROP TABLE match_gallery; ALTER TABLE match_gallery_v2 RENAME TO match_gallery;");
});

test("si el vínculo falla del todo, la subida NO da error 5xx: avisa con galeriaVinculada=false", async () => {
  sqlite.exec("ALTER TABLE match_gallery RENAME TO match_gallery_roto;");
  const r = await subir(e.foto1, { bytes: bytesUnicos(10), extra: { resultId: "1" } });
  assert.equal(r.status, 200, "la foto ya está guardada: no puede ser un error");
  assert.equal(r.data.galeriaVinculada, false);
  assert.ok(r.data.mediaId > 0, "se devuelve el id para que el panel reintente el vínculo");
  sqlite.exec("ALTER TABLE match_gallery_roto RENAME TO match_gallery;");
});

test("un partido que ya no existe se rechaza ANTES de subir nada a Cloudinary", async () => {
  llamadasCloudinary = 0;
  const r = await subir(e.foto1, { bytes: bytesUnicos(11), extra: { resultId: "9999" } });
  assert.equal(r.status, 404);
  assert.equal(llamadasCloudinary, 0);
});
