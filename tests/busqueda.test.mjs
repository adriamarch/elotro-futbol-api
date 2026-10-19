// node --test worker/tests/busqueda.test.mjs      (Node 22+, usa node:sqlite)
//
// Ejecuta src/busqueda.js contra SQLite real (FTS5) con el esquema real del
// proyecto (schema.sql) y la migración real (migracion_busqueda_fts5.sql). La
// consulta de listado imita la forma de GET /api/articles (misma sustitución de
// "FROM articles WHERE 1=1"). La rama PostgreSQL solo se prueba a nivel de
// cadenas (no hay Postgres en CI): ver el final del archivo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizarTexto, terminosConsulta, textoPlanoDeHtml, distanciaDL, corregirTerminos,
  construirMatchSqlite, construirTsquery, planificarBusqueda, expresionParaIntento,
  fragmentosRanking, extractosBusqueda, facetasBusqueda, indexarArticuloBusqueda,
  eliminarArticuloBusqueda, reconciliarIndiceBusqueda, busquedaFtsDisponible,
  analizarConsulta, plegarEspeciales,
} from "../src/busqueda.js";

const aqui = dirname(fileURLToPath(import.meta.url));

// Adaptador mínimo con la forma de D1 (prepare/bind/all/first/run/batch).
function crearD1(sqlite) {
  const stmt = (sql) => ({
    sql, params: [],
    bind(...p) { this.params = p; return this; },
    async all() { return { results: sqlite.prepare(sql).all(...this.params) }; },
    async first() { return sqlite.prepare(sql).get(...this.params) ?? null; },
    async run() { const r = sqlite.prepare(sql).run(...this.params); return { success: true, meta: { changes: r.changes } }; },
  });
  return {
    prepare: stmt,
    async batch(lista) {
      sqlite.exec("BEGIN");
      try { for (const s of lista) sqlite.prepare(s.sql).run(...s.params); sqlite.exec("COMMIT"); }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
}

let sqlite, env;
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

function insertar(a) {
  const r = sqlite.prepare(
    `INSERT INTO articles (slug, titulo, subtitulo, contenido, tipo, categoria, club, autor_nombre, publicado, fecha_publicacion, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(a.slug, a.titulo, a.subtitulo ?? null, a.contenido, a.tipo ?? "noticia", a.categoria ?? "hypermotion",
    a.club ?? null, a.autor ?? "Redacción", a.publicado ?? 1, a.fecha ?? hace(1));
  return Number(r.lastInsertRowid);
}

// Réplica de la parte relevante de GET /api/articles.
async function listar(q, { intento, categoria, limit = 10, offset = 0, orden } = {}) {
  const plan = planificarBusqueda(q);
  const fijo = intento !== undefined;
  for (let i = fijo ? intento : 0; i <= 2; i++) {
    const e = await expresionParaIntento(env, plan, i);
    if (!e) { if (fijo) break; continue; }
    const r = fragmentosRanking(env, e.expr);
    let sql = `SELECT id, titulo, categoria, fecha_publicacion FROM articles WHERE 1=1 AND publicado = 1`;
    const binds = [];
    if (categoria) { sql += " AND categoria = ?"; binds.push(categoria); }
    sql = sql.replace("FROM articles WHERE 1=1", `FROM articles ${r.join} WHERE 1=1`)
      + ` ORDER BY ${orden === "fecha" ? "fecha_publicacion DESC" : r.order} LIMIT ? OFFSET ?`;
    const { results } = await env.DB.prepare(sql).bind(...r.binds, ...binds, limit + 1, offset).all();
    if (results.length || fijo) return { filas: results, e };
  }
  return { filas: [], e: null };
}
const titulos = (r) => r.filas.map((f) => f.titulo);

before(async () => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(join(aqui, "../schema.sql"), "utf8"));
  sqlite.exec(readFileSync(join(aqui, "../migracion_busqueda_fts5.sql"), "utf8"));
  env = { DB: crearD1(sqlite) };

  insertar({ slug: "a", titulo: "El Real Valladolid se impone al Lugo", club: '["Real Valladolid","CD Lugo"]', tipo: "cronica",
    contenido: "<p>Gran partido en <strong>Zorrilla</strong>. El delantero sufrió una lesión de rodilla.</p><div class=\"x\" style=\"color:red\"><img src=\"https://cdn/x.jpg\"></div>", fecha: hace(3) });
  insertar({ slug: "b", titulo: "Previa: Castellón recibe al Betis Deportivo", club: "CD Castellón", tipo: "previa", categoria: "primera_federacion",
    contenido: "<p>El conjunto albinegro busca recuperar sensaciones.</p>", fecha: hace(10) });
  insertar({ slug: "c", titulo: "Fichaje bomba en el Racing de Ferrol", club: "Racing Club Ferrol", categoria: "primera_federacion",
    contenido: "<p>El Valladolid también lo había seguido durante el verano.</p>", fecha: hace(2) });
  insertar({ slug: "d", titulo: "Entrevista a la presidenta del Arenas Club", club: "Arenas Club", tipo: "entrevista", categoria: "segunda_federacion",
    contenido: "<p>Hablamos de la temporada y de la cantera.</p>", fecha: hace(40) });
  insertar({ slug: "e", titulo: "Valladolid y Lugo empatan sin goles", club: '["Real Valladolid","CD Lugo"]', tipo: "cronica",
    contenido: "<p>Empate en Zorrilla.</p>", fecha: hace(300) });
  insertar({ slug: "borrador", titulo: "Borrador secreto sobre el Valladolid", contenido: "<p>No publicar</p>", publicado: 0 });
});

test("normalización, términos y HTML", () => {
  assert.equal(normalizarTexto("  Castellón-Ñandú, ¡Barça! "), "castellon nandu barca");
  assert.deepEqual(terminosConsulta("Valladolid vs. Lugo"), ["valladolid", "lugo"]);
  assert.deepEqual(terminosConsulta("el de la"), []);
  assert.equal(terminosConsulta("a b c d e f g h i jj kk ll mm nn oo pp").length, 6);
  assert.equal(textoPlanoDeHtml('<p>Hola&nbsp;<b>mundo</b> &amp; &#241;</p><script>x()</script>'), "Hola mundo & ñ");
});

test("distancia de edición con transposiciones y corte", () => {
  assert.equal(distanciaDL("valladolid", "valadolid", 2), 1);
  assert.equal(distanciaDL("valladolid", "vallaodlid", 2), 1); // transposición
  assert.equal(distanciaDL("lugo", "betis", 1), 2);              // supera el máximo
});

test("corrección de erratas: solo términos desconocidos y no prefijos", () => {
  const vocab = new Map([["valladolid", 9], ["lugo", 5], ["castellon", 4], ["valencia", 3]]);
  assert.equal(corregirTerminos(["valadolid", "lugo"], vocab).sugerencia, "valladolid lugo");
  assert.equal(corregirTerminos(["vallad"], vocab).cambiado, false);   // prefijo: se está escribiendo
  assert.equal(corregirTerminos(["lugo"], vocab).cambiado, false);
  assert.equal(corregirTerminos(["xyzxyz"], vocab).cambiado, false);   // nada cercano
  assert.equal(corregirTerminos(["lgo"], vocab).cambiado, false);      // <4 letras: no se corrige
});

test("disponibilidad: FTS solo cuando el backfill ha terminado", async () => {
  assert.equal(await busquedaFtsDisponible(env), false);
  let total = 0, listo = false;
  for (let i = 0; i < 5 && !listo; i++) {
    const r = await reconciliarIndiceBusqueda(env, { limite: 4 });
    total += r.procesados; listo = r.listo;
  }
  assert.equal(total, 6);
  assert.equal(listo, true);
  assert.equal(await busquedaFtsDisponible(env), true);
  // Ya completo: el tick de 5 min no hace nada.
  assert.equal((await reconciliarIndiceBusqueda(env, { soloBackfill: true })).omitido, true);
});

test("coincidencia básica, AND, prefijo y sin tildes", async () => {
  assert.deepEqual(titulos(await listar("valladolid lugo")).slice(0, 2).sort(),
    ["El Real Valladolid se impone al Lugo", "Valladolid y Lugo empatan sin goles"].sort());
  assert.equal((await listar("vallad")).filas.length >= 3, true);       // prefijo
  assert.deepEqual(titulos(await listar("castellon")), ["Previa: Castellón recibe al Betis Deportivo"]);
  assert.deepEqual(titulos(await listar("CASTELLÓN")), ["Previa: Castellón recibe al Betis Deportivo"]);
  assert.deepEqual(titulos(await listar("Valladolid vs Lugo", { intento: 0 })).length, 2);
});

test("no devuelve borradores ni se cuela el HTML", async () => {
  assert.equal(titulos(await listar("valladolid")).includes("Borrador secreto sobre el Valladolid"), false);
  for (const basura of ["strong", "href", "style", "https", "color"]) {
    assert.equal((await listar(basura)).filas.length, 0, `"${basura}" no debería estar en el índice`);
  }
});

test("busca en el cuerpo, en el club (array JSON) y en el autor", async () => {
  assert.deepEqual(titulos(await listar("rodilla")), ["El Real Valladolid se impone al Lugo"]);
  assert.deepEqual(titulos(await listar("albinegro")), ["Previa: Castellón recibe al Betis Deportivo"]);
  assert.equal((await listar("redaccion")).filas.length, 5);
});

test("el título pesa más que el cuerpo", async () => {
  // "Valladolid" está en el título de a, e y en el cuerpo de c (más reciente).
  const r = titulos(await listar("valladolid", { orden: undefined }));
  assert.equal(r.indexOf("Fichaje bomba en el Racing de Ferrol"), r.length - 1);
});

test("a igual relevancia, lo reciente va antes", async () => {
  const r = await listar("valladolid lugo");
  assert.equal(r.filas[0].titulo, "El Real Valladolid se impone al Lugo"); // hace 3 días vs 300
  const f = await listar("valladolid", { orden: "fecha" });
  assert.equal(f.filas[0].titulo, "Fichaje bomba en el Racing de Ferrol"); // la más reciente (hace 2 días)
});

test("filtros y paginación sobre el listado", async () => {
  assert.deepEqual(titulos(await listar("valladolid", { categoria: "primera_federacion" })), ["Fichaje bomba en el Racing de Ferrol"]);
  const p1 = await listar("valladolid", { limit: 1, offset: 0 });
  const p2 = await listar("valladolid", { limit: 1, offset: 1 });
  assert.equal(p1.filas.length, 2);              // limit + 1: hay más
  assert.notEqual(p1.filas[0].id, p2.filas[0].id);
});

test("erratas: intento 0 vacío, intento 1 corrige", async () => {
  assert.equal((await listar("valadolid", { intento: 0 })).filas.length, 0);
  const r = await listar("valadolid lugo");
  assert.equal(r.e.intento, 1);
  assert.equal(r.e.corregido, "valladolid lugo");
  assert.equal(r.filas.length, 2);
  assert.equal(titulos(await listar("castelon")).join(), "Previa: Castellón recibe al Betis Deportivo");
  assert.equal(titulos(await listar("Arrenas")).join(), "Entrevista a la presidenta del Arenas Club");
  const exacto = await listar("valadolid", { intento: 0 });           // exacto: sin corregir
  assert.equal(exacto.filas.length, 0);
  assert.equal(exacto.e.corregido, null);
});

test("una palabra válida del cuerpo no se 'corrige'", async () => {
  const r = await listar("cantera");
  assert.equal(r.e.intento, 0);
  assert.equal(r.e.corregido, null);
});

test("sin resultados con AND cae a OR", async () => {
  const r = await listar("castellon lugo");   // nadie tiene ambos
  assert.equal(r.e.modo, "or");
  assert.equal(r.filas.length >= 3, true);
  assert.equal((await listar("zzzzqq")).filas.length, 0);
});

test("extractos: resaltado con <mark> y sin HTML crudo", async () => {
  const e = await expresionParaIntento(env, planificarBusqueda("rodilla"), 0);
  const id = sqlite.prepare("SELECT id FROM articles WHERE slug = 'a'").get().id;
  const ex = await extractosBusqueda(env, [id], e.expr);
  assert.match(ex.get(id), /<mark>rodilla<\/mark>/);
  assert.doesNotMatch(ex.get(id), /<(p|strong|div|img)\b/);
  // Un título con HTML hostil no se cuela por el extracto.
  const id2 = insertar({ slug: "xss", titulo: "Prueba", contenido: "<p>hola &lt;script&gt;alert(1)&lt;/script&gt; mundo</p>" });
  await indexarArticuloBusqueda(env, id2);
  const e2 = await expresionParaIntento(env, planificarBusqueda("mundo"), 0);
  const ex2 = await extractosBusqueda(env, [id2], e2.expr);
  assert.doesNotMatch(ex2.get(id2), /<script/);
  assert.match(ex2.get(id2), /&lt;script&gt;/);
});

test("facetas por categoría y tipo (solo publicados)", async () => {
  const e = await expresionParaIntento(env, planificarBusqueda("valladolid"), 0);
  const f = await facetasBusqueda(env, e.expr, {});
  assert.deepEqual(f.categorias, { hypermotion: 2, primera_federacion: 1 });
  assert.deepEqual(f.tipos, { cronica: 2, noticia: 1 });
});

test("reindexar tras editar y quitar tras borrar", async () => {
  const id = sqlite.prepare("SELECT id FROM articles WHERE slug = 'd'").get().id;
  sqlite.prepare("UPDATE articles SET titulo = 'Entrevista al técnico del Arenas', updated_at = datetime('now', '+1 second') WHERE id = ?").run(id);
  await indexarArticuloBusqueda(env, id);
  assert.equal((await listar("tecnico", { intento: 0 })).filas.length, 1);
  assert.equal((await listar("presidenta", { intento: 0 })).filas.length, 0);
  sqlite.prepare("DELETE FROM articles WHERE id = ?").run(id);
  await eliminarArticuloBusqueda(env, id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM articles_fts WHERE rowid = ?").get(id).n, 0);
});

test("el reconciliador recoge artículos nuevos o desfasados", async () => {
  const id = insertar({ slug: "nuevo", titulo: "Noticia recién creada sin indexar", contenido: "<p>texto</p>" });
  const r = await reconciliarIndiceBusqueda(env, { soloBackfill: false });
  assert.equal(r.procesados >= 1, true);
  assert.equal((await listar("recien", { intento: 0 })).filas.length, 1);
  void id;
});

test("consultas hostiles no rompen la sintaxis MATCH", async () => {
  for (const q of ['"', "'; DROP TABLE articles; --", "NEAR(a b)", "title:valladolid", "valladolid*", "(((", "AND OR NOT", "\u0000"]) {
    await assert.doesNotReject(() => listar(q), q);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM articles").get().n > 0, true);
});

test("rama PostgreSQL: expresiones y SQL bien formados (sin servidor PG)", async () => {
  const items = [{ t: "valladolid", alts: ["valadolid"] }, { t: "lugo", alts: [] }, { t: "de", alts: [] }];
  assert.equal(construirTsquery(items, "and"), "(valladolid:* | valadolid:*) & lugo:* & de");
  assert.equal(construirTsquery(items, "or"), "(valladolid:* | valadolid:*) | lugo:* | de");
  assert.equal(construirMatchSqlite(items, "and"), '("valladolid"* OR "valadolid"*) AND "lugo"* AND "de"');
  const pg = { RUNNING_IN_RAILWAY: "true" };
  const r = fragmentosRanking(pg, "lugo:*");
  assert.equal((r.join.match(/\?/g) || []).length, r.binds.length);
  assert.match(r.join, /to_tsquery\('es_unaccent', \?\)/);
  assert.match(r.order, /DESC, articles\.id DESC$/);
  // La traducción SQLite->PG del proyecto debe convertir los "?" sin tocar nada más.
  const { translateSql } = await import("../../worker-secondary/src/sql-compat.js");
  const t = translateSql(`SELECT 1 FROM articles ${r.join} WHERE 1=1 AND categoria = ? ORDER BY ${r.order} LIMIT ? OFFSET ?`, []);
  assert.deepEqual([...t.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])), [1, 2, 3, 4]);
});

// ---------- Casos ampliados (sintaxis, sinónimos, plurales, caracteres raros) ----------

test("plegado de caracteres que NFD no descompone", () => {
  assert.equal(plegarEspeciales("Ødegaard Łukasz Großkreutz Çalhanoğlu ı"), "Odegaard Lukasz Grosskreutz Çalhanoğlu i");
  assert.equal(normalizarTexto("Ødegaard"), "odegaard");
  assert.equal(normalizarTexto("Łukasz Çalhanoğlu"), "lukasz calhanoglu");
  assert.equal(normalizarTexto("2ª RFEF · 1º"), "2 rfef 1");
});

test("analizarConsulta: frases, exclusiones, marcadores y palabras vacías", () => {
  assert.deepEqual(analizarConsulta('"real madrid" fichaje'), { terminos: ["fichaje"], frases: [["real", "madrid"]], excluidos: [], vacio: false });
  assert.deepEqual(analizarConsulta("goles -barca").excluidos, ["barca"]);
  assert.deepEqual(analizarConsulta("goles -barca").terminos, ["goles"]);
  assert.deepEqual(analizarConsulta("Valladolid 2-1 Lugo").frases, [["2", "1"]]);
  assert.deepEqual(analizarConsulta("Valladolid 2-1 Lugo").terminos, ["valladolid", "lugo"]);
  assert.deepEqual(analizarConsulta("0 - 0").frases, [["0", "0"]]);
  assert.deepEqual(analizarConsulta("Real Madrid – Barça").excluidos, []);   // guion con espacios: no es exclusión
  assert.deepEqual(analizarConsulta("atlético-madrid").terminos, ["atletico", "madrid"]);
  assert.deepEqual(analizarConsulta("el").terminos, ["el"]);                 // solo vacías: se busca tal cual
  assert.equal(analizarConsulta("-fichaje").vacio, true);                    // solo exclusión: nada que buscar
  assert.equal(analizarConsulta("").vacio, true);
  assert.equal(analizarConsulta('"a"').terminos.length, 0);                  // 1 letra: sin términos
});

test("expresiones FTS5 / tsquery con frases, exclusiones y sinónimos", () => {
  const items = [{ t: "goles", alts: [] }];
  assert.equal(construirMatchSqlite(items, "and", { frases: [["real", "madrid"]], excluidos: ["barca"] }),
    '(("goles"* OR "gol") AND "real madrid"*) NOT ("barca" OR "barcelona")');
  assert.equal(construirMatchSqlite([], "and", { frases: [["2", "1"]] }), '"2 1"');
  assert.equal(construirTsquery(items, "and", { frases: [["real", "madrid"]], excluidos: ["barca"] }),
    "(goles:* & (real <-> madrid:*)) & !(barca | barcelona)");
  assert.equal(construirTsquery([{ t: "a", alts: [] }], "or", { frases: [["2", "1"]] }), "a | (2 <-> 1)");
});

test("integración: caracteres raros, sinónimos, plurales, marcadores, frases y exclusiones", async () => {
  const mk = (titulo, contenido, extra = {}) => insertar({ slug: "x-" + titulo.toLowerCase().replace(/\W+/g, "-"), titulo, contenido, ...extra });
  mk("Ødegaard manda en el Arsenal", "<p>Łukasz Fabiański lo vio.</p>");
  mk("Primera Federación: jornada 7", "<p>Resumen.</p>", { categoria: "primera_federacion" });
  mk("Crónica de la Segunda RFEF", "<p>Grupo 1.</p>", { categoria: "segunda_federacion" });
  mk("El Barça gana en Montjuïc", "<p>Gran noche azulgrana. Terminó 3-1.</p>", { club: "FC Barcelona" });
  mk("Atlético de Madrid empata", "<p>Un gol en el último minuto.</p>", { club: "Atlético de Madrid" });
  mk("Dos jugadores renuevan", "<p>El entrenador confía en ambos jugadores.</p>");
  mk("Real Madrid y Barça, frente a frente", "<p>Madrid contra Barcelona, con el Real Madrid favorito.</p>");
  mk("Madrid real de verdad", "<p>Palabras sueltas.</p>");
  mk("Borrador secretisimo", "<p>nada</p>", { publicado: 0 });
  for (let i = 0; i < 5; i++) await reconciliarIndiceBusqueda(env, { soloBackfill: false, forzarCompleto: true });

  const t = async (q) => titulos(await listar(q));
  // caracteres raros, con y sin el signo
  assert.deepEqual(await t("odegaard"), ["Ødegaard manda en el Arsenal"]);
  assert.deepEqual(await t("Ødegaard"), ["Ødegaard manda en el Arsenal"]);
  assert.deepEqual(await t("lukasz fabianski"), ["Ødegaard manda en el Arsenal"]);
  // RFEF <-> Federación en los dos sentidos
  assert.deepEqual((await t("segunda rfef")).sort(), ["Crónica de la Segunda RFEF"]);
  assert.equal((await t("primera rfef"))[0], "Primera Federación: jornada 7");
  assert.equal((await t("segunda federacion"))[0], "Crónica de la Segunda RFEF");
  // apodos
  assert.equal((await t("barça"))[0] !== undefined, true);
  assert.equal((await t("atleti")).includes("Atlético de Madrid empata"), true);
  // plural <-> singular
  assert.equal((await t("goles")).includes("Atlético de Madrid empata"), true);   // texto: "gol"
  assert.equal((await t("jugador")).includes("Dos jugadores renuevan"), true);
  assert.equal((await t("jugadores")).includes("Dos jugadores renuevan"), true);
  assert.equal((await t("golpe")).length, 0);                                     // "gol" exacto no arrastra "golpe"
  // marcadores
  assert.deepEqual(await t("3-1"), ["El Barça gana en Montjuïc"]);
  assert.deepEqual(await t("3 - 1"), ["El Barça gana en Montjuïc"]);
  // frase exacta: el orden importa
  const frase = await t('"real madrid"');
  assert.equal(frase.includes("Real Madrid y Barça, frente a frente"), true);
  assert.equal(frase.includes("Madrid real de verdad"), false);
  assert.equal((await t("real madrid")).includes("Madrid real de verdad"), true);  // sin comillas: ambas palabras en cualquier orden
  // exclusión
  const sin = await t("madrid -barca");
  assert.equal(sin.includes("Real Madrid y Barça, frente a frente"), false);      // excluye también el apodo/sinónimo
  assert.equal(sin.includes("Madrid real de verdad"), true);
  // sintaxis hostil nueva
  for (const q of ['"""', '- -', '-"', '"a"', "--x", '"real madrid', 'real" madrid"', "-", '"', "- barca", '\u0000"x y"-z']) {
    await assert.doesNotReject(() => listar(q), q);
  }
  // vocabulario de erratas: nada de borradores
  const v = sqlite.prepare("SELECT term FROM busqueda_vocab WHERE term = 'secretisimo'").get();
  assert.equal(v, undefined);
  assert.equal((await t("secretisimo")).length, 0);
});
