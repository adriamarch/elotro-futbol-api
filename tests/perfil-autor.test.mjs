// Perfil ampliado de redactores y fotógrafos: cargo, ciudad, redes nuevas, noticia destacada
// y estadísticas / "más leídas" en la página pública de autor.
//   node --no-warnings --test tests/perfil-autor.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/perfil-autor.test.mjs
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
  activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT, bio TEXT, experiencia TEXT, avatar_url TEXT,
  avatar_foco TEXT, equipo TEXT, redes_sociales TEXT, cargo TEXT, ciudad TEXT, articulo_destacado_id INTEGER);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, titulo TEXT, subtitulo TEXT, contenido TEXT DEFAULT '', tipo TEXT DEFAULT 'noticia',
  resultado_id INTEGER, categoria TEXT DEFAULT 'hypermotion', club TEXT, imagen_url TEXT, imagenes TEXT, autor_id INTEGER, autor_nombre TEXT,
  coautor_id INTEGER, coautor_nombre TEXT, fecha_publicacion TEXT, publicado INTEGER NOT NULL DEFAULT 1);
CREATE TABLE article_views (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER);
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
let pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };
const esperarSegundoPlano = async () => { await Promise.all(pendientes); pendientes = []; };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  // Mismo formato de firma que signHS256 del worker (igual que tienda-cancelar.test.mjs).
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}


async function api(ruta, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request("https://api.test" + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const texto = await res.text();
  let data = {};
  try { data = JSON.parse(texto); } catch { data = { texto }; }
  await esperarSegundoPlano();
  return { status: res.status, data };
}

const jwtRedactor = (uid, nombre, rol = "redactor") => jwt({ uid, username: "u" + uid, nombre, rol, tfa: true });
const usuario = (nombre, rol = "redactor") => Number(sqlite.prepare("INSERT INTO users (username, nombre, rol) VALUES (?,?,?)").run("u" + Math.random(), nombre, rol).lastInsertRowid);
const noticia = (autor, titulo, { categoria = "hypermotion", tipo = "noticia", fecha = "2026-10-01 10:00:00", publicado = 1 } = {}) =>
  Number(sqlite.prepare("INSERT INTO articles (slug, titulo, tipo, categoria, autor_id, fecha_publicacion, publicado) VALUES (?,?,?,?,?,?,?)")
    .run("s-" + Math.random().toString(36).slice(2), titulo, tipo, categoria, autor, fecha, publicado).lastInsertRowid);
const vistas = (art, n) => { for (let i = 0; i < n; i++) sqlite.prepare("INSERT INTO article_views (article_id) VALUES (?)").run(art); };
const perfilBase = (extra = {}) => ({ nombre: "Marta Ferrer", email: "marta@x.es", bio: "Bio", experiencia: "", avatar_url: "", redes: {}, ...extra });

const marta = usuario("Marta Ferrer");
const otra = usuario("Lucía Prats");
const tMarta = await jwtRedactor(marta, "Marta Ferrer");
const a1 = noticia(marta, "Primera de Marta", { fecha: "2026-09-01 10:00:00" });
const a2 = noticia(marta, "Segunda de Marta", { categoria: "arbitraje", tipo: "opinion", fecha: "2026-10-05 10:00:00" });
const a3 = noticia(marta, "Tercera de Marta", { fecha: "2026-11-01 10:00:00" });
const borrador = noticia(marta, "Borrador", { publicado: 0 });
const ajena = noticia(otra, "De otra persona");
vistas(a1, 5); vistas(a2, 12); vistas(a3, 1); vistas(ajena, 99);

test("guardar cargo, ciudad, redes nuevas y noticia destacada, y volver a leerlos", async () => {
  const r = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({
    cargo: "  Redactora de   Hypermotion ", ciudad: "Tarragona", articulo_destacado_id: a2,
    redes: { linkedin: "https://linkedin.com/in/marta", threads: "https://threads.net/@marta", facebook: "https://facebook.com/marta", web: "https://marta.es" },
  }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await api("/api/me/perfil", { token: tMarta });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.user.cargo, "Redactora de Hypermotion", "se normalizan los espacios");
  assert.equal(g.data.user.ciudad, "Tarragona");
  assert.equal(g.data.user.articulo_destacado_id, a2);
  assert.equal(g.data.user.redes.web, "https://marta.es/", "la URL se normaliza");
  assert.equal(g.data.user.redes.linkedin, "https://linkedin.com/in/marta");
  const ids = g.data.articulos_propios.map((a) => a.id);
  assert.deepEqual(ids.sort(), [a1, a2, a3].sort(), "solo sus noticias publicadas");
});

test("no se puede destacar una noticia ajena, un borrador ni un id inválido", async () => {
  for (const id of [ajena, borrador, 999999]) {
    const r = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ articulo_destacado_id: id }) });
    assert.equal(r.status, 400, "id " + id);
  }
  assert.equal((await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ articulo_destacado_id: "abc" }) })).status, 400);
  assert.equal(sqlite.prepare("SELECT articulo_destacado_id AS d FROM users WHERE id = ?").get(marta).d, a2, "la destacada anterior se conserva");
});

