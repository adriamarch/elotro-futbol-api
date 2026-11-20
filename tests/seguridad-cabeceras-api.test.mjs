// Cabeceras de seguridad de la API y comprobación de host de Cloudinary.
//   node --no-warnings --test tests/seguridad-cabeceras-api.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/seguridad-cabeceras-api.test.mjs
//
// Qué protege:
//   1. TODA respuesta de la API (JSON, errores, 401, preflight) lleva
//      X-Content-Type-Options: nosniff y Referrer-Policy, sin pisar el CORS
//      ni el "no-store" que ya tenían.
//   2. precalentarVistaPreviaProgramada() solo hace fetch() si el HOST de la
//      imagen es res.cloudinary.com: antes bastaba con que ese texto
//      apareciera en cualquier parte de la URL (SSRF blando desde el path de
//      otro dominio).
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url)
  : new URL("../src/index.js", import.meta.url);
const worker = (await import(entrada.href)).default;
const fuente = fs.readFileSync(entrada, "utf-8");

const ORIGEN = "https://elotrofutbol.media";
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const dbSana = {
  prepare: () => ({
    first: async () => ({ ok: 1 }),
    bind() { return this; },
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 0 } }),
  }),
};
const dbRota = { prepare: () => { throw new Error("D1 caída (simulada)"); } };

function comprobarCabeceras(res, etiqueta) {
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff", `${etiqueta}: falta nosniff`);
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", `${etiqueta}: falta Referrer-Policy`);
}

test("respuestas JSON de la API llevan nosniff + Referrer-Policy y conservan CORS y no-store", async () => {
  const res = await worker.fetch(
    new Request("https://api.test/api/results", { headers: { Origin: ORIGEN } }),
    { DB: dbSana, JWT_SECRET: "x".repeat(32) },
    ctx
  );
  comprobarCabeceras(res, "GET /api/results");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGEN);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("los errores (401 sin sesión, 5xx por base caída, ruta inexistente) también las llevan", async () => {
  const env401 = { DB: dbSana, JWT_SECRET: "x".repeat(32) };
  const r401 = await worker.fetch(new Request("https://api.test/api/media", { headers: { Origin: ORIGEN } }), env401, ctx);
  assert.ok([401, 403].includes(r401.status), `esperaba 401/403 en /api/media sin sesión, llegó ${r401.status}`);
  comprobarCabeceras(r401, "401 sin sesión");

  // URL distinta a la del test anterior: si no, la caché pública del propio
  // worker serviría esa respuesta 200 en vez de tocar la base caída.
  const r5xx = await worker.fetch(
    new Request("https://api.test/api/results?sin-cache=" + Date.now(), { headers: { Origin: ORIGEN } }),
    { DB: dbRota, JWT_SECRET: "x".repeat(32) },
    ctx
  );
  assert.ok(r5xx.status >= 500, `esperaba 5xx, llegó ${r5xx.status}`);
  comprobarCabeceras(r5xx, "error 5xx");

  const r404 = await worker.fetch(new Request("https://api.test/api/no-existe-esta-ruta", { headers: { Origin: ORIGEN } }), env401, ctx);
  comprobarCabeceras(r404, "ruta inexistente");
});

test("el preflight OPTIONS las lleva y no deja pasar un origen ajeno", async () => {
  const ok = await worker.fetch(
    new Request("https://api.test/api/results", { method: "OPTIONS", headers: { Origin: ORIGEN } }),
    { DB: dbSana, JWT_SECRET: "x".repeat(32) },
    ctx
  );
  assert.equal(ok.status, 204);
  comprobarCabeceras(ok, "OPTIONS");
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGEN);

  const ajeno = await worker.fetch(
    new Request("https://api.test/api/results", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    { DB: dbSana, JWT_SECRET: "x".repeat(32) },
    ctx
  );
  assert.equal(ajeno.headers.get("Access-Control-Allow-Origin"), null, "un origen ajeno no debe recibir Allow-Origin");
  comprobarCabeceras(ajeno, "OPTIONS origen ajeno");
});

// ---------- Host de Cloudinary ----------
const ini = fuente.indexOf("async function medidasFotoCloudinaryApi");
const iniFn = fuente.indexOf("function precalentarVistaPreviaProgramada", ini);
assert.ok(ini >= 0 && iniFn > ini, "no encuentro precalentarVistaPreviaProgramada en " + entrada.pathname);
const finFn = fuente.indexOf("\n}\n", iniFn) + 3;

// Helpers de foco que usa el precalentado (validador del backend + cálculo del recorte).
const iniFoco = fuente.indexOf("// ---------- FOCO DE IMAGEN: validador ÚNICO del backend");
const finFoco = fuente.indexOf("// true si el error es por una columna que aún no existe", iniFoco);
const iniRec = fuente.indexOf("function focoCloudinarySimple");
const finRec = fuente.indexOf("// Imagen de portada recortada 16:9", iniRec);
assert.ok(iniFoco >= 0 && finFoco > iniFoco && iniRec >= 0 && finRec > iniRec, "no encuentro los helpers de foco en " + entrada.pathname);
const CODIGO_FOCO = fuente.slice(iniFoco, finFoco) + "\n" + fuente.slice(iniRec, finRec) + "\n";

function precalentar(imagenPortada) {
  const llamadas = [];
  const sandbox = {
    esItemNoFoto: () => false,
    focoDePortada: () => "50% 50%",
    AbortController, setTimeout, clearTimeout,
    URL,
    fetch: async (u) => { llamadas.push(String(u)); return { arrayBuffer: async () => new ArrayBuffer(0) }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO_FOCO + fuente.slice(ini, finFn) + "\nthis.precalentar = precalentarVistaPreviaProgramada;", sandbox);
  const esperas = [];
  sandbox.precalentar({ waitUntil: (p) => esperas.push(p) }, "2026-12-01 10:00:00", imagenPortada, []);
  return { llamadas, esperas };
}

test("Cloudinary legítimo: se pide la miniatura social transformada", async () => {
  const { llamadas, esperas } = precalentar("https://res.cloudinary.com/vovompqx/image/upload/v1/portada.jpg");
  await Promise.all(esperas);
  // Además de la miniatura se piden las medidas de la foto (fl_getinfo) para decidir el encuadre
  // sin foco; las dos peticiones van SOLO al host res.cloudinary.com.
  assert.ok(llamadas.every((u) => u.startsWith("https://res.cloudinary.com/vovompqx/image/upload/")), llamadas.join("\n"));
  const miniaturas = llamadas.filter((u) => !u.includes("fl_getinfo"));
  assert.equal(miniaturas.length, 1);
  assert.match(miniaturas[0], /^https:\/\/res\.cloudinary\.com\/vovompqx\/image\/upload\/f_jpg,/);
});

test("URLs que solo CONTIENEN 'res.cloudinary.com' fuera del host NO se piden", async () => {
  const trampas = [
    "https://evil.example/res.cloudinary.com/image/upload/x.jpg",
    "https://res.cloudinary.com.evil.example/image/upload/x.jpg",
    "https://evil.example/?u=res.cloudinary.com/upload/x.jpg",
    "http://169.254.169.254/res.cloudinary.com/upload/latest",
    "not a url res.cloudinary.com/upload/",
  ];
  for (const url of trampas) {
    const { llamadas, esperas } = precalentar(url);
    await Promise.all(esperas);
    assert.equal(llamadas.length, 0, `no debía hacer fetch a: ${url}`);
  }
});
