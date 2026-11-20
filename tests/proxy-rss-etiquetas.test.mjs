// Worker del SITIO (public/src-worker.js): proxy de RSS filtrados y sitemap de etiquetas, y el
// <head> que reciben los bots en /etiqueta/<slug>. Uso:  node --no-warnings --test tests/proxy-rss-etiquetas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const origen = readFileSync(new URL("../../public/src-worker.js", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "rss-"));
const archivo = join(dir, "sw.mjs");
writeFileSync(archivo, origen + "\nexport { servirFeedDesdeApi, RSS_FILTRADO_RE, CFG_RSS_FILTRADO, FEED_MEM, FEEDS_API, inyectarEtiquetaParaBot };\n");
const { servirFeedDesdeApi, RSS_FILTRADO_RE, CFG_RSS_FILTRADO, FEED_MEM, FEEDS_API, inyectarEtiquetaParaBot } = await import(pathToFileURL(archivo).href);

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title></item></channel></rss>`;
const SITEMAP_VACIO = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
let llamadas = [];
function simularApi(fn) {
  llamadas = [];
  globalThis.fetch = async (url) => { llamadas.push(String(url)); return fn(String(url)); };
}
const ctx = { waitUntil: () => {} };

test("RSS_FILTRADO_RE: solo /rss/<tipo>/<x>.xml con tipo y caracteres válidos", () => {
  for (const ok of ["/rss/categoria/primera-federacion.xml", "/rss/club/real-oviedo.xml", "/rss/autor/12.xml", "/rss/etiqueta/ascenso-2026.xml"]) assert.ok(RSS_FILTRADO_RE.test(ok), ok);
  for (const mal of ["/rss/otro/x.xml", "/rss/club/.xml", "/rss/club/a/b.xml", "/rss/club/x.xml?y", "/rss/club/Real%20Oviedo.xml", "/rss.xml", `/rss/club/${"a".repeat(81)}.xml`]) assert.ok(!RSS_FILTRADO_RE.test(mal), mal);
});

test("feed filtrado: 200 con tipo RSS y la segunda petición sale de caché", async () => {
  FEED_MEM.clear();
  simularApi(() => new Response(RSS, { status: 200 }));
  const r1 = await servirFeedDesdeApi("/rss/etiqueta/uno.xml", ctx, CFG_RSS_FILTRADO);
  assert.equal(r1.status, 200);
  assert.match(r1.headers.get("Content-Type"), /application\/rss\+xml/);
  assert.equal(await r1.text(), RSS);
  const r2 = await servirFeedDesdeApi("/rss/etiqueta/uno.xml", ctx, CFG_RSS_FILTRADO);
  assert.equal(r2.headers.get("X-Feed-Cache"), "HIT");
  assert.equal(llamadas.length, 1);
});

test("filtro inexistente o sin noticias: 404 (no 503) y no se guarda en memoria", async () => {
  FEED_MEM.clear();
  simularApi(() => new Response("no", { status: 404 }));
  const r = await servirFeedDesdeApi("/rss/etiqueta/nada.xml", ctx, CFG_RSS_FILTRADO);
  assert.equal(r.status, 404);
  assert.equal(FEED_MEM.has("/rss/etiqueta/nada.xml"), false);
});

test("API caída y sin copia: 503 con Retry-After", async () => {
  FEED_MEM.clear();
  simularApi(() => new Response("boom", { status: 500 }));
  const r = await servirFeedDesdeApi("/rss/club/real-oviedo.xml", ctx, CFG_RSS_FILTRADO);
  assert.equal(r.status, 503);
  assert.ok(r.headers.get("Retry-After"));
});

test("API caída con copia vieja: se sirve la última copia buena (STALE)", async () => {
  FEED_MEM.clear();
  FEED_MEM.set("/rss/club/real-oviedo.xml", { cuerpo: RSS, t: Date.now() - 3 * 60 * 60 * 1000 });
  simularApi(() => new Response("boom", { status: 500 }));
  const r = await servirFeedDesdeApi("/rss/club/real-oviedo.xml", ctx, CFG_RSS_FILTRADO);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Feed-Cache"), "STALE");
});

test("la memoria de feeds está acotada (muchos filtros distintos)", async () => {
  FEED_MEM.clear();
  simularApi(() => new Response(RSS, { status: 200 }));
  for (let i = 0; i < 350; i++) await servirFeedDesdeApi(`/rss/etiqueta/t${i}.xml`, ctx, CFG_RSS_FILTRADO);
  assert.ok(FEED_MEM.size <= 300, `tamaño ${FEED_MEM.size}`);
  assert.ok(FEED_MEM.has("/rss/etiqueta/t349.xml"), "se conserva lo más reciente");
});

test("/sitemap-etiquetas.xml está en la tabla y se acepta vacío; el sitemap de noticias vacío no", async () => {
  assert.ok(FEEDS_API["/sitemap-etiquetas.xml"]);
  FEED_MEM.clear();
  simularApi(() => new Response(SITEMAP_VACIO, { status: 200 }));
  const ok = await servirFeedDesdeApi("/sitemap-etiquetas.xml", ctx);
  assert.equal(ok.status, 200);
  FEED_MEM.clear();
  const noticias = await servirFeedDesdeApi("/sitemap-noticias.xml", ctx);
  assert.equal(noticias.status, 503, "vacío = fallo de la API, no se publica");
});

const HTML = `<html><head><title id="pageTitle">Etiqueta — X</title><meta name="robots" content="index"></head><body><div class="estado-info"><div class="spinner"></div><p>Cargando...</p></div></body></html>`;
test("bots en /etiqueta/<slug>: head real, canonical, RSS y listado; XSS escapado", () => {
  const html = inyectarEtiquetaParaBot(HTML, { nombre: 'Derbi <b>"x"', slug: "derbi-b-x", total: 3 }, true,
    [{ slug: "n1", categoria: "general", titulo: "Titular <script>1" }]);
  assert.match(html, /<link rel="canonical" href="[^"]*\/etiqueta\/derbi-b-x">/);
  assert.match(html, /rel="alternate" type="application\/rss\+xml"[^>]*\/rss\/etiqueta\/derbi-b-x\.xml/);
  assert.ok(!html.includes("<b>") && !html.includes("<script>1"));
  assert.match(html, /3 noticias/);
  assert.ok(!html.includes("Cargando..."));
});
test("etiqueta con una sola noticia: noindex", () => {
  const html = inyectarEtiquetaParaBot(HTML, { nombre: "Solo", slug: "solo", total: 1 }, false, []);
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.ok(!/content="index, follow/.test(html));
});
