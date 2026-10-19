// Comentarios con respuestas (hilos de un nivel) y avisos por correo a lectores.
//   node --no-warnings --test tests/comentarios-respuestas.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/comentarios-respuestas.test.mjs
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
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT, rol TEXT DEFAULT 'admin',
  activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT, puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT, slug TEXT, categoria TEXT, tipo TEXT, resultado_id INTEGER, publicado INTEGER NOT NULL DEFAULT 1);
CREATE TABLE readers (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  email_verificado INTEGER NOT NULL DEFAULT 1, activo INTEGER NOT NULL DEFAULT 1, avisos_comentarios INTEGER NOT NULL DEFAULT 1, avatar_url TEXT);
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL, email TEXT NOT NULL, texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  moderado_por_id INTEGER, moderado_at TEXT,
  likes INTEGER NOT NULL DEFAULT 0, dislikes INTEGER NOT NULL DEFAULT 0,
  denuncias INTEGER NOT NULL DEFAULT 0, oculto_por_denuncia INTEGER NOT NULL DEFAULT 0,
  reader_id INTEGER REFERENCES readers(id),
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  responde_a_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  aviso_aprobado INTEGER NOT NULL DEFAULT 0,
  respuesta_avisada INTEGER NOT NULL DEFAULT 0
);
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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1", RESEND_API_KEY: "re_test" };
let pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };
const esperarSegundoPlano = async () => { await Promise.all(pendientes); pendientes = []; };

// Correos enviados (se intercepta la llamada a Resend).
let correos = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    correos.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  }
  return fetchReal(url, init);
};
test.after(() => { globalThis.fetch = fetchReal; });

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  // Mismo formato de firma que signHS256 del worker (igual que tienda-cancelar.test.mjs).
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}

const admin = sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, email) VALUES ('admin','Admin','admin',4,'admin@x.es')").run().lastInsertRowid;
const tokenAdmin = await jwt({ uid: Number(admin), rol: "admin", nombre: "Admin", tfa: true });
const lector = (nombre, email, extra = {}) => {
  const id = Number(sqlite.prepare("INSERT INTO readers (nombre, email, email_verificado, activo, avisos_comentarios) VALUES (?,?,?,?,?)")
    .run(nombre, email, extra.verificado ?? 1, extra.activo ?? 1, extra.avisos ?? 1).lastInsertRowid);
  return id;
};
const tokenLector = (rid, nombre) => jwt({ rid, nombre, email: "x@x.es" });
const articulo = (slug) => Number(sqlite.prepare("INSERT INTO articles (titulo, slug, categoria, tipo) VALUES (?,?,?,?)").run("Titular " + slug, slug, "hypermotion", "noticia").lastInsertRowid);

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
const comentar = (art, token, texto, parent_id) =>
  api(`/api/articles/${art}/comments`, { method: "POST", token, body: { texto, ...(parent_id ? { parent_id } : {}) } });
const moderar = (id, estado) => api(`/api/admin/comments/${id}`, { method: "PUT", token: tokenAdmin, body: { estado } });
const ultimoComentario = () => Number(sqlite.prepare("SELECT MAX(id) AS id FROM comments").get().id);
const fila = (id) => sqlite.prepare("SELECT * FROM comments WHERE id = ?").get(id);
const publicos = async (art) => (await api(`/api/articles/${art}/comments`)).data.comentarios;

