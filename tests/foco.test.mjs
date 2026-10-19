import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

// Uso: node --test tests/foco.test.mjs            (worker principal)
//      node tests/foco.test.mjs ../worker-secondary/src/index.js
// Carga el código REAL del validador desde index.js (nada reescrito a mano)
// y lo contrasta con el motor del frontend (public/js/foco.js): el valor que
// guarda el backend debe ser exactamente el que pintaría la web.
const ruta = process.argv[2] && process.argv[2].endsWith(".js")
  ? process.argv[2]
  : new URL("../src/index.js", import.meta.url).pathname;
const fuente = fs.readFileSync(ruta, "utf-8");

const ini = fuente.indexOf("// ---------- FOCO DE IMAGEN: validador ÚNICO del backend");
const iniFn = fuente.indexOf("async function consultaConAlternativas");
assert.ok(ini >= 0 && iniFn > ini, "no encuentro el validador de foco en " + ruta);
const fin = fuente.indexOf("\n}\n", iniFn) + 3;
const codigo = fuente.slice(ini, fin);

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  codigo + "\nthis.api = { normalizarFoco, normalizarFocoOpcional, esErrorColumnaFaltante, consultaConAlternativas };",
  ctx
);
const { normalizarFoco, normalizarFocoOpcional, esErrorColumnaFaltante, consultaConAlternativas } = ctx.api;

// Motor del frontend
const motor = {};
vm.createContext(motor);
vm.runInContext(
  fs.readFileSync(new URL("../../public/js/foco.js", import.meta.url), "utf-8"),
  motor
);
const EOF_FOCO = motor.EOF_FOCO || vm.runInContext("typeof EOF_FOCO !== 'undefined' ? EOF_FOCO : null", motor);

const CASOS_VALIDOS = [
  ["62% 30%", "62% 30%"],
  ["62 30", "62% 30%"],
  ["62.5% 30%", "62.5% 30%"],
  ["62.54% 30.06%", "62.5% 30.1%"],
  ["  10%   90%  ", "10% 90%"],
  ["center top", "50% 0%"],
  ["top left", "0% 0%"],
  ["bottom right", "100% 100%"],
  ["right", "100% 50%"],
  ["top", "50% 0%"],
  ["999% 999%", "100% 100%"],
  ["-20% 40%", "0% 40%"],
  [[10, 20], "10% 20%"],
  [{ x: 70, y: "25%" }, "70% 25%"],
];

const CASOS_INVALIDOS = [
  "", "   ", null, undefined, "abc", "50% 50% 50%", "50%;background:red 10%",
  '50%" onerror="alert(1)', "url(javascript:alert(1)) 5%", "NaN% 10%", "1e3% 5%",
  "x".repeat(500), true, {}, [], ["a", "b"],
];

test("normalizarFoco: formatos válidos y límites 0-100", () => {
  for (const [entrada, esperado] of CASOS_VALIDOS) {
    assert.equal(normalizarFoco(entrada), esperado, JSON.stringify(entrada));
  }
});

test("normalizarFoco: cualquier valor raro o malicioso cae al centro", () => {
  for (const entrada of CASOS_INVALIDOS) {
    assert.equal(normalizarFoco(entrada), "50% 50%", JSON.stringify(entrada));
  }
});

test("normalizarFocoOpcional: null cuando no hay foco válido", () => {
  for (const entrada of CASOS_INVALIDOS) {
    assert.equal(normalizarFocoOpcional(entrada), null, JSON.stringify(entrada));
  }
  assert.equal(normalizarFocoOpcional("30 70"), "30% 70%");
});

test("backend y frontend (foco.js) producen exactamente el mismo valor", () => {
  assert.ok(EOF_FOCO, "foco.js no expone EOF_FOCO");
  for (const [entrada] of CASOS_VALIDOS) {
    assert.equal(normalizarFoco(entrada), EOF_FOCO.texto(entrada), JSON.stringify(entrada));
  }
  for (const entrada of CASOS_INVALIDOS) {
    assert.equal(normalizarFoco(entrada), EOF_FOCO.texto(entrada), JSON.stringify(entrada));
  }
});

test("la salida es idempotente (normalizar dos veces no cambia nada)", () => {
  for (const [entrada] of CASOS_VALIDOS) {
    const una = normalizarFoco(entrada);
    assert.equal(normalizarFoco(una), una);
  }
});

test("esErrorColumnaFaltante reconoce SQLite/D1 y PostgreSQL", () => {
  assert.equal(esErrorColumnaFaltante(new Error("no such column: avatar_foco")), true);
  assert.equal(esErrorColumnaFaltante(new Error("table users has no column named avatar_foco")), true);
  assert.equal(esErrorColumnaFaltante(new Error('column "avatar_foco" of relation "users" does not exist')), true);
  assert.equal(esErrorColumnaFaltante(Object.assign(new Error("x"), { code: "42703" })), true);
  assert.equal(esErrorColumnaFaltante(new Error("no such column: otra"), "avatar_foco"), false);
  assert.equal(esErrorColumnaFaltante(new Error("database is locked")), false);
});

function envFalso(comportamiento) {
  const llamadas = [];
  return {
    llamadas,
    DB: {
      prepare(sql) {
        let params = [];
        const o = {
          bind(...p) { params = p; return o; },
          async all() {
            llamadas.push({ sql, params });
            return comportamiento(sql, params);
          },
        };
        return o;
      },
    },
  };
}

test("consultaConAlternativas: cae a la variante sin la columna aún sin migrar", async () => {
  const env = envFalso((sql) => {
    if (sql.includes("avatar_foco")) throw new Error("no such column: avatar_foco");
    return { results: [{ id: 1 }] };
  });
  const { results } = await consultaConAlternativas(env, ["SELECT avatar_foco", "SELECT basico"], [7]);
  assert.deepEqual(results, [{ id: 1 }]);
  assert.equal(env.llamadas.length, 2);
  assert.deepEqual(env.llamadas[1].params, [7]);
});

test("consultaConAlternativas: un error que no es de columna se relanza (no se tapa)", async () => {
  const env = envFalso(() => { throw new Error("database is locked"); });
  await assert.rejects(() => consultaConAlternativas(env, ["A", "B"], []), /database is locked/);
  assert.equal(env.llamadas.length, 1);
});

test("consultaConAlternativas: si todas fallan por columna, lanza el último error", async () => {
  const env = envFalso(() => { throw new Error("no such column: x"); });
  await assert.rejects(() => consultaConAlternativas(env, ["A", "B"], []), /no such column/);
  assert.equal(env.llamadas.length, 2);
});
