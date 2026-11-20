// Papelera: borrado recuperable de noticias y archivos.
//   node --no-warnings --test tests/papelera.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/papelera.test.mjs
//
// Esquema real (schema.sql, que ya incluye la tabla papelera) sobre SQLite en memoria; Cloudinary simulado
// sustituyendo fetch para comprobar que el archivo original NO se destruye hasta vaciar la papelera.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...limpiar(args)) ?? null,
      all: async () => ({ results: st.all(...limpiar(args)) }),
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      __ejecutar: () => st.run(...limpiar(args)),
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
  // Como D1: el lote es atómico (todo o nada).
  async batch(sentencias) {
    sqlite.exec("BEGIN");
    try { for (const s of sentencias) s.__ejecutar(); sqlite.exec("COMMIT"); }
    catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    return [];
  },
};
const env = {
  DB, JWT_SECRET,
  CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s",
};
let pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

const destruidos = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("api.cloudinary.com") && u.endsWith("/destroy")) {
    destruidos.push(init.body.get("public_id"));
    return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const usuario = (username, nombre, rol) => Number(sqlite.prepare(
  "INSERT INTO users (username, password_hash, salt, nombre, rol, email) VALUES (?,?,?,?,?,?)"
).run(username, "x", "y", nombre, rol, username + "@x.es").lastInsertRowid);
const admin = usuario("boss", "Boss", "admin");
const autor = usuario("ana", "Ana", "redactor");
const otro = usuario("luis", "Luis", "redactor");
const tokens = {};
async function api(quien, ruta, { method = "GET", body } = {}) {
  const [uid, rol, nombre] = { admin: [admin, "admin", "Boss"], autor: [autor, "redactor", "Ana"], otro: [otro, "redactor", "Luis"] }[quien];
  tokens[quien] ||= await jwt({ uid, rol, nombre, tfa: true });
  const res = await worker.fetch(
    new Request("https://api.test" + ruta, {
      method,
      headers: { Authorization: "Bearer " + tokens[quien], ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env, ctx
  );
  const data = await res.json().catch(() => ({}));
  await Promise.all(pendientes); pendientes = [];
  return { status: res.status, data };
}
const uno = (sql, ...a) => sqlite.prepare(sql).get(...a);
const todos = (sql, ...a) => sqlite.prepare(sql).all(...a);

function crearNoticia(slug) {
  const id = Number(sqlite.prepare(
    "INSERT INTO articles (slug, titulo, contenido, autor_id, autor_nombre, publicado, destacado) VALUES (?, 'Titular de ' || ?, 'Cuerpo', ?, 'Ana', 1, 1)"
  ).run(slug, slug, autor).lastInsertRowid);
  sqlite.prepare("INSERT INTO comments (article_id, nombre, email, texto, estado) VALUES (?, 'Lector', 'l@x.es', 'Buen artículo', 'aprobado')").run(id);
  return id;
}
function crearMedia(publicId) {
  return Number(sqlite.prepare(
    `INSERT INTO media (cloudinary_public_id, cloudinary_resource_type, cloudinary_url, titulo, tipo, nombre_archivo, content_type, tamano_bytes, autor_id)
     VALUES (?, 'image', 'https://res.cloudinary.com/demo/image/upload/v1/' || ?, 'Foto del gol', 'foto', 'gol.jpg', 'image/jpeg', 1234, ?)`
  ).run(publicId, publicId, autor).lastInsertRowid);
}

test("borrar una noticia la deja en la papelera con sus comentarios y enlaces", async () => {
  const id = crearNoticia("derbi");
  const media = crearMedia("fotos/uno");
  sqlite.prepare("INSERT INTO article_media (article_id, media_id, orden) VALUES (?, ?, 0)").run(id, media);

  const r = await api("autor", `/api/articles/${id}`, { method: "DELETE" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(uno("SELECT COUNT(*) n FROM articles WHERE id = ?", id).n, 0);
  assert.equal(uno("SELECT COUNT(*) n FROM comments WHERE article_id = ?", id).n, 0, "el borrado sigue arrastrando los comentarios...");
  const fila = uno("SELECT * FROM papelera WHERE tipo = 'articulo' AND entidad_id = ?", id);
  assert.ok(fila, "...pero quedan guardados en la papelera");
  assert.equal(fila.eliminado_por_id, autor);
  assert.equal(JSON.parse(fila.relacionados).comments.length, 1);
  assert.equal(JSON.parse(fila.relacionados).article_media.length, 1);
  assert.ok(fila.purgar_despues > new Date().toISOString());
});

test("quién ve y quién puede restaurar", async () => {
  const lista = (quien) => api(quien, "/api/papelera");
  assert.equal((await lista("autor")).data.items.length, 1);
  assert.equal((await lista("otro")).data.items.length, 0, "otro redactor no ve lo ajeno");
  assert.equal((await lista("admin")).data.items.length, 1);
  assert.equal((await lista("admin")).data.items[0].datos, undefined, "la lista no manda el contenido entero");
  const idPap = (await lista("admin")).data.items[0].id;
  assert.equal((await api("otro", `/api/papelera/${idPap}/restaurar`, { method: "POST" })).status, 403);
  assert.equal((await api("autor", `/api/papelera/${idPap}`, { method: "DELETE" })).status, 403, "solo un admin borra definitivamente");
});

test("restaurar una noticia: vuelve como borrador con comentarios y fotos enlazadas", async () => {
  const idPap = todos("SELECT id FROM papelera")[0].id;
  const r = await api("autor", `/api/papelera/${idPap}/restaurar`, { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const a = uno("SELECT * FROM articles WHERE slug = 'derbi'");
  assert.ok(a, "la noticia ha vuelto");
  assert.equal(a.publicado, 0, "como borrador, nunca publicada");
  assert.equal(a.destacado, 0);
  assert.equal(uno("SELECT COUNT(*) n FROM comments WHERE article_id = ?", a.id).n, 1);
  assert.equal(uno("SELECT COUNT(*) n FROM article_media WHERE article_id = ?", a.id).n, 1);
  assert.equal(uno("SELECT COUNT(*) n FROM papelera").n, 0);
});

test("restaurar con el enlace ya ocupado: la noticia recibe otro slug", async () => {
  const a = uno("SELECT id FROM articles WHERE slug = 'derbi'");
  await api("autor", `/api/articles/${a.id}`, { method: "DELETE" });
  crearNoticia("derbi"); // alguien reutiliza el enlace mientras tanto
  const idPap = todos("SELECT id FROM papelera")[0].id;
  const r = await api("autor", `/api/papelera/${idPap}/restaurar`, { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slug, "derbi-restaurada");
  assert.ok(uno("SELECT id FROM articles WHERE slug = 'derbi-restaurada'"));
});

test("fallo cerrado: si no se puede guardar la copia, la noticia NO se borra", async () => {
  const id = crearNoticia("sin-papelera");
  sqlite.exec("ALTER TABLE papelera RENAME TO papelera_oculta");
  try {
    const r = await api("autor", `/api/articles/${id}`, { method: "DELETE" });
    // En el worker secundario el 500 del primario activa su failover, así que solo se exige que NO se borre.
    assert.notEqual(r.status, 200);
    assert.ok(uno("SELECT id FROM articles WHERE id = ?", id), "la noticia sigue ahí");
  } finally {
    sqlite.exec("ALTER TABLE papelera_oculta RENAME TO papelera");
  }
});

test("archivos: borrar NO destruye el original en Cloudinary; restaurar lo devuelve", async () => {
  const id = crearMedia("fotos/dos");
  const r = await api("autor", `/api/media/${id}`, { method: "DELETE" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(uno("SELECT COUNT(*) n FROM media WHERE id = ?", id).n, 0);
  assert.deepEqual(destruidos, [], "Cloudinary intacto mientras esté en la papelera");
  const fila = uno("SELECT * FROM papelera WHERE tipo = 'media' AND entidad_id = ?", id);
  assert.equal(fila.cloudinary_public_id, "fotos/dos");
  assert.equal(fila.cloud_name, "demo");

  const rr = await api("autor", `/api/papelera/${fila.id}/restaurar`, { method: "POST" });
  assert.equal(rr.status, 200, JSON.stringify(rr.data));
  assert.equal(uno("SELECT titulo FROM media WHERE id = ?", id).titulo, "Foto del gol");
  assert.deepEqual(destruidos, []);
});

test("borrado definitivo (admin): solo entonces se destruye en Cloudinary", async () => {
  const id = crearMedia("fotos/tres");
  await api("autor", `/api/media/${id}`, { method: "DELETE" });
  const fila = uno("SELECT id FROM papelera WHERE tipo = 'media' AND entidad_id = ?", id);
  const r = await api("admin", `/api/papelera/${fila.id}`, { method: "DELETE" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(destruidos, ["fotos/tres"]);
  assert.equal(uno("SELECT COUNT(*) n FROM papelera WHERE id = ?", fila.id).n, 0);
});

// El vaciado diario corre solo en el Worker principal (el secundario es respaldo y duplicaría la limpieza en Cloudinary).
test("lo caducado se vacía solo (cron diario 03:17 UTC)", { skip: /secondary/.test(entrada) && "el cron de vaciado solo está en el principal" }, async () => {
  const id = crearMedia("fotos/cuatro");
  await api("autor", `/api/media/${id}`, { method: "DELETE" });
  const fila = uno("SELECT id FROM papelera WHERE tipo = 'media' AND entidad_id = ?", id);
  const hace = new Date(Date.now() - 86400000).toISOString();
  sqlite.prepare("UPDATE papelera SET purgar_despues = ? WHERE id = ?").run(hace, fila.id);
  const reciente = crearNoticia("reciente");
  await api("autor", `/api/articles/${reciente}`, { method: "DELETE" }); // no caducada: debe sobrevivir

  const t = new Date(); t.setUTCHours(3, 17, 0, 0);
  await worker.scheduled({ scheduledTime: t.getTime(), cron: "* * * * *" }, env, ctx);
  await Promise.all(pendientes); pendientes = [];

  assert.ok(destruidos.includes("fotos/cuatro"));
  assert.equal(uno("SELECT COUNT(*) n FROM papelera WHERE id = ?", fila.id).n, 0);
  assert.equal(uno("SELECT COUNT(*) n FROM papelera WHERE tipo = 'articulo' AND entidad_id = ?", reciente).n, 1, "lo reciente se conserva");
});
