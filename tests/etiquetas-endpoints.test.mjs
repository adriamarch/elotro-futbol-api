// Etiquetas (tags) reales, feeds RSS filtrados y sitemap de etiquetas, de extremo
// a extremo: Worker real + SQLite real con el esquema completo (schema.sql).
//   node --no-warnings --test tests/etiquetas-endpoints.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/etiquetas-endpoints.test.mjs
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

const adminId = Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email) VALUES ('admin','x','x','Admin','admin',4,'admin@x.es')").run().lastInsertRowid);
const tokenAdmin = await jwt({ uid: adminId, rol: "admin", nombre: "Admin", tfa: true });
const auth = { Authorization: `Bearer ${tokenAdmin}`, "Content-Type": "application/json" };

// --- datos de prueba ---
let n = 0;
function noticia(extra) {
  n += 1;
  const e = extra.etiquetas || [];
  const campos = {
    slug: `noticia-${n}`, titulo: `Noticia ${n}`, subtitulo: `Resumen ${n}`, contenido: "<p>Texto</p>", tipo: "noticia",
    categoria: "primera_federacion", club: null, autor_id: 7, autor_nombre: "Ana Pérez", publicado: 1,
    fecha_publicacion: `2026-10-${String(10 + n).padStart(2, "0")} 10:00:00`,
    ...extra,
    etiquetas: e.length ? JSON.stringify(e) : null,
    etiquetas_slugs: e.length ? `,${e.map((x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).join(",")},` : null,
  };
  const ks = Object.keys(campos);
  sqlite.prepare(`INSERT INTO articles (${ks.join(",")}) VALUES (${ks.map(() => "?").join(",")})`).run(...ks.map((k) => campos[k]));
  return campos.slug;
}
noticia({ etiquetas: ["Ascenso 2026", "Fichajes"], club: "Real Oviedo" });
noticia({ etiquetas: ["Ascenso 2026"], club: JSON.stringify(["Real Oviedo", "Sporting B"]), tipo: "cronica" });
noticia({ etiquetas: ["Fichajes"], categoria: "hypermotion", autor_id: 8, autor_nombre: "Luis Gómez", club: "Racing" });
noticia({ etiquetas: ["Liga"] });
noticia({ etiquetas: ["Liga 2"] });
noticia({ etiquetas: ["Solo una"], publicado: 0 }); // borrador: no cuenta
noticia({});

test("GET /api/etiquetas: listado con conteos, sin borradores", async () => {
  const r = await pedir("/api/etiquetas");
  assert.equal(r.status, 200);
  const { etiquetas } = await r.json();
  const por = Object.fromEntries(etiquetas.map((e) => [e.slug, e]));
  assert.equal(por["ascenso-2026"].total, 2);
  assert.equal(por["ascenso-2026"].nombre, "Ascenso 2026");
  assert.equal(por["fichajes"].total, 2);
  assert.equal(por["liga"].total, 1);
  assert.equal(por["liga-2"].total, 1);
  assert.equal(por["solo-una"], undefined, "una noticia en borrador no genera etiqueta pública");
});

test("GET /api/etiquetas?min=2&limit=1", async () => {
  const { etiquetas } = await (await pedir("/api/etiquetas?min=2")).json();
  assert.deepEqual(etiquetas.map((e) => e.slug).sort(), ["ascenso-2026", "fichajes"]);
  const uno = await (await pedir("/api/etiquetas?limit=1")).json();
  assert.equal(uno.etiquetas.length, 1);
});

test("GET /api/etiquetas/{slug}: existe / indexable / 404", async () => {
  const ok = await pedir("/api/etiquetas/ascenso-2026");
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.equal(d.etiqueta.total, 2);
  assert.equal(d.indexable, true);

  const poca = await (await pedir("/api/etiquetas/liga")).json();
  assert.equal(poca.indexable, false, "con 1 sola noticia no debe indexarse");

  // acepta el nombre tal cual (con espacios y acentos codificados)
  assert.equal((await pedir("/api/etiquetas/Ascenso%202026")).status, 200);
  assert.equal((await pedir("/api/etiquetas/no-existe")).status, 404);
  assert.equal((await pedir("/api/etiquetas/%23%23%23")).status, 404);
});

