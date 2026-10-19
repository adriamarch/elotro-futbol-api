// Punto 5: noticias guardadas para leer luego + historial de lectura en la cuenta del lector.
//   node --no-warnings --test tests/lecturas-cuenta.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/lecturas-cuenta.test.mjs
//
// Usa el esquema REAL (worker/schema.sql) sobre SQLite en memoria, así que también
// comprueba las FK, el UNIQUE y el ON DELETE CASCADE de reader_saved_articles /
// reader_reading_history.
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
// schema.sql no incluye las columnas que añadieron migraciones posteriores y que el
// listado de /api/articles ya selecciona (banner_urgente*): se aplican igual que en producción.
if (!sqlite.prepare("PRAGMA table_info(articles)").all().some((c) => c.name === "banner_urgente")) {
  sqlite.exec(readFileSync(new URL("../migracion_banner_urgente.sql", import.meta.url), "utf8"));
}

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

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}

let contador = 0;
const lector = (nombre) => {
  const email = `${nombre.toLowerCase()}${++contador}@correo.es`;
  const rid = Number(sqlite.prepare("INSERT INTO readers (nombre, email, password_hash, salt, email_verificado) VALUES (?,?,?,?,1)")
    .run(nombre, email, "x", "y").lastInsertRowid);
  return rid;
};
const tokenDe = (rid) => jwt({ rid, nombre: "L", email: "x@x.es" });
const articulo = (slug, publicado = 1) => Number(sqlite.prepare(
  "INSERT INTO articles (slug, titulo, contenido, categoria, tipo, publicado) VALUES (?,?,?,?,?,?)"
).run(slug, "Titular " + slug, "<p>Cuerpo</p>", "hypermotion", "noticia", publicado).lastInsertRowid);

async function api(ruta, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(
    new Request("https://api.test" + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }),
    env, ctx
  );
  const texto = await res.text();
  let data = {};
  try { data = JSON.parse(texto); } catch { data = { texto }; }
  await Promise.all(pendientes); pendientes = [];
  return { status: res.status, data };
}
const ids = (lista, campo = "article_id") => lista.map((x) => x[campo]);
const filas = (tabla, rid) => sqlite.prepare(`SELECT article_id FROM ${tabla} WHERE reader_id = ? ORDER BY created_at DESC, id DESC`).all(rid).map((r) => r.article_id);

test("sin sesión de lector todos los endpoints responden 401", async () => {
  for (const [metodo, ruta] of [
    ["GET", "/api/readers/me/guardadas"], ["POST", "/api/readers/me/guardadas"], ["DELETE", "/api/readers/me/guardadas/1"],
    ["GET", "/api/readers/me/historial"], ["POST", "/api/readers/me/historial"], ["DELETE", "/api/readers/me/historial"],
    ["DELETE", "/api/readers/me/historial/1"], ["POST", "/api/readers/me/lecturas/sincronizar"],
  ]) {
    const r = await api(ruta, { method: metodo, body: metodo === "POST" ? {} : undefined });
    assert.equal(r.status, 401, `${metodo} ${ruta}`);
  }
});

test("guardar, listar, repetir (idempotente) y quitar una noticia", async () => {
  const rid = lector("Ana"); const t = await tokenDe(rid);
  const a = articulo("g-a"); const b = articulo("g-b");

  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: a } })).status, 200);
  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: a } })).status, 200, "repetir no falla");
  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: String(b) } })).status, 200, "acepta id numérico en texto");

  const lista = (await api("/api/readers/me/guardadas", { token: t })).data;
  assert.deepEqual(ids(lista.guardadas), [b, a], "la más reciente primero y sin duplicados");
  assert.equal(lista.max, 200);

  const q = await api(`/api/readers/me/guardadas/${a}`, { method: "DELETE", token: t });
  assert.equal(q.status, 200);
  assert.deepEqual(ids((await api("/api/readers/me/guardadas", { token: t })).data.guardadas), [b]);
});

