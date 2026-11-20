// node --test worker/tests/etiquetas.test.mjs
//
// Lógica pura de las etiquetas reales de las noticias (src/etiquetas.js).
// La consulta por slug se prueba contra SQLite real con el esquema del
// proyecto (schema.sql), igual que busqueda.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  slugEtiqueta, limpiarNombreEtiqueta, parsearEtiquetas, validarEtiquetas, columnasEtiquetas,
  guardarEtiquetasArticulo, quitarColumnaSlugs, agregarEtiquetas, clubesDeColumna,
  MAX_ETIQUETAS, MAX_LONGITUD_ETIQUETA,
} from "../src/etiquetas.js";

const aqui = dirname(fileURLToPath(import.meta.url));

test("slugEtiqueta: sin acentos, eñes ni signos", () => {
  assert.equal(slugEtiqueta("Ascenso 2026"), "ascenso-2026");
  assert.equal(slugEtiqueta("  Fichajes de Invierno  "), "fichajes-de-invierno");
  assert.equal(slugEtiqueta("España: ¡Más fútbol!"), "espana-mas-futbol");
  assert.equal(slugEtiqueta("Play-off / Ascenso"), "play-off-ascenso");
  assert.equal(slugEtiqueta("###"), "");
  assert.equal(slugEtiqueta(null), "");
  assert.equal(slugEtiqueta("日本"), "");
});

test("slugEtiqueta: tope de longitud sin guion final", () => {
  const s = slugEtiqueta("a".repeat(59) + " bbbbbb");
  assert.ok(s.length <= 60);
  assert.ok(!s.endsWith("-"));
});

test("limpiarNombreEtiqueta: quita # inicial, espacios y caracteres peligrosos", () => {
  assert.equal(limpiarNombreEtiqueta("  #Ascenso   2026 "), "Ascenso 2026");
  assert.equal(limpiarNombreEtiqueta('<b>Fichajes</b>"'), "bFichajes/b");
  assert.equal(limpiarNombreEtiqueta("##"), "");
});

test("validarEtiquetas: array, texto con comas y vacíos", () => {
  assert.deepEqual(validarEtiquetas(undefined), { etiquetas: [], slugs: [] });
  assert.deepEqual(validarEtiquetas(null), { etiquetas: [], slugs: [] });
  assert.deepEqual(validarEtiquetas(""), { etiquetas: [], slugs: [] });
  assert.deepEqual(validarEtiquetas(["Ascenso 2026", "Fichajes"]),
    { etiquetas: ["Ascenso 2026", "Fichajes"], slugs: ["ascenso-2026", "fichajes"] });
  assert.deepEqual(validarEtiquetas("Ascenso 2026, #Fichajes\nDerbi"),
    { etiquetas: ["Ascenso 2026", "Fichajes", "Derbi"], slugs: ["ascenso-2026", "fichajes", "derbi"] });
});

test("validarEtiquetas: repetidas por slug se funden (gana la primera)", () => {
  const r = validarEtiquetas(["Fichajes", "fichajes", "FICHAJES ", "Árbitros", "Arbitros"]);
  assert.deepEqual(r.etiquetas, ["Fichajes", "Árbitros"]);
  assert.deepEqual(r.slugs, ["fichajes", "arbitros"]);
});

test("validarEtiquetas: límites y formatos inválidos", () => {
  assert.match(validarEtiquetas(Array.from({ length: MAX_ETIQUETAS + 1 }, (_, i) => `Tema ${i}`)).error, /máximo 8/);
  assert.equal(validarEtiquetas(Array.from({ length: MAX_ETIQUETAS }, (_, i) => `Tema ${i}`)).etiquetas.length, MAX_ETIQUETAS);
  assert.match(validarEtiquetas(["x".repeat(MAX_LONGITUD_ETIQUETA + 1)]).error, /40 caracteres/);
  assert.match(validarEtiquetas(["???"]).error, /letra o un número/);
  assert.ok(validarEtiquetas([42]).error);
  assert.ok(validarEtiquetas({ a: 1 }).error);
  assert.ok(validarEtiquetas(7).error);
});

test("columnasEtiquetas: JSON + slugs entre comas, NULL si no hay", () => {
  assert.deepEqual(columnasEtiquetas({ etiquetas: ["Ascenso 2026", "Fichajes"], slugs: ["ascenso-2026", "fichajes"] }),
    { etiquetas: '["Ascenso 2026","Fichajes"]', etiquetas_slugs: ",ascenso-2026,fichajes," });
  assert.deepEqual(columnasEtiquetas({ etiquetas: [], slugs: [] }), { etiquetas: null, etiquetas_slugs: null });
  assert.deepEqual(columnasEtiquetas(), { etiquetas: null, etiquetas_slugs: null });
});

test("parsearEtiquetas: JSON, array, basura", () => {
  assert.deepEqual(parsearEtiquetas('["A"," B ",3,""]'), ["A", "B"]);
  assert.deepEqual(parsearEtiquetas(["A", "B"]), ["A", "B"]);
  assert.deepEqual(parsearEtiquetas("no es json"), []);
  assert.deepEqual(parsearEtiquetas(null), []);
  assert.deepEqual(parsearEtiquetas(undefined), []);
});