test("GET /api/articles?etiqueta=: filtra por slug exacto (liga no casa con liga-2)", async () => {
  const slugs = async (q) => (await (await pedir(`/api/articles?${q}`)).json()).articles.map((a) => a.slug).sort();
  assert.deepEqual(await slugs("etiqueta=ascenso-2026"), ["noticia-1", "noticia-2"]);
  assert.deepEqual(await slugs("etiqueta=Fichajes"), ["noticia-1", "noticia-3"]);
  assert.deepEqual(await slugs("etiqueta=liga"), ["noticia-4"]);
  assert.deepEqual(await slugs("etiqueta=liga-2"), ["noticia-5"]);
  assert.deepEqual(await slugs("etiqueta=solo-una"), [], "el borrador no sale");
  assert.deepEqual(await slugs("etiqueta=%23%23%23"), [], "un valor sin letras no devuelve todo el listado");
  assert.deepEqual(await slugs("etiqueta=fichajes&categoria=hypermotion"), ["noticia-3"], "se combina con otros filtros");
});

test("los listados no arrastran ni etiquetas ni la columna de consulta", async () => {
  const { articles } = await (await pedir("/api/articles?limit=50")).json();
  for (const a of articles) {
    assert.equal("etiquetas_slugs" in a, false);
    assert.equal("etiquetas" in a, false, "las tarjetas no necesitan las etiquetas");
  }
});

test("GET /api/articles/{slug}: la noticia trae etiquetas como array y sin etiquetas_slugs", async () => {
  const r = await pedir("/api/articles/noticia-1");
  assert.equal(r.status, 200);
  const a = (await r.json()).article;
  assert.deepEqual(a.etiquetas, ["Ascenso 2026", "Fichajes"]);
  assert.equal("etiquetas_slugs" in a, false);
  const sin = (await (await pedir("/api/articles/noticia-7")).json()).article;
  assert.deepEqual(sin.etiquetas, []);
});

test("RSS por etiqueta", async () => {
  const r = await pedir("/rss/etiqueta/ascenso-2026.xml");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/rss\+xml/);
  const xml = await r.text();
  assert.match(xml, /<title>Ascenso 2026 — ELOTROFÚTBOLTV<\/title>/);
  assert.match(xml, /<atom:link href="https:\/\/elotrofutbol\.media\/rss\/etiqueta\/ascenso-2026\.xml"/);
  assert.match(xml, /<link>https:\/\/elotrofutbol\.media\/etiqueta\/ascenso-2026<\/link>/);
  assert.equal((xml.match(/<item>/g) || []).length, 2);
  assert.ok(!xml.includes("Noticia 4"));
  assert.equal((await pedir("/rss/etiqueta/no-existe.xml")).status, 404);
  assert.equal((await pedir("/rss/etiqueta/solo-una.xml")).status, 404, "un borrador no abre un feed");
});