test("guardar valida el id y que la noticia exista y esté publicada", async () => {
  const rid = lector("Bea"); const t = await tokenDe(rid);
  const borrador = articulo("g-borrador", 0);
  for (const malo of [undefined, null, "abc", -3, 0, 1.5, {}, []]) {
    assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: malo } })).status, 400, JSON.stringify(malo));
  }
  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: 999999 } })).status, 404);
  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: borrador } })).status, 404);
  assert.deepEqual(filas("reader_saved_articles", rid), []);
});

test("cada lector solo ve y toca lo suyo", async () => {
  const r1 = lector("Carla"); const r2 = lector("Dani");
  const t1 = await tokenDe(r1); const t2 = await tokenDe(r2);
  const a = articulo("aisl");
  await api("/api/readers/me/guardadas", { method: "POST", token: t1, body: { article_id: a } });
  await api("/api/readers/me/historial", { method: "POST", token: t1, body: { article_id: a } });

  assert.deepEqual((await api("/api/readers/me/guardadas", { token: t2 })).data.guardadas, []);
  assert.deepEqual((await api("/api/readers/me/historial", { token: t2 })).data.historial, []);
  await api(`/api/readers/me/guardadas/${a}`, { method: "DELETE", token: t2 });
  await api("/api/readers/me/historial", { method: "DELETE", token: t2 });
  assert.deepEqual(filas("reader_saved_articles", r1), [a], "el borrado del otro lector no afecta");
  assert.deepEqual(filas("reader_reading_history", r1), [a]);
});

test("límite de 200 guardadas: la 201 se rechaza con 409, pero repetir una existente sigue siendo válido", async () => {
  const rid = lector("Eva"); const t = await tokenDe(rid);
  const primera = articulo("lim-0");
  const insertar = sqlite.prepare("INSERT INTO reader_saved_articles (reader_id, article_id) VALUES (?, ?)");
  insertar.run(rid, primera);
  for (let i = 1; i < 200; i++) insertar.run(rid, articulo("lim-" + i));
  const nueva = articulo("lim-nueva");

  const r = await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: nueva } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /200/);
  assert.equal((await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: primera } })).status, 200);
  assert.equal(filas("reader_saved_articles", rid).length, 200);
});

test("historial: leer de nuevo sube la noticia arriba y no la duplica", async () => {
  const rid = lector("Fran"); const t = await tokenDe(rid);
  const a = articulo("h-a"); const b = articulo("h-b"); const c = articulo("h-c");
  for (const id of [a, b, c, a]) {
    assert.equal((await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: id } })).status, 200);
  }
  assert.deepEqual(ids((await api("/api/readers/me/historial", { token: t })).data.historial), [a, c, b]);
  assert.equal(filas("reader_reading_history", rid).length, 3, "una sola fila por noticia (UNIQUE)");
});

test("historial: una noticia inexistente o en borrador no se registra (y no da error)", async () => {
  const rid = lector("Gema"); const t = await tokenDe(rid);
  const borrador = articulo("h-borr", 0);
  assert.equal((await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: borrador } })).data.ok, false);
  assert.equal((await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: 424242 } })).data.ok, false);
  assert.equal((await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: "x" } })).status, 400);
  assert.deepEqual(filas("reader_reading_history", rid), []);
});

test("historial: se poda a las 100 más recientes", async () => {
  const rid = lector("Hugo"); const t = await tokenDe(rid);
  const creados = [];
  for (let i = 0; i < 105; i++) creados.push(articulo("poda-" + i));
  for (const id of creados) await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: id } });

  const guardadas = filas("reader_reading_history", rid);
  assert.equal(guardadas.length, 100);
  assert.equal(guardadas[0], creados[104], "la última leída arriba");
  assert.ok(!guardadas.includes(creados[0]) && !guardadas.includes(creados[4]), "las 5 más antiguas se han ido");
  assert.ok(guardadas.includes(creados[5]));
});

test("historial: paginación con hay_mas, borrar una y borrar todo", async () => {
  const rid = lector("Iris"); const t = await tokenDe(rid);
  const a = articulo("p-a"); const b = articulo("p-b"); const c = articulo("p-c");
  for (const id of [a, b, c]) await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: id } });

  const p1 = (await api("/api/readers/me/historial?limit=2", { token: t })).data;
  assert.deepEqual(ids(p1.historial), [c, b]); assert.equal(p1.hay_mas, true);
  const p2 = (await api("/api/readers/me/historial?limit=2&offset=2", { token: t })).data;
  assert.deepEqual(ids(p2.historial), [a]); assert.equal(p2.hay_mas, false);

  await api(`/api/readers/me/historial/${b}`, { method: "DELETE", token: t });
  assert.deepEqual(filas("reader_reading_history", rid), [c, a]);
  await api("/api/readers/me/historial", { method: "DELETE", token: t });
  assert.deepEqual(filas("reader_reading_history", rid), []);
});

