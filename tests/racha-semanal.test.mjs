// Prueba del cálculo de "Rachas semanales" (función pura calcularRachaDesdeActividad).
// Se extrae el bloque del código fuente real para no duplicarlo. Uso:
//   node --test tests/racha-semanal.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --test tests/racha-semanal.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ruta = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url);
const fuente = readFileSync(ruta, "utf8");
const ini = fuente.indexOf("const RACHA_SEMANAS_VISIBLES");
const fin = fuente.indexOf("async function calcularRachaSemanal");
assert.ok(ini > 0 && fin > ini, "no se encuentra el bloque de rachas");
const { calcular } = new Function(`${fuente.slice(ini, fin)}\nreturn { calcular: calcularRachaDesdeActividad };`)();

// Hoy = miércoles 28 oct 2026 (Madrid). Semanas (lunes): 26 oct (actual), 19 oct, 12 oct, 5 oct, 28 sep...
const HOY = "2026-10-28";
const pub = (h, n = 1) => ({ h, tipo: "publicacion", n });
const foto = (h, n = 1) => ({ h, tipo: "foto", n });

test("sin actividad: racha 0 y sin riesgo", () => {
  const r = calcular([], HOY);
  assert.equal(r.actual, 0);
  assert.equal(r.en_riesgo, false);
  assert.equal(r.semanas.length, 12);
  assert.equal(r.proximo_hito.semanas, 2);
});

test("semana actual activa suma y cuenta publicaciones y fotos", () => {
  const r = calcular([pub("2026-10-27 10"), foto("2026-10-28 09", 7), pub("2026-10-20 12"), pub("2026-10-13 12")], HOY);
  assert.equal(r.actual, 3);
  assert.equal(r.esta_semana_activa, true);
  assert.equal(r.en_riesgo, false);
  assert.equal(r.hito_actual.semanas, 2);
  assert.equal(r.proximo_hito.faltan, 1);
  const ultima = r.semanas[11];
  assert.deepEqual([ultima.publicaciones, ultima.fotos, ultima.actual], [1, 7, true]);
});

test("la semana en curso sin actividad no rompe la racha: queda en riesgo hasta el domingo", () => {
  const r = calcular([pub("2026-10-20 12"), foto("2026-10-14 12")], HOY);
  assert.equal(r.actual, 2);
  assert.equal(r.esta_semana_activa, false);
  assert.equal(r.en_riesgo, true);
  assert.equal(r.dias_restantes, 4); // miércoles -> domingo
});

test("una semana vacía de por medio rompe la racha pero se conserva la mejor", () => {
  const r = calcular([pub("2026-10-27 10"), pub("2026-10-06 10"), pub("2026-09-29 10"), pub("2026-09-22 10"), pub("2026-09-15 10")], HOY);
  assert.equal(r.actual, 1);
  assert.equal(r.mejor, 4);
});

test("hora de Madrid: el domingo 23:30 UTC ya es lunes en Madrid (cuenta en la semana siguiente)", () => {
  // 2026-10-25 23:30 UTC = lunes 26 oct 00:30 (CET, tras el cambio de hora) => semana actual
  const r = calcular([pub("2026-10-25 23")], HOY);
  assert.equal(r.esta_semana_activa, true);
});

test("actividad futura se ignora", () => {
  const r = calcular([pub("2026-11-10 10")], HOY);
  assert.equal(r.actual, 0);
});
