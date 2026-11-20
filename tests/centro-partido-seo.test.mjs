// SEO del centro de partido (/minuto-a-minuto?id=N) en el worker del SITIO (public/src-worker.js):
// título/description por estado, una sola etiqueta robots, JSON-LD del partido sin el genérico de la
// plantilla, contenido visible para bots y enlaces desde las listas de partidos.
//   node --no-warnings --test tests/centro-partido-seo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const origen = readFileSync(new URL("../../public/src-worker.js", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "centro-seo-"));
const archivo = join(dir, "sw.mjs");
writeFileSync(archivo, origen + "\nexport { inyectarMinutoAMinutoParaBot, seoDatosCentroPartido, seoTituloCentroPartido, seoDescripcionCentroPartido, construirListaPartidosParaBot };\n");
const sw = await import(pathToFileURL(archivo).href);
const plantilla = readFileSync(new URL("../../public/minuto-a-minuto.html", import.meta.url), "utf8");

const base = {
  id: 42, equipo_local: "CD Lugo", equipo_visitante: "Real Valladolid CF", goles_local: 2, goles_visitante: 1,
  estado: "finalizado", competicion: "hypermotion", jornada: 9, fecha_partido: "2026-11-14T18:00", ubicacion: "Anxo Carro",
  escudo_local_url: null, escudo_visitante_url: null,
};
const eventos = [
  { tipo: "gol", equipo: "local", jugador: "Pablo Gómez", minuto: 12, es_penalti: 0 },
  { tipo: "gol", equipo: "visitante", jugador: "Iván <script>", minuto: 40, es_penalti: 1 },
  { tipo: "gol_pp", equipo: "visitante", jugador: "Álvaro Ruiz", minuto: 77, minuto_extra: null },
  { tipo: "roja", equipo: "local", jugador: "Marcos Díaz", minuto: 88 },
  { tipo: "amarilla", equipo: "local", jugador: "Nadie Debería", minuto: 30 },
];
const cuenta = (html, re) => (html.match(re) || []).length;

test("título: por estado, con marca y sin pasar de ~66 caracteres", () => {
  const t = (p) => sw.seoTituloCentroPartido(sw.seoDatosCentroPartido({ ...base, ...p }), "ELOTROFÚTBOLTV");
  // Con estos nombres el descriptor no cabe en 66: se queda con «cruce (final) — marca».
  assert.equal(t({}), "CD Lugo 2-1 Real Valladolid CF (final) — ELOTROFÚTBOLTV");
  // Con nombres algo más cortos cabe «minuto a minuto»; con muy cortos, el descriptor completo.
  assert.equal(t({ equipo_local: "Lugo", equipo_visitante: "Eibar" }), "Lugo 2-1 Eibar (final) — minuto a minuto — ELOTROFÚTBOLTV");
  assert.equal(t({ equipo_local: "Pau", equipo_visitante: "Ibi" }), "Pau 2-1 Ibi (final) — resultado y minuto a minuto — ELOTROFÚTBOLTV");
  assert.ok(t({}).length <= 66, t({}));
  assert.ok(t({ estado: "en_juego" }).startsWith("EN DIRECTO: CD Lugo 2-1 Real Valladolid CF"));
  assert.equal(t({ estado: "programado", goles_local: null, goles_visitante: null }), "CD Lugo - Real Valladolid CF — previa y directo — ELOTROFÚTBOLTV");
  assert.equal(t({ estado: "programado", goles_local: null, goles_visitante: null, equipo_local: "Lugo", equipo_visitante: "Eibar" }), "Lugo - Eibar — 14 de noviembre, previa y directo — ELOTROFÚTBOLTV");
  assert.match(t({ estado: "anulado", goles_local: null, goles_visitante: null }), /\(aplazado\)/);
  // Nombres larguísimos: cae a una versión corta, nunca queda vacío.
  const largo = t({ equipo_local: "Club Deportivo Atlético Muy Largo de la Ciudad", equipo_visitante: "Sociedad Deportiva Recreativa Todavía Más Larga" });
  assert.ok(largo.includes("Club Deportivo Atlético Muy Largo de la Ciudad"));
});

