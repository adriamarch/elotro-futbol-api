// Bloqueo de edición simultánea de noticias, de extremo a extremo: Worker real + SQLite real
// con el esquema completo (schema.sql).
//   node --no-warnings --test tests/bloqueo-edicion-noticias.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/bloqueo-edicion-noticias.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.exec(readFileSync(join(aqui, "../schema.sql"), "utf8"));

const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...limpiar(args)) ?? null,
      all: async () => ({ results: st.all(...limpiar(args)) }),
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      _sql: sql, _args: args,
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
const pedir = (ruta, init) => worker.fetch(new Request(`https://api.elotrofutbol.media${ruta}`, init), env, ctx);

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const usuario = (username, nombre, rol, nivel) =>
  Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email) VALUES (?,'x','x',?,?,?,?)")
    .run(username, nombre, rol, nivel, username + "@x.es").lastInsertRowid);
const cab = async (uid, rol, nombre) => ({ Authorization: `Bearer ${await jwt({ uid, rol, nombre, tfa: true })}`, "Content-Type": "application/json" });

const adminId = usuario("admin", "Admin", "admin", 4);
const anaId = usuario("ana", "Ana Pérez", "redactor", 1);
const luisId = usuario("luis", "Luis Gómez", "redactor", 1);
const hAdmin = await cab(adminId, "admin", "Admin");
const hAna = await cab(anaId, "redactor", "Ana Pérez");
const hLuis = await cab(luisId, "redactor", "Luis Gómez");

const frase = (t) => "<p>" + (t + " ").repeat(40) + "</p>";
const PORTADA = "https://res.cloudinary.com/demo/image/upload/portada.jpg";
const base = (contenido, extra = {}) => ({ titulo: "Titular de prueba", contenido, imagen_url: PORTADA, tipo: "noticia", categoria: "general", publicado: false, ...extra });
const put = (id, headers, cuerpo) => pedir(`/api/articles/${id}`, { method: "PUT", headers, body: JSON.stringify(cuerpo) });
const bloqueo = (id, headers, metodo, sesion, extra = "") =>
  pedir(`/api/articles/${id}/bloqueo?sesion=${sesion}${extra}`, { method: metodo, headers });

const idNoticia = Number(sqlite.prepare(
  "INSERT INTO articles (slug, titulo, contenido, tipo, categoria, imagen_url, autor_id, autor_nombre, publicado, fecha_publicacion, updated_at) VALUES ('n1','Titular',?,'noticia','general',?,?,'Ana Pérez',0,'2026-01-05 10:00:00','2026-01-05 10:00:00')"
).run(frase("Texto inicial de la noticia."), PORTADA, anaId).lastInsertRowid);

const S_ANA = "sesion-ana-pestana-1";
const S_ANA2 = "sesion-ana-pestana-2";
const S_ADMIN = "sesion-admin-0001";

test("sin bloqueo: se puede guardar con o sin sesión de edición (clientes antiguos)", async () => {
  const r = await put(idNoticia, hAna, base(frase("Primer guardado sin bloqueo."), { sesion_edicion: S_ANA }));
  assert.equal(r.status, 200, await r.clone().text());
  const r2 = await put(idNoticia, hAna, base(frase("Segundo guardado, cliente antiguo.")));
  assert.equal(r2.status, 200, await r2.clone().text());
});

test("POST reserva el bloqueo y lo devuelve como mío", async () => {
  const r = await bloqueo(idNoticia, hAna, "POST", S_ANA);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.bloqueo.es_mio, true);
  assert.equal(d.bloqueo.usuario_id, anaId);
  assert.equal(d.bloqueo.usuario_nombre, "Ana Pérez");
});

test("renovar (latido) con la misma sesión funciona y conserva 'desde'", async () => {
  const antes = sqlite.prepare("SELECT acquired_at FROM article_edit_locks WHERE article_id = ?").get(idNoticia).acquired_at;
  await new Promise((r) => setTimeout(r, 15));
  const r = await bloqueo(idNoticia, hAna, "POST", S_ANA);
  assert.equal(r.status, 200);
  const fila = sqlite.prepare("SELECT acquired_at, heartbeat_at FROM article_edit_locks WHERE article_id = ?").get(idNoticia);
  assert.equal(fila.acquired_at, antes);
  assert.ok(fila.heartbeat_at > antes);
});

test("otra persona recibe 423 con el nombre de quien edita, y no pisa el bloqueo", async () => {
  const r = await bloqueo(idNoticia, hAdmin, "POST", S_ADMIN);
  assert.equal(r.status, 423);
  const d = await r.json();
  assert.match(d.error, /Ana Pérez/);
  assert.equal(d.bloqueo.es_mio, false);
  assert.equal(sqlite.prepare("SELECT session_id FROM article_edit_locks WHERE article_id = ?").get(idNoticia).session_id, S_ANA);
});