test("una noticia que pasa a borrador desaparece de las listas pero su fila se conserva", async () => {
  const rid = lector("Jon"); const t = await tokenDe(rid);
  const a = articulo("vis-a"); const b = articulo("vis-b");
  for (const id of [a, b]) {
    await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: id } });
    await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: id } });
  }
  sqlite.prepare("UPDATE articles SET publicado = 0 WHERE id = ?").run(a);
  assert.deepEqual(ids((await api("/api/readers/me/guardadas", { token: t })).data.guardadas), [b]);
  assert.deepEqual(ids((await api("/api/readers/me/historial", { token: t })).data.historial), [b]);
  assert.equal(filas("reader_saved_articles", rid).length, 2, "la fila sigue ahí");
  sqlite.prepare("UPDATE articles SET publicado = 1 WHERE id = ?").run(a);
  assert.deepEqual(ids((await api("/api/readers/me/guardadas", { token: t })).data.guardadas).sort(), [a, b].sort());
});

test("borrar la noticia o el lector borra sus filas (ON DELETE CASCADE)", async () => {
  const rid = lector("Kira"); const t = await tokenDe(rid);
  const a = articulo("casc-a"); const b = articulo("casc-b");
  for (const id of [a, b]) {
    await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: id } });
    await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: id } });
  }
  sqlite.prepare("DELETE FROM articles WHERE id = ?").run(a);
  assert.deepEqual(filas("reader_saved_articles", rid), [b]);
  assert.deepEqual(filas("reader_reading_history", rid), [b]);
  sqlite.prepare("DELETE FROM readers WHERE id = ?").run(rid);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM reader_saved_articles WHERE reader_id = ?").get(rid).n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM reader_reading_history WHERE reader_id = ?").get(rid).n, 0);
});

test("sincronizar: fusiona lo del navegador, solo añade, ignora basura y conserva el orden", async () => {
  const rid = lector("Lara"); const t = await tokenDe(rid);
  const [a, b, c, d] = ["s-a", "s-b", "s-c", "s-d"].map((s) => articulo(s));
  const borrador = articulo("s-borr", 0);
  // Ya en la cuenta: a guardada, d en el historial.
  await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: a } });
  await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: d } });

  // El navegador manda lo más reciente primero, con basura mezclada.
  const r = await api("/api/readers/me/lecturas/sincronizar", {
    method: "POST", token: t,
    body: {
      guardadas: [{ id: c, t: 1 }, { id: b, t: 2 }, { id: a, t: 3 }, { id: c }, borrador, 999999, "x", null, -1, 7.5, { id: "no" }],
      historial: [c, a, d, borrador, "junk"],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.nuevas_guardadas, 2, "b y c; a ya estaba");
  assert.equal(r.data.nuevas_historial, 2, "c y a; d ya estaba");
  assert.deepEqual(ids(r.data.guardadas), [c, b, a], "c (más reciente del navegador) arriba, a (ya existente) al final");
  const hist = filas("reader_reading_history", rid);
  assert.equal(hist.length, 3);
  assert.ok(hist.indexOf(c) < hist.indexOf(a), "dentro de lo fusionado se respeta el orden (c más reciente que a)");
  assert.ok(!hist.includes(borrador));

  // Idempotente: repetirlo no cambia nada.
  const r2 = await api("/api/readers/me/lecturas/sincronizar", { method: "POST", token: t, body: { guardadas: [c, b, a], historial: [c, a, d] } });
  assert.equal(r2.data.nuevas_guardadas, 0); assert.equal(r2.data.nuevas_historial, 0);
});

