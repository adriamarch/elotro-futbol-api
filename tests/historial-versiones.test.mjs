// Historial de versiones de noticias, de extremo a extremo: Worker real + SQLite real
// con el esquema completo (schema.sql).
//   node --no-warnings --test tests/historial-versiones.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/historial-versiones.test.mjs
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
const revisorId = usuario("revisor", "Revisora Marta", "admin", 4);
const anaId = usuario("ana", "Ana Pérez", "redactor", 1);
const luisId = usuario("luis", "Luis Gómez", "redactor", 1);
const hAdmin = await cab(adminId, "admin", "Admin");
const hRevisor = await cab(revisorId, "admin", "Revisora Marta");
const hAna = await cab(anaId, "redactor", "Ana Pérez");
const hLuis = await cab(luisId, "redactor", "Luis Gómez");

const frase = (t) => "<p>" + (t + " ").repeat(40) + "</p>";
const PORTADA = "https://res.cloudinary.com/demo/image/upload/portada.jpg";
const base = (contenido, extra = {}) => ({ titulo: "Titular de prueba", contenido, imagen_url: PORTADA, tipo: "noticia", categoria: "general", ...extra });
const put = (id, headers, cuerpo) => pedir(`/api/articles/${id}`, { method: "PUT", headers, body: JSON.stringify(cuerpo) });
const versiones = (id) => sqlite.prepare("SELECT * FROM article_versions WHERE article_id = ? ORDER BY id").all(id);

let idNoticia;
test("POST crea la versión 1 (creación) con quién la guardó", async () => {
  const r = await pedir("/api/articles", { method: "POST", headers: hAna, body: JSON.stringify(base(frase("El equipo salió con intensidad y cuajó una gran primera parte."), { publicado: false })) });
  assert.ok(r.status === 200 || r.status === 201, `POST -> ${r.status}: ${await r.clone().text()}`);
  const slug = (await r.json()).slug;
  idNoticia = sqlite.prepare("SELECT id FROM articles WHERE slug = ?").get(slug).id;
  const v = versiones(idNoticia);
  assert.equal(v.length, 1);
  assert.equal(v[0].numero, 1);
  assert.equal(v[0].motivo, "creacion");
  assert.equal(v[0].editor_nombre, "Ana Pérez");
  assert.equal(v[0].editor_id, anaId);
  assert.match(v[0].contenido, /intensidad/);
});

test("PUT de otra persona crea una versión nueva y la anterior se conserva intacta", async () => {
  const r = await put(idNoticia, hRevisor, base(frase("Texto pisado por otro redactor, sin nada de lo anterior."), { publicado: false }));
  assert.equal(r.status, 200, await r.clone().text());
  const v = versiones(idNoticia);
  assert.equal(v.length, 2);
  assert.equal(v[1].numero, 2);
  assert.equal(v[1].editor_nombre, "Revisora Marta");
  assert.match(v[1].contenido, /pisado/);
  assert.match(v[0].contenido, /intensidad/, "la versión 1 no se toca");
});

test("Guardar dos veces lo mismo no crea versiones repetidas", async () => {
  const cuerpo = base(frase("Texto pisado por otro redactor, sin nada de lo anterior."), { publicado: false });
  const r = await put(idNoticia, hRevisor, cuerpo);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(versiones(idNoticia).length, 2);
});

