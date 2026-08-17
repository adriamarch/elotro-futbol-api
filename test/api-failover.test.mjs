
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const configSource = fs.readFileSync(
  new URL("../../public/js/config.js", import.meta.url),
  "utf8"
);

function createHarness(fetchImpl) {
  const window = { EOF_SECONDARY_API_URL: "https://secondary.example.test" };
  const context = {
    window,
    console,
    fetch: fetchImpl,
    Response,
    Headers,
    URL,
    AbortController,
    DOMException,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    Date,
    JSON,
    Math,
    String,
    Boolean,
    Number,
    Object,
    Array,
    Promise,
    Error,
    TypeError,
  };
  vm.createContext(context);
  vm.runInContext(configSource, context, { filename: "config.js" });
  return context;
}

test("GET: error de red en primaria hace failover a secundaria", async () => {
  const calls = [];
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://primary.example.test")) {
      throw new TypeError("network");
    }
    return new Response(JSON.stringify({ ok: true, source: "secondary" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  // Sustituimos la primaria por una URL controlada para la prueba.
  vm.runInContext(`
    // PRIMARY_API es const; el test reconfigura apiOrigin directamente.
    const _apiOriginOriginal = apiOrigin;
    apiOrigin = (which) => which === "SECONDARY"
      ? "https://secondary.example.test"
      : "https://primary.example.test";
  `, ctx);

  const response = await vm.runInContext(
    `apiFetch("/api/articles")`,
    ctx
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    "https://primary.example.test/api/articles",
    "https://secondary.example.test/api/articles",
  ]);
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.active`, ctx), "SECONDARY");
});

test("GET: 401 no hace failover", async () => {
  const calls = [];
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  });
  vm.runInContext(`
    apiOrigin = (which) => which === "SECONDARY"
      ? "https://secondary.example.test"
      : "https://primary.example.test";
  `, ctx);

  const response = await vm.runInContext(`apiFetch("/api/me")`, ctx);
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://primary.example.test/api/me");
});

test("POST: timeout/error de red no se duplica en secundaria", async () => {
  const calls = [];
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    throw new TypeError("network");
  });
  vm.runInContext(`
    apiOrigin = (which) => which === "SECONDARY"
      ? "https://secondary.example.test"
      : "https://primary.example.test";
  `, ctx);

  await assert.rejects(
    vm.runInContext(`apiFetch("/api/articles", { method: "POST" })`, ctx)
  );
  assert.deepEqual(calls, ["https://primary.example.test/api/articles"]);
});

test("Circuit breaker: tres fallos abren el circuito y la siguiente lectura evita primaria", async () => {
  const calls = [];
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://primary.example.test")) {
      throw new TypeError("network");
    }
    return new Response("{}", { status: 200 });
  });
  vm.runInContext(`
    apiOrigin = (which) => which === "SECONDARY"
      ? "https://secondary.example.test"
      : "https://primary.example.test";
  `, ctx);

  for (let i = 0; i < 3; i++) {
    await vm.runInContext(`apiFetch("/api/articles")`, ctx);
  }

  assert.equal(vm.runInContext(`API_FAILOVER_STATE.circuit`, ctx), "OPEN");

  calls.length = 0;
  const response = await vm.runInContext(`apiFetch("/api/articles")`, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://secondary.example.test/api/articles"]);
});


test("GET: 502/503/504 de primaria hacen failover a secundaria", async () => {
  for (const status of [502, 503, 504]) {
    const calls = [];
    const ctx = createHarness(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("https://primary.example.test")) {
        return new Response("upstream", { status });
      }
      return new Response("secondary-ok", { status: 200 });
    });
    vm.runInContext(`apiOrigin = (which) => which === "SECONDARY"
      ? "https://secondary.example.test"
      : "https://primary.example.test";`, ctx);
    const response = await vm.runInContext(`apiFetch("/api/articles")`, ctx);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://primary.example.test/api/articles",
      "https://secondary.example.test/api/articles",
    ]);
  }
});

test("GET: 404 no hace failover", async () => {
  const calls = [];
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    return new Response("not found", { status: 404 });
  });
  vm.runInContext(`apiOrigin = (which) => which === "SECONDARY"
    ? "https://secondary.example.test"
    : "https://primary.example.test";`, ctx);
  const response = await vm.runInContext(`apiFetch("/api/missing")`, ctx);
  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["https://primary.example.test/api/missing"]);
});

test("Recuperación: tras abrir circuito, dos respuestas positivas de primaria lo cierran", async () => {
  const calls = [];
  let primaryShouldFail = true;
  const ctx = createHarness(async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://primary.example.test") && primaryShouldFail) {
      throw new TypeError("network");
    }
    return new Response("ok", { status: 200 });
  });
  vm.runInContext(`apiOrigin = (which) => which === "SECONDARY"
    ? "https://secondary.example.test"
    : "https://primary.example.test";`, ctx);

  for (let i = 0; i < 3; i++) {
    await vm.runInContext(`apiFetch("/api/articles")`, ctx);
  }
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.circuit`, ctx), "OPEN");

  primaryShouldFail = false;
  vm.runInContext(`API_FAILOVER_STATE.openedAt = Date.now() - API_FAILOVER_CONFIG.openCircuitMs - 1`, ctx);
  await vm.runInContext(`apiFetch("/api/articles")`, ctx);
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.recoverySuccesses`, ctx), 1);
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.circuit`, ctx), "OPEN");

  vm.runInContext(`API_FAILOVER_STATE.openedAt = Date.now() - API_FAILOVER_CONFIG.openCircuitMs - 1`, ctx);
  await vm.runInContext(`apiFetch("/api/articles")`, ctx);
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.recoverySuccesses`, ctx), 2);
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.circuit`, ctx), "CLOSED");
  assert.equal(vm.runInContext(`API_FAILOVER_STATE.active`, ctx), "PRIMARY");
  assert.ok(calls.some((url) => url === "https://primary.example.test/api/articles"));
});