test("sincronizar con cuerpo vacío o inválido no falla", async () => {
  const t = await tokenDe(lector("Mar"));
  for (const body of [{}, { guardadas: "no", historial: 5 }, { guardadas: [], historial: [] }]) {
    const r = await api("/api/readers/me/lecturas/sincronizar", { method: "POST", token: t, body });
    assert.equal(r.status, 200); assert.deepEqual(r.data.guardadas, []);
  }
});

test("sincronizar respeta el máximo de 200 guardadas y el de 100 del historial", async () => {
  const rid = lector("Nico"); const t = await tokenDe(rid);
  const todos = [];
  for (let i = 0; i < 230; i++) todos.push(articulo("max-" + i));
  const masReciente1 = todos.slice(0, 230); // el cliente envía lo más reciente primero

  const r = await api("/api/readers/me/lecturas/sincronizar", { method: "POST", token: t, body: { guardadas: masReciente1, historial: masReciente1 } });
  assert.equal(r.status, 200);
  assert.equal(filas("reader_saved_articles", rid).length, 200, "se queda en el tope (el cuerpo se recorta a 200)");
  assert.equal(r.data.guardadas.length, 200);
  assert.equal(filas("reader_reading_history", rid).length, 100);
  assert.equal(filas("reader_saved_articles", rid)[0], todos[0], "lo más reciente enviado queda arriba");
});

test("GET /api/articles?ids= devuelve solo esas noticias publicadas (con los mismos campos de tarjeta)", async () => {
  const a = articulo("ids-a"); const b = articulo("ids-b"); const c = articulo("ids-c"); const borr = articulo("ids-borr", 0);
  const r = await api(`/api/articles?ids=${a},${c},${borr},999999,abc,-2`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.articles.map((x) => x.id).sort((x, y) => x - y), [a, c].sort((x, y) => x - y));
  const art = r.data.articles[0];
  for (const campo of ["id", "slug", "titulo", "categoria", "imagen_url", "fecha_publicacion"]) assert.ok(campo in art, campo);
  assert.ok(!r.data.articles.some((x) => x.id === b || x.id === borr));
});

test("GET /api/articles?ids= no se corta por la fusión de previas/crónicas (se piden ids concretos)", async () => {
  // Dos crónicas del mismo partido: sin ids, la segunda se oculta (fusionadas). Con ids debe poder salir.
  const resultado = Number(sqlite.prepare(
    "INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido) VALUES ('hypermotion',1,'A','B',1,0,'2026-10-01')"
  ).run().lastInsertRowid);
  const c1 = articulo("fus-1"); const c2 = articulo("fus-2");
  sqlite.prepare("UPDATE articles SET tipo = 'cronica', resultado_id = ? WHERE id IN (?, ?)").run(resultado, c1, c2);
  const r = await api(`/api/articles?ids=${c1},${c2}`);
  assert.deepEqual(r.data.articles.map((x) => x.id).sort((x, y) => x - y), [c1, c2].sort((x, y) => x - y));
});

test("registrar historial / guardar no vacía la caché pública de listados (otras escrituras sí)", async () => {
  const rid = lector("Olga"); const t = await tokenDe(rid);
  const base = articulo("cache-base");
  const url = "/api/articles?limit=50&categoria=hypermotion";
  const antes = (await api(url)).data.articles.map((x) => x.id);
  assert.ok(antes.includes(base));

  const nuevo = articulo("cache-nuevo"); // aparece en BD pero la caché de 15 s aún no lo sabe
  await api("/api/readers/me/historial", { method: "POST", token: t, body: { article_id: base } });
  await api("/api/readers/me/guardadas", { method: "POST", token: t, body: { article_id: base } });
  await api("/api/readers/me/lecturas/sincronizar", { method: "POST", token: t, body: { guardadas: [base], historial: [base] } });
  const trasLecturas = (await api(url)).data.articles.map((x) => x.id);
  assert.ok(!trasLecturas.includes(nuevo), "la caché sigue intacta tras escrituras de guardadas/historial");

  await api("/api/readers/me/avisos-comentarios", { method: "PUT", token: t, body: { activo: true } }); // escritura normal
  const trasOtra = (await api(url)).data.articles.map((x) => x.id);
  assert.ok(trasOtra.includes(nuevo), "una escritura normal sí vacía la caché");
});
