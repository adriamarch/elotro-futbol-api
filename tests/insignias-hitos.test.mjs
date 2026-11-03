// Prueba de las "Insignias por hitos" (funciones puras evaluarInsignias e insigniaEventoEnDirecto).
// Se extrae el bloque del código fuente real para no duplicarlo. Uso:
//   node --test tests/insignias-hitos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --test tests/insignias-hitos.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ruta = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url);
const fuente = readFileSync(ruta, "utf8");
const ini = fuente.indexOf("const INSIGNIAS_HITOS");
const fin = fuente.indexOf("async function leerInsigniasGuardadas");
assert.ok(ini > 0 && fin > ini, "no se encuentra el bloque de insignias");
const { evaluar, enDirecto, HITOS } = new Function(
  `${fuente.slice(ini, fin)}\nreturn { evaluar: evaluarInsignias, enDirecto: insigniaEventoEnDirecto, HITOS: INSIGNIAS_HITOS };`
)();

const AHORA = "2026-10-30 12:00:00";
const ids = (r) => r.lista.map((i) => i.id);
const por = (r, id) => r.lista.find((i) => i.id === id);

test("hay exactamente los tres hitos pedidos", () => {
  assert.deepEqual(HITOS.map((h) => h.id), ["primera_cronica", "fotos_10", "primer_directo"]);
  assert.deepEqual(HITOS.map((h) => h.objetivo), [1, 10, 1]);
});

test("redactor sin nada: las tres bloqueadas y sin insignias nuevas", () => {
  const r = evaluar("redactor", { primera_cronica: 0, fotos_10: 0, primer_directo: 0 }, {}, AHORA);
  assert.deepEqual(ids(r), ["primera_cronica", "fotos_10", "primer_directo"]);
  assert.ok(r.lista.every((i) => !i.conseguida && i.actual === 0));
  assert.deepEqual(r.nuevas, {});
});

test("primera crónica y primer directo se consiguen con 1; fotos pide 10", () => {
  const r = evaluar("redactor", { primera_cronica: 3, fotos_10: 9, primer_directo: 1 }, {}, AHORA);
  assert.equal(por(r, "primera_cronica").conseguida, true);
  assert.equal(por(r, "primer_directo").conseguida, true);
  assert.equal(por(r, "fotos_10").conseguida, false);
  assert.equal(por(r, "fotos_10").actual, 9);
  assert.deepEqual(r.nuevas, { primera_cronica: AHORA, primer_directo: AHORA });
});

test("el progreso se acota al objetivo (11 fotos = 10/10)", () => {
  const r = evaluar("redactor", { fotos_10: 11 }, {}, AHORA);
  assert.equal(por(r, "fotos_10").actual, 10);
  assert.equal(por(r, "fotos_10").conseguida, true);
});

test("una insignia ya guardada es permanente aunque ahora mida 0, y no se marca como nueva", () => {
  const r = evaluar("redactor", {}, { primera_cronica: "2026-09-01 10:00:00" }, AHORA);
  const c = por(r, "primera_cronica");
  assert.equal(c.conseguida, true);
  assert.equal(c.actual, 1);
  assert.deepEqual(r.nuevas, {});
});

test("fotógrafo: solo la de fotos", () => {
  const r = evaluar("fotografo", { fotos_10: 10 }, {}, AHORA);
  assert.deepEqual(ids(r), ["fotos_10"]);
  assert.equal(r.lista[0].conseguida, true);
});

test("cualquier rol distinto de fotógrafo se trata como redactor", () => {
  assert.deepEqual(ids(evaluar("revisor", {}, {}, AHORA)), ["primera_cronica", "fotos_10", "primer_directo"]);
});

test("directo: primer evento dentro de la ventana del partido", () => {
  assert.equal(enDirecto("2026-10-25 16:00:00", "2026-10-25 16:07:12"), true);
  assert.equal(enDirecto("2026-10-25 16:00:00", "2026-10-25 19:59:00"), true);
});

test("directo: tolerancia de 5 min por delante del arranque del cronómetro", () => {
  assert.equal(enDirecto("2026-10-25 16:00:00", "2026-10-25 15:56:00"), true);
  assert.equal(enDirecto("2026-10-25 16:00:00", "2026-10-25 15:50:00"), false);
});

test("directo: rellenar o corregir eventos al día siguiente NO cuenta", () => {
  assert.equal(enDirecto("2026-10-25 16:00:00", "2026-10-26 10:00:00"), false);
});

test("directo: sin cronómetro iniciado o con fechas ilegibles NO cuenta", () => {
  assert.equal(enDirecto(null, "2026-10-25 16:07:12"), false);
  assert.equal(enDirecto("2026-10-25 16:00:00", undefined), false);
  assert.equal(enDirecto("basura", "2026-10-25 16:07:12"), false);
});

test("directo: acepta el formato de PostgreSQL (fracción y zona) y objetos Date", () => {
  assert.equal(enDirecto("2026-10-25 16:00:00.123456+00", "2026-10-25 16:30:05.5+00"), true);
  assert.equal(enDirecto(new Date("2026-10-25T16:00:00Z"), new Date("2026-10-25T16:30:00Z")), true);
});