test("RSS por categoría (guion o guion bajo) y por autor", async () => {
  for (const seg of ["primera-federacion", "primera_federacion"]) {
    const xml = await (await pedir(`/rss/categoria/${seg}.xml`)).text();
    assert.match(xml, /<title>[^<]*Primera Federaci[^<]* — ELOTROFÚTBOLTV<\/title>/);
    assert.ok(!xml.includes("Noticia 3"), "Noticia 3 es de hypermotion");
    assert.match(xml, /rss\/categoria\/primera-federacion\.xml/);
  }
  assert.equal((await pedir("/rss/categoria/no-existe.xml")).status, 404);
  assert.equal((await pedir("/rss/categoria/..%2Fadmin.xml")).status, 404);

  const autor = await pedir("/rss/autor/8.xml");
  assert.equal(autor.status, 200);
  const xml = await autor.text();
  assert.match(xml, /<title>Luis Gómez — ELOTROFÚTBOLTV<\/title>/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
  assert.equal((await pedir("/rss/autor/999.xml")).status, 404);
  assert.equal((await pedir("/rss/autor/abc.xml")).status, 404);
});

test("RSS por club: slug del nombre, incluye previas/crónicas con dos clubes", async () => {
  const r = await pedir("/rss/club/real-oviedo.xml");
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.match(xml, /<title>Real Oviedo — ELOTROFÚTBOLTV<\/title>/);
  assert.equal((xml.match(/<item>/g) || []).length, 2, "la noticia del club y la crónica con dos clubes");
  // el segundo club de una crónica también tiene feed
  assert.equal((await pedir("/rss/club/sporting-b.xml")).status, 200);
  assert.equal((await pedir("/rss/club/club-inventado.xml")).status, 404);
});

test("el feed global /rss.xml sigue igual y los filtrados no lo pisan", async () => {
  const xml = await (await pedir("/rss.xml")).text();
  assert.match(xml, /<title>ELOTROFÚTBOLTV<\/title>/);
  assert.match(xml, /<atom:link href="https:\/\/elotrofutbol\.media\/rss\.xml"/);
  assert.equal((xml.match(/<item>/g) || []).length, 6, "las 6 noticias publicadas");
});

test("sitemap de etiquetas: solo las de 2+ noticias", async () => {
  const r = await pedir("/sitemap-etiquetas.xml");
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.match(xml, /<loc>https:\/\/elotrofutbol\.media\/etiqueta\/ascenso-2026<\/loc>/);
  assert.match(xml, /<loc>https:\/\/elotrofutbol\.media\/etiqueta\/fichajes<\/loc>/);
  assert.ok(!xml.includes("/etiqueta/liga"), "una sola noticia: no se anuncia");
  assert.match(xml, /<\/urlset>\s*$/);
});

// --- Guardado desde el panel (POST / PUT /api/articles) ---
// El worker exige >= 1500 caracteres de contenido y foto de portada antes de llegar a las etiquetas.
const LARGO = "<p>" + "El equipo salió con intensidad y cuajó una gran primera parte. ".repeat(40) + "</p>";
const PORTADA = "https://res.cloudinary.com/demo/image/upload/portada.jpg";

test("POST /api/articles guarda las etiquetas (sin repetidas) y salen en la API", async () => {
  const r = await pedir("/api/articles", {
    method: "POST", headers: auth,
    body: JSON.stringify({
      titulo: "Nueva con etiquetas", contenido: LARGO, imagen_url: PORTADA, tipo: "noticia", categoria: "general",
      etiquetas: ["Derbi Asturiano", "#derbi asturiano", "Fichajes"],
    }),
  });
  assert.ok(r.status === 200 || r.status === 201, `POST -> ${r.status}: ${await r.clone().text()}`);
  const creada = await r.json();
  const slug = creada.slug || creada.article?.slug;
  assert.ok(slug, "la respuesta debe traer el slug");
  const guardada = (await (await pedir(`/api/articles/${slug}`)).json()).article;
  assert.deepEqual(guardada.etiquetas, ["Derbi Asturiano", "Fichajes"]);
  // y ya existe la página de la etiqueta nueva (la caché se descarta al guardar)
  assert.equal((await pedir("/api/etiquetas/derbi-asturiano")).status, 200);
  assert.equal((await (await pedir("/api/etiquetas/fichajes")).json()).etiqueta.total, 3);
});

test("POST con etiquetas inválidas -> 400 y no se crea nada", async () => {
  const antes = sqlite.prepare("SELECT COUNT(*) c FROM articles").get().c;
  const mal = async (etiquetas) => pedir("/api/articles", {
    method: "POST", headers: auth,
    body: JSON.stringify({ titulo: "Titular de prueba", contenido: LARGO, imagen_url: PORTADA, tipo: "noticia", categoria: "general", etiquetas }),
  });
  const muchas = await mal(Array.from({ length: 9 }, (_, i) => `Tema ${i}`));
  assert.equal(muchas.status, 400);
  assert.match((await muchas.json()).error, /máximo 8/);
  assert.equal((await mal(["x".repeat(41)])).status, 400);
  assert.equal((await mal(["???"])).status, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM articles").get().c, antes);
});

test("PUT: sin 'etiquetas' conserva las que había; con [] las quita; con lista las reemplaza", async () => {
  const id = sqlite.prepare("SELECT id FROM articles WHERE slug = 'noticia-1'").get().id;
  const base = { titulo: "Noticia 1", contenido: LARGO, imagen_url: PORTADA, tipo: "noticia", categoria: "primera_federacion", club: "Real Oviedo" };
  const put = (extra) => pedir(`/api/articles/${id}`, { method: "PUT", headers: auth, body: JSON.stringify({ ...base, ...extra }) });
  const leer = async () => (await (await pedir("/api/articles/noticia-1")).json()).article.etiquetas;

  let r = await put({});
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await leer(), ["Ascenso 2026", "Fichajes"], "sin el campo, intactas");

  r = await put({ etiquetas: ["Ascenso 2026", "Play-off"] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await leer(), ["Ascenso 2026", "Play-off"]);
  assert.equal((await (await pedir("/api/etiquetas/play-off")).json()).etiqueta.total, 1);

  r = await put({ etiquetas: Array.from({ length: 9 }, (_, i) => `T${i}`) });
  assert.equal(r.status, 400);
  assert.deepEqual(await leer(), ["Ascenso 2026", "Play-off"], "un 400 no cambia nada");

  r = await put({ etiquetas: [] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await leer(), []);
  assert.equal(sqlite.prepare("SELECT etiquetas_slugs FROM articles WHERE id = ?").get(id).etiquetas_slugs, null);
});