test("aprobar el comentario de una lectora le manda un correo (y solo uno)", async () => {
  correos = [];
  const art = articulo("a1");
  const ana = lector("Ana", "ana@correo.es");
  const r = await comentar(art, await tokenLector(ana, "Ana"), "Gran crónica");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = ultimoComentario();
  assert.equal(correos.length, 0, "al enviarlo todavía no se avisa");

  assert.equal((await moderar(id, "aprobado")).status, 200);
  assert.equal(correos.length, 1);
  assert.deepEqual(correos[0].to, ["ana@correo.es"]);
  assert.match(correos[0].subject, /ya está publicado/);
  assert.match(correos[0].html, /#comentario-\d+/);
  assert.match(correos[0].html, /baja-avisos\?token=/);

  await moderar(id, "pendiente");
  await moderar(id, "aprobado");
  assert.equal(correos.length, 1, "aprobar otra vez no duplica el aviso");
});

test("respuestas: se moderan, cuelgan del comentario y avisan a quien contestan", async () => {
  correos = [];
  const art = articulo("a2");
  const ana = lector("Ana2", "ana2@correo.es");
  const luis = lector("Luis2", "luis2@correo.es");
  await comentar(art, await tokenLector(ana, "Ana2"), "Yo creo que ganará el Depor");
  const raiz = ultimoComentario();
  await moderar(raiz, "aprobado");
  correos = [];

  const r = await comentar(art, await tokenLector(luis, "Luis2"), "No sé, lo veo difícil", raiz);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.mensaje, /Respuesta enviada/);
  const resp = ultimoComentario();
  assert.equal(fila(resp).parent_id, raiz);
  assert.equal(fila(resp).responde_a_id, raiz);
  assert.equal((await publicos(art)).length, 1, "la respuesta pendiente no se ve");
  assert.equal(correos.length, 0);

  await moderar(resp, "aprobado");
  const para = (c) => c.to[0];
  assert.equal(correos.length, 2);
  const aAna = correos.find((c) => para(c) === "ana2@correo.es");
  const aLuis = correos.find((c) => para(c) === "luis2@correo.es");
  assert.match(aAna.subject, /Luis2 ha respondido a tu comentario/);
  assert.match(aLuis.subject, /ya está publicado/);

  const lista = await publicos(art);
  assert.equal(lista.length, 2);
  const visible = lista.find((c) => c.id === resp);
  assert.equal(visible.parent_id, raiz);
  assert.equal(visible.responde_a_nombre, "Ana2");
});

test("responder a una respuesta cuelga de la raíz y avisa a esa autora", async () => {
  correos = [];
  const art = articulo("a3");
  const a = lector("A3", "a3@correo.es"), b = lector("B3", "b3@correo.es"), c = lector("C3", "c3@correo.es");
  await comentar(art, await tokenLector(a, "A3"), "raíz");
  const raiz = ultimoComentario(); await moderar(raiz, "aprobado");
  await comentar(art, await tokenLector(b, "B3"), "respuesta de B", raiz);
  const rb = ultimoComentario(); await moderar(rb, "aprobado");
  correos = [];

  await comentar(art, await tokenLector(c, "C3"), "respuesta a B", rb);
  const rc = ultimoComentario();
  assert.equal(fila(rc).parent_id, raiz, "el hilo sigue colgando de la raíz");
  assert.equal(fila(rc).responde_a_id, rb);
  await moderar(rc, "aprobado");
  const destinos = correos.map((x) => x.to[0]).sort();
  assert.deepEqual(destinos, ["b3@correo.es", "c3@correo.es"], "avisa a B (contestada), no a A (raíz)");
});

test("no se puede responder a un comentario no visible, de otra noticia o inválido", async () => {
  const art = articulo("a4"), otra = articulo("a4b");
  const ana = lector("Ana4", "ana4@correo.es");
  const t = await tokenLector(ana, "Ana4");
  await comentar(art, t, "pendiente aún");
  const pend = ultimoComentario();
  assert.equal((await comentar(art, t, "hola", pend)).status, 404);

  await moderar(pend, "aprobado");
  assert.equal((await comentar(otra, t, "hola", pend)).status, 404, "otra noticia");
  assert.equal((await comentar(art, t, "hola", "abc")).status, 400);
  assert.equal((await comentar(art, t, "hola", 999999)).status, 404);
  assert.equal((await comentar(art, t, "hola", pend)).status, 200);
});

test("a quien no hay que avisar no se le avisa", async () => {
  correos = [];
  const art = articulo("a5");
  const baja = lector("Baja", "baja@correo.es", { avisos: 0 });
  const sinVerificar = lector("SinVer", "sv@correo.es", { verificado: 0 });
  const deX = lector("DeX", "x-123@x.elotrofutbol.media");
  const ok = lector("Ok", "ok@correo.es");

  // anónimo (sin cuenta): nunca se le avisa, aunque deje un email válido
  await api(`/api/articles/${art}/comments`, { method: "POST", body: { nombre: "Anon", email: "anon@correo.es", texto: "hola" } });
  const anon = ultimoComentario(); await moderar(anon, "aprobado");

  for (const [id, nombre] of [[baja, "Baja"], [sinVerificar, "SinVer"], [deX, "DeX"]]) {
    await comentar(art, await tokenLector(id, nombre), "mi comentario");
    await moderar(ultimoComentario(), "aprobado");
  }
  assert.equal(correos.length, 0);

  // responder a la de baja / al anónimo tampoco avisa a esas personas
  await comentar(art, await tokenLector(ok, "Ok"), "respuesta al anónimo", anon);
  await moderar(ultimoComentario(), "aprobado");
  assert.deepEqual(correos.map((c) => c.to[0]), ["ok@correo.es"], "solo el 'publicado' de quien responde");
});