test("la misma persona en OTRA pestaña también es edición simultánea (423)", async () => {
  const r = await bloqueo(idNoticia, hAna, "POST", S_ANA2);
  assert.equal(r.status, 423);
});

test("GET informa de quién la tiene sin reservar nada", async () => {
  const r = await bloqueo(idNoticia, hAdmin, "GET", S_ADMIN);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.bloqueo.usuario_nombre, "Ana Pérez");
  assert.equal(d.bloqueo.es_mio, false);
});

test("PUT de otra sesión se rechaza con 423 y no modifica la noticia", async () => {
  const r = await put(idNoticia, hAdmin, base(frase("Texto del admin que NO debe guardarse."), { sesion_edicion: S_ADMIN }));
  assert.equal(r.status, 423, await r.clone().text());
  assert.match((await r.json()).error, /Ana Pérez/);
  assert.doesNotMatch(sqlite.prepare("SELECT contenido FROM articles WHERE id = ?").get(idNoticia).contenido, /NO debe guardarse/);
});

test("PUT de la otra pestaña de la misma persona, y PUT de otra persona sin sesión, también 423", async () => {
  const r = await put(idNoticia, hAna, base(frase("Desde la otra pestaña."), { sesion_edicion: S_ANA2 }));
  assert.equal(r.status, 423);
  const r2 = await put(idNoticia, hAdmin, base(frase("Cliente antiguo de otra persona.")));
  assert.equal(r2.status, 423);
});

test("PUT de quien tiene el bloqueo funciona", async () => {
  const r = await put(idNoticia, hAna, base(frase("Texto guardado por quien edita."), { sesion_edicion: S_ANA }));
  assert.equal(r.status, 200, await r.clone().text());
  assert.match(sqlite.prepare("SELECT contenido FROM articles WHERE id = ?").get(idNoticia).contenido, /quien edita/);
});

test("un redactor no puede forzar; DELETE ajeno no libera", async () => {
  const luis = await bloqueo(idNoticia, hLuis, "POST", "sesion-luis-0001", "&forzar=1");
  assert.ok(luis.status === 403 || luis.status === 423, `status ${luis.status}`);
  await bloqueo(idNoticia, hAdmin, "DELETE", S_ADMIN);
  assert.equal(sqlite.prepare("SELECT session_id FROM article_edit_locks WHERE article_id = ?").get(idNoticia).session_id, S_ANA);
});

test("un Responsable puede tomar el control y queda registrado", async () => {
  const r = await bloqueo(idNoticia, hAdmin, "POST", S_ADMIN, "&forzar=1");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).bloqueo.es_mio, true);
  assert.equal(sqlite.prepare("SELECT session_id FROM article_edit_locks WHERE article_id = ?").get(idNoticia).session_id, S_ADMIN);
  const log = sqlite.prepare("SELECT descripcion FROM activity_log WHERE accion = 'noticia_bloqueo_forzado'").get();
  assert.ok(log && /Ana Pérez/.test(log.descripcion));
  // y ahora Ana ya no puede guardar
  const g = await put(idNoticia, hAna, base(frase("Ana intenta guardar tras perder el control."), { sesion_edicion: S_ANA }));
  assert.equal(g.status, 423);
});

test("un bloqueo caducado no impide nada y se puede reservar", async () => {
  sqlite.prepare("UPDATE article_edit_locks SET expires_at = ? WHERE article_id = ?").run(new Date(Date.now() - 1000).toISOString(), idNoticia);
  const g = await put(idNoticia, hAna, base(frase("Guardado con el bloqueo caducado."), { sesion_edicion: S_ANA }));
  assert.equal(g.status, 200, await g.clone().text());
  const r = await bloqueo(idNoticia, hAna, "POST", S_ANA);
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare("SELECT session_id FROM article_edit_locks WHERE article_id = ?").get(idNoticia).session_id, S_ANA);
});

test("DELETE de quien lo tiene lo libera", async () => {
  const r = await bloqueo(idNoticia, hAna, "DELETE", S_ANA);
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM article_edit_locks WHERE article_id = ?").get(idNoticia).n, 0);
  const r2 = await bloqueo(idNoticia, hAdmin, "POST", S_ADMIN);
  assert.equal(r2.status, 200);
});

test("validaciones: sin sesión 400, noticia inexistente 404, sin login 401", async () => {
  assert.equal((await pedir(`/api/articles/${idNoticia}/bloqueo`, { method: "POST", headers: hAdmin })).status, 400);
  assert.equal((await bloqueo(99999, hAdmin, "POST", S_ADMIN)).status, 404);
  assert.equal((await pedir(`/api/articles/${idNoticia}/bloqueo?sesion=${S_ADMIN}`, { method: "POST" })).status, 401);
});