test("description: arranca por el cruce y cuenta qué hay según el estado", () => {
  const d = (p) => sw.seoDescripcionCentroPartido(sw.seoDatosCentroPartido({ ...base, ...p }));
  assert.match(d({}), /^Resultado final: CD Lugo 2-1 Real Valladolid CF \(LaLiga Hypermotion, jornada 9\), 14 de noviembre de 2026\./);
  assert.match(d({ estado: "en_juego" }), /^En directo: CD Lugo 2-1/);
  assert.match(d({ estado: "programado", goles_local: null, goles_visitante: null }), /el 14 de noviembre a las 18:00 en Anxo Carro\./);
  assert.match(d({ estado: "anulado", goles_local: null, goles_visitante: null }), /aplazado, pendiente de nueva fecha/);
  assert.ok(d({}).length <= 161);
  // Un programado con goles a null no inventa «0-0».
  assert.ok(!/0-0/.test(d({ estado: "programado", goles_local: null, goles_visitante: null })));
});

test("HTML para bots: una sola robots, un solo canonical, JSON-LD del partido y sin el genérico", () => {
  const html = sw.inyectarMinutoAMinutoParaBot(plantilla, "42", base, eventos);
  assert.equal(cuenta(html, /<meta name="robots"/g), 1, "robots duplicada");
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">/);
  assert.equal(cuenta(html, /<link rel="canonical"/g), 1);
  assert.ok(html.includes('<link rel="canonical" href="https://elotrofutbol.media/minuto-a-minuto?id=42">'));
  assert.equal(cuenta(html, /<title id="pageTitle">/g), 1);
  assert.equal(cuenta(html, /id="seo-jsonld-pagina"/g), 1);
  assert.equal(cuenta(html, /id="seo-jsonld-sportsevent"/g), 1);
  assert.equal(cuenta(html, /id="seo-jsonld-breadcrumb"/g), 1);
  assert.ok(!html.includes("Centro de partido: minuto a minuto, resumen, alineaciones, crónica y fotos de cada partido"), "queda la description genérica");
  const bloques = [...html.matchAll(/<script type="application\/ld\+json" id="([^"]+)">([\s\S]*?)<\/script>/g)];
  const ld = Object.fromEntries(bloques.map((m) => [m[1], JSON.parse(m[2])]));
  assert.equal(ld["seo-jsonld-sportsevent"]["@type"], "SportsEvent");
  assert.equal(ld["seo-jsonld-sportsevent"].name, "CD Lugo - Real Valladolid CF");
  assert.equal(ld["seo-jsonld-sportsevent"].startDate.slice(0, 16), "2026-11-14T18:00");
  assert.equal(ld["seo-jsonld-sportsevent"].eventStatus, "https://schema.org/EventScheduled");
  assert.equal(ld["seo-jsonld-pagina"].url, "https://elotrofutbol.media/minuto-a-minuto?id=42");
  assert.equal(ld["seo-jsonld-breadcrumb"].itemListElement.length, 3);
});

test("HTML para bots: aplazado = EventPostponed; sin cubrir = noindex, follow", () => {
  const aplaz = sw.inyectarMinutoAMinutoParaBot(plantilla, "42", { ...base, estado: "anulado", goles_local: null, goles_visitante: null }, []);
  assert.match(aplaz, /"eventStatus":"https:\/\/schema\.org\/EventPostponed"/);
  assert.ok(!/"startDate"/.test(aplaz.match(/id="seo-jsonld-sportsevent">([\s\S]*?)<\/script>/)[1]), "un aplazado no anuncia fecha");
  const sin = sw.inyectarMinutoAMinutoParaBot(plantilla, "42", { ...base, finalizado_no_cubierto: 1 }, []);
  assert.equal(cuenta(sin, /<meta name="robots"/g), 1);
  assert.match(sin, /<meta name="robots" content="noindex, follow">/);
});

