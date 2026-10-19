// API secundaria (Railway) DESACTIVADA: el Worker principal no debe reenviar nada
// a Railway salvo que SECONDARY_ENABLED === "true" (ver wrangler.toml).
//   node --test tests/secundaria-desactivada.test.mjs
//
// Solo se ejecuta contra worker/src/index.js: worker-secondary/src/index.js se deja
// sin tocar a propósito (reactivable), así que este archivo NO está en la lista de
// WORKER_ENTRY de .github/workflows/tests.yml.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import(new URL("../src/index.js", import.meta.url).href)).default;

const ORIGEN = "https://elotrofutbol.media";
const RAILWAY_FALSO = "http://127.0.0.1:9"; // puerto cerrado: si se usara, fallaría al instante
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

const dbSana = { prepare: () => ({ first: async () => ({ ok: 1 }), bind() { return this; }, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }) };
const dbRota = { prepare: () => { throw new Error("D1 caída (simulada)"); } };

// Espía fetch para saber si alguna vez se intenta llegar a Railway.
async function conEspia(fn) {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, ...resto) => { llamadas.push(String(url)); return original(url, ...resto); };
  try { return { ...(await fn()), llamadas }; } finally { globalThis.fetch = original; }
}
const aRailway = (llamadas) => llamadas.filter((u) => u.includes("127.0.0.1:9") || u.includes("railway")).length;

async function get(env, ruta) {
  const res = await worker.fetch(new Request("https://api.test" + ruta, { headers: { Origin: ORIGEN } }), env, ctx);
  return { res, status: res.status, acao: res.headers.get("Access-Control-Allow-Origin"), backend: res.headers.get("X-Failover-Backend"), data: await res.json().catch(() => ({})) };
}

test("desactivada (por defecto): con D1 caída el error se devuelve tal cual, con CORS, y NO se llama a Railway", async () => {
  const r = await conEspia(() => get({ DB: dbRota, JWT_SECRET: "x", RAILWAY_URL: RAILWAY_FALSO }, "/api/results"));
  assert.ok(r.status >= 500, `esperaba un 5xx, llegó ${r.status}`);
  assert.notEqual(r.backend, "RAILWAY");
  assert.notEqual(r.data.backend, "RAILWAY");
  assert.equal(r.acao, ORIGEN, "el error debe llevar CORS para que el navegador muestre el error real");
  assert.equal(aRailway(r.llamadas), 0);
});

test("desactivada explícitamente (SECONDARY_ENABLED=false): igual que por defecto", async () => {
  const r = await conEspia(() => get({ DB: dbRota, JWT_SECRET: "x", SECONDARY_ENABLED: "false", RAILWAY_URL: RAILWAY_FALSO }, "/api/results"));
  assert.ok(r.status >= 500);
  assert.notEqual(r.backend, "RAILWAY");
  assert.equal(aRailway(r.llamadas), 0);
});

test("control: con SECONDARY_ENABLED=true el mismo fallo SÍ se reenvía a Railway", async () => {
  const r = await conEspia(() => get({ DB: dbRota, JWT_SECRET: "x", SECONDARY_ENABLED: "true", RAILWAY_URL: RAILWAY_FALSO }, "/api/results"));
  assert.equal(r.status, 503);
  assert.equal(r.data.backend, "RAILWAY");
  assert.ok(aRailway(r.llamadas) >= 1);
});

test("desactivada: FAILOVER_TEST=1 se ignora y la petición la atiende el principal", async () => {
  const r = await conEspia(() => get({ DB: dbSana, JWT_SECRET: "x", FAILOVER_TEST: "1", RAILWAY_URL: RAILWAY_FALSO }, "/api/health"));
  assert.equal(r.status, 200);
  assert.equal(r.data.api, "primary"); // /api/health responde el propio principal (antes del bloque de failover)
  assert.notEqual(r.backend, "RAILWAY");
  assert.equal(aRailway(r.llamadas), 0);
});

test("control: FAILOVER_TEST=1 con SECONDARY_ENABLED=true sí desvía a Railway", async () => {
  const r = await conEspia(() => get({ DB: dbSana, JWT_SECRET: "x", FAILOVER_TEST: "1", SECONDARY_ENABLED: "true", RAILWAY_URL: RAILWAY_FALSO }, "/api/health"));
  assert.equal(r.status, 503);
  assert.equal(r.data.backend, "RAILWAY");
});