test("Noticia anterior al historial: el primer guardado conserva antes su estado previo (sin autor)", async () => {
  const viejoTexto = frase("Texto original anterior al historial de versiones.");
  const id = Number(sqlite.prepare(
    "INSERT INTO articles (slug, titulo, contenido, tipo, categoria, imagen_url, autor_id, autor_nombre, publicado, fecha_publicacion, updated_at) VALUES ('vieja','Titular viejo',?,'noticia','general',?,?,'Ana Pérez',1,'2026-01-05 10:00:00','2026-01-05 10:00:00')"
  ).run(viejoTexto, PORTADA, anaId).lastInsertRowid);
  assert.equal(versiones(id).length, 0);
  const r = await put(id, hAdmin, base(frase("Texto corregido por el admin con una errata arreglada."), { titulo: "Titular nuevo" }));
  assert.equal(r.status, 200, await r.clone().text());
  const v = versiones(id);
  assert.equal(v.length, 2);
  assert.equal(v[0].motivo, "inicial");
  assert.equal(v[0].editor_nombre, "");
  assert.equal(v[0].titulo, "Titular viejo");
  assert.equal(v[0].created_at, "2026-01-05 10:00:00", "conserva la fecha del último guardado anterior");
  assert.match(v[0].contenido, /original anterior/);
  assert.equal(v[1].motivo, "edicion");
  assert.equal(v[1].editor_nombre, "Admin");
});

test("GET lista (sin texto) y GET de una versión (con texto y datos)", async () => {
  const r = await pedir(`/api/articles/${idNoticia}/versiones`, { headers: hAna });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.versiones.length, 2);
  assert.deepEqual(j.versiones.map((x) => x.numero), [2, 1], "la más reciente primero");
  assert.equal(j.versiones[0].contenido, undefined, "la lista no trae el texto");
  assert.ok(j.versiones[0].longitud > 100);
  const uno = await (await pedir(`/api/articles/${idNoticia}/versiones/${j.versiones[1].id}`, { headers: hAna })).json();
  assert.match(uno.version.contenido, /intensidad/);
  assert.equal(uno.version.datos.tipo, "noticia");
  assert.equal(uno.version.datos.imagen_url, PORTADA);
});

test("Permisos: sin sesión 401; redactor ajeno 403; autor y admin 200; versión de otra noticia 404", async () => {
  assert.equal((await pedir(`/api/articles/${idNoticia}/versiones`)).status, 401);
  assert.equal((await pedir(`/api/articles/${idNoticia}/versiones`, { headers: hLuis })).status, 403);
  assert.equal((await pedir(`/api/articles/${idNoticia}/versiones`, { headers: hAna })).status, 200);
  assert.equal((await pedir(`/api/articles/${idNoticia}/versiones`, { headers: hAdmin })).status, 200);
  assert.equal((await pedir(`/api/articles/999999/versiones`, { headers: hAdmin })).status, 404);
  const ajena = sqlite.prepare("SELECT id FROM article_versions WHERE article_id <> ? LIMIT 1").get(idNoticia).id;
  assert.equal((await pedir(`/api/articles/${idNoticia}/versiones/${ajena}`, { headers: hAdmin })).status, 404);
});

test("Poda: solo se conservan las últimas 60 versiones de cada noticia", async () => {
  for (let i = 0; i < 64; i++) {
    const r = await put(idNoticia, hAdmin, base(frase(`Edición número ${i} del texto de prueba.`), { publicado: false }));
    assert.equal(r.status, 200, await r.clone().text());
  }
  const v = versiones(idNoticia);
  assert.equal(v.length, 60);
  assert.match(v[v.length - 1].contenido, /número 63/, "la última guardada sigue ahí");
  assert.ok(v[0].numero > 1, "las más antiguas se han podado");
  const otra = sqlite.prepare("SELECT COUNT(*) c FROM article_versions WHERE article_id <> ?").get(idNoticia).c;
  assert.ok(otra >= 2, "la poda no toca otras noticias");
});

test("Sin la tabla (migración sin aplicar) guardar sigue funcionando y la lista avisa", async () => {
  sqlite.exec("DROP TABLE article_versions");
  const r = await put(idNoticia, hAdmin, base(frase("Guardado sin tabla de versiones, no debe fallar."), { publicado: false }));
  assert.equal(r.status, 200, await r.clone().text());
  const l = await pedir(`/api/articles/${idNoticia}/versiones`, { headers: hAdmin });
  assert.equal(l.status, 200);
  const j = await l.json();
  assert.deepEqual(j.versiones, []);
  assert.equal(j.sin_tabla, true);
});
