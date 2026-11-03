// Portada obligatoria de las galerías de partido (match_gallery.es_portada).
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria y un Cloudinary simulado. Uso:
//   node --test tests/galeria-portada.test.mjs
//   (en worker-secondary: node --test test/galeria-portada.test.mjs)
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
CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, cloudinary_public_id TEXT UNIQUE NOT NULL, cloudinary_resource_type TEXT NOT NULL, cloudinary_url TEXT NOT NULL, titulo TEXT NOT NULL, descripcion TEXT, tipo TEXT NOT NULL, nombre_archivo TEXT NOT NULL, content_type TEXT NOT NULL, tamano_bytes INTEGER NOT NULL, autor_id INTEGER, autor_nombre TEXT, club TEXT, hash_archivo TEXT, portada_segundo REAL, portada_foco TEXT, visibilidad TEXT NOT NULL DEFAULT 'publico', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX idx_media_hash_unico ON media(hash_archivo) WHERE hash_archivo IS NOT NULL;
CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, equipo_local TEXT, equipo_visitante TEXT, escudo_local_url TEXT, escudo_visitante_url TEXT, goles_local INTEGER, goles_visitante INTEGER, penaltis_local INTEGER, penaltis_visitante INTEGER, fecha_partido TEXT, estado TEXT, competicion TEXT, jornada INTEGER, slug TEXT);
CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL, media_id INTEGER NOT NULL, orden INTEGER NOT NULL DEFAULT 0, vinculado_por_id INTEGER, equipo TEXT, es_portada INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX idx_match_gallery_unico ON match_gallery(result_id, media_id);
INSERT INTO results (equipo_local, equipo_visitante, fecha_partido, estado, competicion, jornada) VALUES ('Real Oviedo', 'Sporting', '2026-10-18', 'finalizado', 'hypermotion', 9);
INSERT INTO results (equipo_local, equipo_visitante, fecha_partido, estado, competicion, jornada) VALUES ('Celta Fortuna', 'CD Lugo', '2026-11-01', 'finalizado', 'primera_federacion', 10);
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