test("quitarColumnaSlugs: la columna de consulta no sale por la API", () => {
  assert.deepEqual(quitarColumnaSlugs({ id: 1, etiquetas: "[]", etiquetas_slugs: ",a," }), { id: 1, etiquetas: "[]" });
  const sin = { id: 2 };
  assert.equal(quitarColumnaSlugs(sin), sin);
  assert.equal(quitarColumnaSlugs(null), null);
});

test("agregarEtiquetas: cuenta por noticia, orden y variante más usada", () => {
  const filas = [
    { etiquetas: '["Fichajes","Ascenso 2026"]', fecha_publicacion: "2026-10-01 10:00:00" },
    { etiquetas: '["fichajes"]', fecha_publicacion: "2026-10-03 10:00:00" },
    { etiquetas: '["Fichajes","fichajes"]', fecha_publicacion: "2026-10-02 10:00:00" }, // 1 sola noticia
    { etiquetas: null, fecha_publicacion: "2026-10-04 10:00:00" },
  ];
  const r = agregarEtiquetas(filas);
  assert.deepEqual(r, [
    { nombre: "Fichajes", slug: "fichajes", total: 3, ultima: "2026-10-03 10:00:00" },
    { nombre: "Ascenso 2026", slug: "ascenso-2026", total: 1, ultima: "2026-10-01 10:00:00" },
  ]);
  assert.deepEqual(agregarEtiquetas([]), []);
  assert.deepEqual(agregarEtiquetas(undefined), []);
});

test("clubesDeColumna: club único o array JSON de dos clubes", () => {
  assert.deepEqual(clubesDeColumna("Real Oviedo"), ["Real Oviedo"]);
  assert.deepEqual(clubesDeColumna('["Real Oviedo","Sporting"]'), ["Real Oviedo", "Sporting"]);
  assert.deepEqual(clubesDeColumna(""), []);
  assert.deepEqual(clubesDeColumna(null), []);
});

// ---- Contra SQLite real con el esquema del proyecto ----

function crearD1(sqlite) {
  const stmt = (sql) => ({
    sql, params: [],
    bind(...p) { this.params = p; return this; },
    async all() { return { results: sqlite.prepare(sql).all(...this.params) }; },
    async first() { return sqlite.prepare(sql).get(...this.params) ?? null; },
    async run() { sqlite.prepare(sql).run(...this.params); return { success: true }; },
  });
  return { prepare: stmt };
}

function bdConEsquema() {
  const sqlite = new DatabaseSync(":memory:");
  // articles referencia a otras tablas (results, users...) que aquí no hacen falta.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  // Solo la tabla articles del esquema real + la migración de etiquetas.
  const esquema = readFileSync(join(aqui, "../schema.sql"), "utf8");
  const m = esquema.match(/CREATE TABLE articles \([\s\S]*?\n\);/);
  assert.ok(m, "no se encontró CREATE TABLE articles en schema.sql");
  sqlite.exec(m[0]);
  return sqlite;
}

test("schema.sql incluye las columnas de etiquetas", () => {
  const sqlite = bdConEsquema();
  const cols = sqlite.prepare("PRAGMA table_info(articles)").all().map((c) => c.name);
  assert.ok(cols.includes("etiquetas"));
  assert.ok(cols.includes("etiquetas_slugs"));
});

test("guardarEtiquetasArticulo + filtro LIKE por slug (sin falsos positivos)", async () => {
  const sqlite = bdConEsquema();
  const env = { DB: crearD1(sqlite) };
  const ins = sqlite.prepare("INSERT INTO articles (slug, titulo, contenido, publicado) VALUES (?, ?, 'x', 1)");
  ins.run("a", "A"); ins.run("b", "B"); ins.run("c", "C");
  assert.equal(await guardarEtiquetasArticulo(env, 1, validarEtiquetas(["Liga", "Ascenso 2026"])), true);
  assert.equal(await guardarEtiquetasArticulo(env, 2, validarEtiquetas(["Liga 2"])), true);
  assert.equal(await guardarEtiquetasArticulo(env, 3, validarEtiquetas(["Copa Liga"])), true);

  const slugs = (s) => sqlite.prepare("SELECT slug FROM articles WHERE etiquetas_slugs LIKE ? ORDER BY id")
    .all(`%,${s},%`).map((r) => r.slug);
  assert.deepEqual(slugs("liga"), ["a"]);          // ni "liga-2" ni "copa-liga"
  assert.deepEqual(slugs("liga-2"), ["b"]);
  assert.deepEqual(slugs("ascenso-2026"), ["a"]);

  // Quitar todas las etiquetas las deja en NULL y fuera del filtro.
  await guardarEtiquetasArticulo(env, 1, validarEtiquetas([]));
  assert.deepEqual(slugs("liga"), []);
  assert.equal(sqlite.prepare("SELECT etiquetas, etiquetas_slugs FROM articles WHERE id = 1").get().etiquetas, null);
});

test("guardarEtiquetasArticulo: un fallo de BD no lanza (no bloquea publicar)", async () => {
  const env = { DB: { prepare() { throw new Error("no such column: etiquetas"); } } };
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(await guardarEtiquetasArticulo(env, 1, validarEtiquetas(["Liga"])), false);
  } finally { console.error = log; }
});