test("responderse a uno mismo no manda el aviso de respuesta", async () => {
  correos = [];
  const art = articulo("a6");
  const ana = lector("Ana6", "ana6@correo.es");
  const t = await tokenLector(ana, "Ana6");
  await comentar(art, t, "primero"); const raiz = ultimoComentario(); await moderar(raiz, "aprobado");
  correos = [];
  await comentar(art, t, "y añado", raiz); await moderar(ultimoComentario(), "aprobado");
  assert.equal(correos.length, 1);
  assert.match(correos[0].subject, /ya está publicado/);
});

test("rechazar el comentario raíz esconde el hilo; borrarlo borra las respuestas", async () => {
  const art = articulo("a7");
  const a = lector("A7", "a7@correo.es");
  const t = await tokenLector(a, "A7");
  await comentar(art, t, "raíz"); const raiz = ultimoComentario(); await moderar(raiz, "aprobado");
  await comentar(art, t, "respuesta", raiz); const resp = ultimoComentario(); await moderar(resp, "aprobado");
  assert.equal((await publicos(art)).length, 2);

  await moderar(raiz, "rechazado");
  assert.equal((await publicos(art)).length, 0, "sin raíz visible no se ve la respuesta");

  await moderar(raiz, "aprobado");
  const del = await api(`/api/admin/comments/${raiz}`, { method: "DELETE", token: tokenAdmin });
  assert.equal(del.status, 200);
  assert.equal(fila(resp), undefined, "la respuesta se borra en cascada");
});

test("el panel de admin ve a quién responde cada comentario", async () => {
  const art = articulo("a8");
  const a = lector("A8", "a8@correo.es");
  const t = await tokenLector(a, "A8");
  await comentar(art, t, "raíz"); const raiz = ultimoComentario(); await moderar(raiz, "aprobado");
  await comentar(art, t, "respuesta", raiz);
  const { data } = await api("/api/admin/comments?estado=pendiente", { token: tokenAdmin });
  const r = data.comentarios.find((c) => c.texto === "respuesta");
  assert.equal(r.responde_a_nombre, "A8");
});

test("baja de los avisos: desde el enlace del correo y desde Mi cuenta", async () => {
  correos = [];
  const art = articulo("a9");
  const a = lector("A9", "a9@correo.es");
  await comentar(art, await tokenLector(a, "A9"), "hola"); await moderar(ultimoComentario(), "aprobado");
  const enlace = /https:\/\/api\.elotrofutbol\.media(\/api\/comentarios\/baja-avisos\?token=[^"\s<]+)/.exec(correos[0].text)[1];

  assert.equal((await api("/api/comentarios/baja-avisos?token=basura")).status, 400);
  const baja = await api(enlace);
  assert.equal(baja.status, 200);
  assert.equal(sqlite.prepare("SELECT avisos_comentarios FROM readers WHERE id = ?").get(a).avisos_comentarios, 0);

  const t = await tokenLector(a, "A9");
  assert.equal((await api("/api/readers/me/avisos-comentarios", { method: "PUT", token: t, body: { activo: true } })).status, 200);
  assert.equal(sqlite.prepare("SELECT avisos_comentarios FROM readers WHERE id = ?").get(a).avisos_comentarios, 1);
  assert.equal((await api("/api/readers/me/avisos-comentarios", { method: "PUT", token: t, body: { activo: "si" } })).status, 400);
  assert.equal((await api("/api/readers/me/avisos-comentarios", { method: "PUT", body: { activo: false } })).status, 401);

  const perfil = await api("/api/readers/me/perfil", { token: t });
  assert.equal(perfil.data.reader.avisos_comentarios, true);
});