test("HTML para bots: contenido visible con goles y expulsiones, escapado, sin esqueleto", () => {
  const html = sw.inyectarMinutoAMinutoParaBot(plantilla, "42", base, eventos);
  assert.ok(!html.includes('class="mam-skel"'), "sigue el esqueleto de carga");
  assert.ok(!html.includes("<!--mam-skel-->"));
  const cuerpo = html.match(/<article class="mam-seo-bot">([\s\S]*?)<\/article>/)[1];
  assert.match(cuerpo, /<h3>Goles<\/h3>/);
  assert.match(cuerpo, /12&#39; Pablo Gómez \(CD Lugo\)/);
  assert.match(cuerpo, /40&#39; Iván &lt;script&gt; \(pen\.\) \(Real Valladolid CF\)/);
  // El gol en propia puerta del visitante es del local (mismo criterio que mamGoleadoresHTML).
  assert.match(cuerpo, /77&#39; Álvaro Ruiz \(p\.p\.\) \(CD Lugo\)/);
  assert.match(cuerpo, /<h3>Tarjetas rojas<\/h3>[\s\S]*88&#39; Marcos Díaz \(CD Lugo\)/);
  assert.ok(!cuerpo.includes("Nadie Debería"), "las amarillas no salen");
  assert.ok(!cuerpo.includes("<script>"), "texto sin escapar");
  assert.ok(!cuerpo.includes("…"), "el texto visible no se corta como la meta description");
  assert.match(cuerpo, /<time datetime="2026-11-14">14 de noviembre de 2026<\/time> · 18:00 h/);
  assert.match(cuerpo, /Estadio: Anxo Carro/);
  assert.match(cuerpo, /href="https:\/\/elotrofutbol\.media\/calendario"/);
  assert.match(cuerpo, /href="https:\/\/elotrofutbol\.media\/categoria\?cat=hypermotion"/);
  // Programado: sin goles aunque la API devolviera eventos.
  const prog = sw.inyectarMinutoAMinutoParaBot(plantilla, "42", { ...base, estado: "programado", goles_local: null, goles_visitante: null }, eventos);
  assert.ok(!prog.includes("<h3>Goles</h3>"));
});

test("listas de partidos para bots: el cruce enlaza al centro de partido (sin .html)", () => {
  const html = sw.construirListaPartidosParaBot([base, { ...base, id: undefined, equipo_local: "Sin Id" }], { conMarcador: true });
  assert.match(html, /<a href="https:\/\/elotrofutbol\.media\/minuto-a-minuto\?id=42">CD Lugo <strong>2-1<\/strong> Real Valladolid CF<\/a>/);
  assert.ok(!/\.html/.test(html));
  assert.match(html, /<li>Sin Id <strong>2-1<\/strong>/);
});

test("página sin plantilla reconocible o sin equipos: se devuelve tal cual", () => {
  assert.equal(sw.inyectarMinutoAMinutoParaBot("<html></html>", "42", base, []), "<html></html>");
  assert.equal(sw.inyectarMinutoAMinutoParaBot(plantilla, "42", { ...base, equipo_local: "" }, []), plantilla);
});

// El navegador (mamSeoCentro en minuto-a-minuto.html) y el worker deben producir EXACTAMENTE el
// mismo título y description: si no, lo que Googlebot lee en el HTML del worker cambiaría al
// ejecutarse el JS de la página.
test("paridad: mamSeoCentro (navegador) == worker en título y description", () => {
  const ini = plantilla.indexOf("function mamSeoCentro(p) {");
  const fin = plantilla.indexOf("\n}\n", ini) + 3;
  assert.ok(ini > 0 && fin > ini, "no se encuentra mamSeoCentro en la página");
  const config = readFileSync(new URL("../../public/js/config.js", import.meta.url), "utf8");
  const categorias = new Function(`${config.match(/const CATEGORIES = \{[\s\S]*?\n\};/)[0]}; return CATEGORIES;`)();
  const categoriaLabel = (c) => categorias[c] || (String(c ?? "").replace(/[_-]+/g, " ").trim().replace(/^./, (x) => x.toUpperCase()));
  const mamSeoCentro = new Function("categoriaLabel", `${plantilla.slice(ini, fin)}; return mamSeoCentro;`)(categoriaLabel);
  const casos = [
    base,
    { ...base, estado: "en_juego" },
    { ...base, estado: "programado", goles_local: null, goles_visitante: null },
    { ...base, estado: "programado", goles_local: null, goles_visitante: null, fecha_partido: "2026-11-21", ubicacion: "" },
    { ...base, estado: "anulado", goles_local: null, goles_visitante: null },
    { ...base, competicion: "segunda_federacion", grupo: "1", jornada: 3 },
    { ...base, competicion: "amistoso", jornada: 0 },
    { ...base, competicion: "liga_rara", jornada_mostrar: "Final" },
    { ...base, equipo_local: "Club Deportivo Atlético Muy Largo de la Ciudad", equipo_visitante: "Sociedad Deportiva Recreativa Todavía Más Larga" },
    { ...base, equipo_local: "Pau", equipo_visitante: "Ibi" },
    { ...base, fecha_partido: null, ubicacion: null, estadio: "Municipal" },
  ];
  for (const p of casos) {
    const d = sw.seoDatosCentroPartido(p);
    const nav = mamSeoCentro(p);
    assert.equal(nav.titulo, sw.seoTituloCentroPartido(d, "ELOTROFÚTBOLTV"), `título distinto en ${JSON.stringify(p)}`);
    assert.equal(nav.descripcion, sw.seoDescripcionCentroPartido(d), `description distinta en ${JSON.stringify(p)}`);
  }
});

// ---- Ruta completa del worker (bot simulado, ASSETS y API simulados) ----
const UA_BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const UA_NORMAL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36";
function entornoSimulado() {
  return {
    ASSETS: {
      fetch: async (req) => {
        const ruta = new URL(req.url).pathname;
        if (ruta === "/minuto-a-minuto" || ruta === "/minuto-a-minuto.html") {
          return new Response(plantilla, { status: 200, headers: { "Content-Type": "text/html; charset=UTF-8" } });
        }
        return new Response("no encontrado", { status: 404, headers: { "Content-Type": "text/html" } });
      },
    },
  };
}
async function conApi(respuestas, fn) {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (u) => {
    const ruta = String(u).replace("https://api.elotrofutbol.media", "");
    llamadas.push(ruta);
    const r = respuestas[ruta];
    if (!r) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(r.cuerpo), { status: r.status || 200, headers: { "Content-Type": "application/json" } });
  };
  try { return await fn(llamadas); } finally { globalThis.fetch = original; }
}
const pedirSitio = (ruta, ua) => sw.default.fetch(new Request("https://elotrofutbol.media" + ruta, { headers: { "User-Agent": ua } }), entornoSimulado(), { waitUntil() {} });

test("ruta: un bot recibe metadatos reales del partido y sus goles (partido y eventos pedidos a la vez)", async () => {
  await conApi({
    "/api/results/42?ligero=1": { cuerpo: { resultado: base } },
    "/api/results/42/eventos": { cuerpo: { eventos } },
  }, async (llamadas) => {
    const r = await pedirSitio("/minuto-a-minuto?id=42", UA_BOT);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Vary"), "User-Agent");
    const html = await r.text();
    assert.match(html, /<title id="pageTitle">CD Lugo 2-1 Real Valladolid CF \(final\) — ELOTROFÚTBOLTV<\/title>/);
    assert.match(html, /12&#39; Pablo Gómez \(CD Lugo\)/);
    assert.deepEqual([...llamadas].sort(), ["/api/results/42/eventos", "/api/results/42?ligero=1"]);
  });
});

test("ruta: si falla la API de eventos se sirve igualmente el partido (sin goles)", async () => {
  await conApi({ "/api/results/42?ligero=1": { cuerpo: { resultado: base } } }, async () => {
    const html = await (await pedirSitio("/minuto-a-minuto?id=42", UA_BOT)).text();
    assert.match(html, /<title id="pageTitle">CD Lugo 2-1/);
    assert.ok(!html.includes("<h3>Goles</h3>"));
  });
});

test("ruta: partido inexistente = 404 real; sin id = noindex por cabecera; usuario normal = HTML intacto", async () => {
  await conApi({ "/api/results/999?ligero=1": { status: 404, cuerpo: { error: "no" } }, "/api/results/999/eventos": { cuerpo: { eventos: [] } } }, async () => {
    const r = await pedirSitio("/minuto-a-minuto?id=999", UA_BOT);
    assert.equal(r.status, 404);
  });
  const sinId = await pedirSitio("/minuto-a-minuto", UA_BOT);
  assert.equal(sinId.status, 200);
  assert.equal(sinId.headers.get("X-Robots-Tag"), "noindex, follow");
  const basura = await pedirSitio("/minuto-a-minuto?id=abc", UA_BOT);
  assert.equal(basura.headers.get("X-Robots-Tag"), "noindex, follow");
  const normal = await pedirSitio("/minuto-a-minuto?id=42", UA_NORMAL);
  assert.equal(normal.headers.get("X-Robots-Tag"), null);
  assert.equal(await normal.text(), plantilla, "un lector normal recibe el HTML sin tocar");
});