// Cloudinary simulado: cola opcional de respuestas ("video" => la siguiente subida es un vídeo).
let cola = [];
let contador = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.cloudinary.com")) return fetchOriginal(url, init);
  const siguiente = cola.shift();
  const id = ++contador;
  const esVideo = siguiente === "video";
  return new Response(JSON.stringify({
    public_id: `eof/p${id}`, resource_type: esVideo ? "video" : "image",
    secure_url: `https://res.cloudinary.com/demo/${esVideo ? "video" : "image"}/upload/v1/eof/p${id}.${esVideo ? "mp4" : "jpg"}`,
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
const bytesUnicos = (n) => new TextEncoder().encode("portada-unica-" + n + "-" + "x".repeat(50));
let secuencia = 0;
async function subir(token, extra = {}, { video = false } = {}) {
  if (video) cola = ["video"];
  const f = new FormData();
  f.set("archivo", new File([bytesUnicos(++secuencia)], video ? "v.mp4" : "f.jpg", { type: video ? "video/mp4" : "image/jpeg" }));
  f.set("titulo", "Foto del partido");
  f.set("avisoLote", "1");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  const res = await worker.fetch(new Request("https://api.test/api/media", { method: "POST", headers: { Authorization: "Bearer " + token }, body: f }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function api(token, metodo, ruta, cuerpo) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
// El worker cachea las lecturas públicas por URL dentro del isolate: un parámetro único evita respuestas cacheadas.
let t = 0;
const publica = (ruta) => api(null, "GET", ruta + (ruta.includes("?") ? "&" : "?") + "t=" + (++t));
const portadas = (resultId) => sqlite.prepare("SELECT media_id FROM match_gallery WHERE result_id = ? AND es_portada = 1 ORDER BY media_id").all(resultId).map((f) => f.media_id);
const enlaceDe = (mediaId) => sqlite.prepare("SELECT id FROM match_gallery WHERE media_id = ?").get(mediaId).id;

const e = {};
test("preparación", async () => {
  e.foto = await tokenDe("fotografo1", "fotografo");
  e.admin = await tokenDe("admin1", "admin");
  e.redactor = await tokenDe("redactor1", "redactor");
});

test("al subir una foto marcada como portada queda como portada de la galería de ese partido", async () => {
  const a = await subir(e.foto, { resultId: "1", esPortada: "1" });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.galeriaVinculada, true);
  assert.deepEqual(portadas(1), [a.data.mediaId]);
  e.portada1 = a.data.mediaId;
});

test("una foto sin marcar no cambia la portada; marcar otra la sustituye (siempre una sola)", async () => {
  const b = await subir(e.foto, { resultId: "1" });
  assert.deepEqual(portadas(1), [e.portada1], "la portada sigue siendo la primera");
  e.fotoB = b.data.mediaId;
  const c = await subir(e.foto, { resultId: "1", esPortada: "1" });
  assert.deepEqual(portadas(1), [c.data.mediaId], "ahora solo hay una portada, la nueva");
  e.portada1 = c.data.mediaId;
});

test("la portada de un partido no afecta a la de otro", async () => {
  const d = await subir(e.foto, { resultId: "2", esPortada: "1" });
  assert.deepEqual(portadas(2), [d.data.mediaId]);
  assert.deepEqual(portadas(1), [e.portada1]);
});

test("un vídeo o una foto privada no pueden quedar como portada aunque se pida", async () => {
  const v = await subir(e.foto, { resultId: "1", esPortada: "1" }, { video: true });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.galeriaVinculada, true);
  const p = await subir(e.foto, { resultId: "1", esPortada: "1", visibilidad: "privado" });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(portadas(1), [e.portada1], "la portada sigue siendo la foto pública de antes");
  e.video1 = v.data.mediaId;
  e.privada1 = p.data.mediaId;
});

test("esPortada sin partido se ignora sin dar error", async () => {
  const r = await subir(e.foto, { esPortada: "1" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("GET de la galería para el panel: indica la portada y marca cada fila", async () => {
  const r = await api(e.foto, "GET", "/api/results/1/galeria");
  assert.equal(r.status, 200);
  assert.equal(r.data.tienePortada, true);
  assert.equal(r.data.portadaMediaId, e.portada1);
  const marcadas = r.data.galeria.filter((g) => g.es_portada === 1);
  assert.deepEqual(marcadas.map((g) => g.media_id), [e.portada1]);
  assert.ok(r.data.galeria.some((g) => g.visibilidad === "privado"), "el panel recibe la visibilidad de cada foto");
});

test("un partido sin portada lo indica (tienePortada=false)", async () => {
  const sinPortada = sqlite.prepare("INSERT INTO results (equipo_local, equipo_visitante, fecha_partido, estado) VALUES ('A','B','2026-11-02','finalizado')").run().lastInsertRowid;
  e.sinPortada = Number(sinPortada);
  const f = await subir(e.foto, { resultId: String(e.sinPortada) });
  assert.equal(f.status, 200);
  const r = await api(e.foto, "GET", `/api/results/${e.sinPortada}/galeria`);
  assert.equal(r.data.tienePortada, false);
  assert.equal(r.data.portadaMediaId, null);
});

test("PATCH {portada:true} cambia la portada y deja solo una", async () => {
  const otra = sqlite.prepare("SELECT media_id FROM match_gallery WHERE result_id = 1 AND es_portada = 0 AND media_id NOT IN (?, ?)").get(e.video1, e.privada1).media_id;
  const r = await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(otra)}`, { portada: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(portadas(1), [otra]);
  e.portada1 = otra;
});

test("PATCH {portada:true} rechaza vídeos y fotos privadas, y un redactor no puede", async () => {
  const v = await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(e.video1)}`, { portada: true });
  assert.equal(v.status, 400);
  assert.match(v.data.error, /foto, no un vídeo/);
  const p = await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(e.privada1)}`, { portada: true });
  assert.equal(p.status, 400);
  assert.match(p.data.error, /privada/);
  const r = await api(e.redactor, "PATCH", `/api/match-gallery/${enlaceDe(e.portada1)}`, { portada: true });
  assert.equal(r.status, 403);
  assert.deepEqual(portadas(1), [e.portada1], "nada cambió");
});

test("PATCH con el equipo sigue funcionando y no toca la portada", async () => {
  const r = await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(e.portada1)}`, { equipo: "local" });
  assert.equal(r.status, 200);
  assert.deepEqual(portadas(1), [e.portada1]);
  assert.equal(sqlite.prepare("SELECT equipo FROM match_gallery WHERE media_id = ?").get(e.portada1).equipo, "local");
});

test("no se puede quitar la portada mientras queden otras fotos públicas (409); quitar otra foto sí", async () => {
  const r = await api(e.admin, "DELETE", `/api/match-gallery/${enlaceDe(e.portada1)}`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /portada/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery WHERE media_id = ?").get(e.portada1).n, 1, "sigue en la galería");
  const otra = sqlite.prepare("SELECT media_id FROM match_gallery WHERE result_id = 1 AND es_portada = 0 AND media_id NOT IN (?, ?)").get(e.video1, e.privada1).media_id;
  const ok = await api(e.admin, "DELETE", `/api/match-gallery/${enlaceDe(otra)}`);
  assert.equal(ok.status, 200);
});

test("la última foto pública sí se puede quitar aunque sea la portada (la galería desaparece)", async () => {
  // Se quitan todas las demás (fotos públicas, el vídeo y la privada) y por último la portada.
  const demas = sqlite.prepare("SELECT id FROM match_gallery WHERE result_id = 1 AND media_id <> ?").all(e.portada1);
  for (const { id } of demas) assert.equal((await api(e.admin, "DELETE", `/api/match-gallery/${id}`)).status, 200);
  const r = await api(e.admin, "DELETE", `/api/match-gallery/${enlaceDe(e.portada1)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM match_gallery WHERE result_id = 1").get().n, 0);
});

test("la foto privada que queda no cuenta como 'otra foto' para impedir quitar la portada", async () => {
  const a = await subir(e.foto, { resultId: "2" });
  const priv = await subir(e.foto, { resultId: "2", visibilidad: "privado" });
  assert.equal(a.status, 200); assert.equal(priv.status, 200);
  // En el partido 2 la portada es la foto subida antes; la pública extra sí cuenta, la privada no.
  const portada2 = portadas(2)[0];
  const r = await api(e.admin, "DELETE", `/api/match-gallery/${enlaceDe(portada2)}`);
  assert.equal(r.status, 409, "queda otra foto pública (a) → hay que elegir otra portada antes");
});

test("vista pública de la galería: devuelve la portada elegida y marca esa foto", async () => {
  const slug = (await api(e.foto, "GET", "/api/results/2/galeria")).data.slug;
  assert.ok(slug);
  const r = await publica(`/api/results/galeria/${slug}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.portada.elegida, true);
  assert.equal(r.data.portada.media_id, portadas(2)[0]);
  const fotos = Object.values(r.data.grupos).flatMap((g) => g.fotos);
  assert.equal(fotos.filter((f) => f.es_portada).length, 1);
  assert.ok(fotos.every((f) => f.cloudinary_url && !/privada/.test(f.titulo)), "las privadas no salen");
});

test("vista pública sin portada elegida: se usa la primera foto (elegida=false)", async () => {
  const slug = (await api(e.foto, "GET", `/api/results/${e.sinPortada}/galeria`)).data.slug;
  const r = await publica(`/api/results/galeria/${slug}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.portada.elegida, false);
  assert.ok(r.data.portada.url);
});

test("listado público: la portada va primera entre las fotos de muestra y se expone como 'portada'", async () => {
  // Partido 2 con varias fotos y una portada que NO es la primera por orden.
  for (let i = 0; i < 3; i++) await subir(e.foto, { resultId: "2" });
  const ultima = sqlite.prepare("SELECT media_id FROM match_gallery WHERE result_id = 2 ORDER BY orden DESC LIMIT 1").get().media_id;
  assert.equal((await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(ultima)}`, { portada: true })).status, 200);
  const urlUltima = sqlite.prepare("SELECT cloudinary_url u FROM media WHERE id = ?").get(ultima).u;
  const r = await publica("/api/galerias/partidos");
  const p = r.data.partidos.find((x) => x.slug && /celta/i.test(x.slug));
  assert.ok(p, "el partido 2 sale en el listado");
  assert.equal(p.portada.url, urlUltima);
  assert.equal(p.fotos[0].url, urlUltima, "fotos[0] es la portada, para quien ya pintaba la primera foto");
  assert.equal(new Set(p.fotos.map((f) => f.url)).size, p.fotos.length, "sin duplicados");
  assert.ok(p.fotos.length <= 4);
});

test("listado público sin portada elegida: 'portada' es la primera foto", async () => {
  const r = await publica("/api/galerias/partidos");
  const p = r.data.partidos.find((x) => x.slug && /^a-b|-a-b|^a-/.test(x.slug)) || r.data.partidos.find((x) => x.equipo_local === "A");
  assert.ok(p);
  assert.equal(p.portada.url, p.fotos[0].url);
});

test("al cambiar una foto de partido desde la edición de media, deja de ser portada del anterior", async () => {
  const portada2 = portadas(2)[0];
  const antes = sqlite.prepare("SELECT titulo FROM media WHERE id = ?").get(portada2);
  const r = await api(e.admin, "PUT", `/api/media/${portada2}`, { titulo: antes.titulo, resultId: "1" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sqlite.prepare("SELECT result_id, es_portada FROM match_gallery WHERE media_id = ?").get(portada2).es_portada, 0);
  assert.deepEqual(portadas(2), []);
});

test("sin la columna es_portada (migración pendiente) todo sigue funcionando como antes", async () => {
  sqlite.exec("ALTER TABLE match_gallery DROP COLUMN es_portada");
  const s = await subir(e.foto, { resultId: "1", esPortada: "1" });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.galeriaVinculada, true);
  const admin = await api(e.foto, "GET", "/api/results/1/galeria");
  assert.equal(admin.status, 200);
  assert.equal(admin.data.tienePortada, false);
  const slug = admin.data.slug;
  const pub = await publica(`/api/results/galeria/${slug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.portada.elegida, false);
  const lista = await publica("/api/galerias/partidos");
  assert.equal(lista.status, 200);
  assert.ok(lista.data.partidos.every((p) => p.portada && p.portada.url));
  const patch = await api(e.foto, "PATCH", `/api/match-gallery/${enlaceDe(s.data.mediaId)}`, { portada: true });
  assert.equal(patch.status, 409);
  assert.match(patch.data.error, /migracion_galeria_portada/);
  const del = await api(e.admin, "DELETE", `/api/match-gallery/${enlaceDe(s.data.mediaId)}`);
  assert.equal(del.status, 200, "sin la columna se deja quitar la foto como siempre");
});