test("las redes nuevas exigen https y el cargo se recorta a 80 caracteres", async () => {
  const mala = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ redes: { web: "javascript:alert(1)" } }) });
  assert.equal(mala.status, 400);
  const larga = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ cargo: "x".repeat(200) }) });
  assert.equal(larga.status, 200);
  assert.equal(sqlite.prepare("SELECT cargo FROM users WHERE id = ?").get(marta).cargo.length, 80);
});

test("un panel antiguo que no envía los campos nuevos no los borra", async () => {
  await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ cargo: "Redactora", ciudad: "Reus", articulo_destacado_id: a1 }) });
  const r = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ bio: "Otra bio" }) });
  assert.equal(r.status, 200);
  const f = sqlite.prepare("SELECT cargo, ciudad, articulo_destacado_id AS d, bio FROM users WHERE id = ?").get(marta);
  assert.deepEqual({ ...f }, { cargo: "Redactora", ciudad: "Reus", d: a1, bio: "Otra bio" });
  // y enviar vacío sí los quita
  await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ cargo: "", ciudad: "", articulo_destacado_id: null }) });
  const v = sqlite.prepare("SELECT cargo, ciudad, articulo_destacado_id AS d FROM users WHERE id = ?").get(marta);
  assert.deepEqual({ ...v }, { cargo: null, ciudad: null, d: null });
});

test("perfil público: cargo, ciudad, estadísticas de todo lo publicado, destacada y más leídas", async () => {
  await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ cargo: "Redactora", ciudad: "Tarragona", articulo_destacado_id: a3 }) });
  const r = await api(`/api/autores/${marta}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.autor.cargo, "Redactora");
  assert.equal(r.data.autor.ciudad, "Tarragona");
  const e = r.data.estadisticas;
  assert.equal(e.articulos_total, 3, "el borrador y lo ajeno no cuentan");
  assert.equal(e.lecturas_total, 18, "5 + 12 + 1, sin las 99 de la ajena");
  assert.equal(e.primera_publicacion, "2026-09-01 10:00:00");
  assert.equal(e.ultima_publicacion, "2026-11-01 10:00:00");
  assert.deepEqual(e.por_categoria.map((c) => [c.categoria, c.n]), [["hypermotion", 2], ["arbitraje", 1]]);
  assert.deepEqual(e.por_tipo.map((t) => [t.tipo, t.n]), [["noticia", 2], ["opinion", 1]]);
  assert.equal(r.data.destacado.id, a3);
  assert.deepEqual(r.data.mas_leidas.map((a) => [a.id, a.lecturas]), [[a2, 12], [a1, 5], [a3, 1]]);
});

test("sin migrar las columnas nuevas, guardar y ver el perfil sigue funcionando", async () => {
  for (const c of ["cargo", "ciudad", "articulo_destacado_id"]) sqlite.exec(`ALTER TABLE users DROP COLUMN ${c}`);
  const r = await api("/api/me/perfil", { method: "PUT", token: tMarta, body: perfilBase({ bio: "Sin migrar", cargo: "X", ciudad: "Y" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await api("/api/me/perfil", { token: tMarta });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.user.bio, "Sin migrar");
  assert.equal(g.data.user.cargo, "");
  const p = await api(`/api/autores/${marta}`);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.estadisticas.articulos_total, 3, "las estadísticas no dependen de las columnas nuevas");
  assert.equal(p.data.destacado, null);
});

test("editar el perfil NO tira la sesión de un Responsable (el token nuevo conserva el segundo factor)", async () => {
  const admin = usuario("Ana Responsable", "admin");
  const token = await jwtRedactor(admin, "Ana Responsable", "admin"); // lleva tfa: true, como tras el login con 2FA
  const r = await api("/api/me/perfil", { method: "PUT", token, body: { nombre: "Ana Responsable", bio: "Hola" } });
  assert.equal(r.status, 200);
  assert.ok(r.data.token, "devuelve un token nuevo");
  // Con el token nuevo se sigue pudiendo usar la API: antes daba 401 (sin tfa) y el panel mandaba a iniciar sesión.
  const g = await api("/api/me/perfil", { token: r.data.token });
  assert.equal(g.status, 200);
  // Y se puede guardar otra vez seguida, que es lo que se hace al retocar el perfil varias veces.
  const r2 = await api("/api/me/perfil", { method: "PUT", token: r.data.token, body: { nombre: "Ana Responsable", bio: "Hola de nuevo" } });
  assert.equal(r2.status, 200);
});
