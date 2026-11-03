// SEO de noticias en el worker del SITIO (public/src-worker.js): description sin
// entidades HTML, idioma servido solo si hay traducción real y canonical
// autorreferenciado por idioma. Uso:  node --test tests/seo-noticia.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// El worker solo exporta "default"; se añade un export temporal con las funciones puras.
const origen = readFileSync(new URL("../../public/src-worker.js", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "seo-"));
const archivo = join(dir, "sw.mjs");
writeFileSync(archivo, origen + "\nexport { construirMetaNoticia, textoPlanoDesdeHtmlSeo, idiomaServidoSeo, quitarDatelineSeo };\n");
const { construirMetaNoticia, textoPlanoDesdeHtmlSeo, idiomaServidoSeo, quitarDatelineSeo } = await import(pathToFileURL(archivo).href);

const cronica = {
  tipo: "cronica", categoria: "hypermotion", slug: "lugo-valladolid", titulo: "El Lugo se impone en el Anxo Carro",
  subtitulo: "", contenido: "<p>El CD&nbsp;Lugo venci&oacute; al Real Valladolid &amp; sum&oacute; tres puntos importantes en casa.</p>",
  fecha_publicacion: "2026-10-24 20:00:00", autor_nombre: "Ana", autor_id: 3,
  resultado: { equipo_local: "CD Lugo", equipo_visitante: "Real Valladolid CF", goles_local: 2, goles_visitante: 1, estado: "finalizado", competicion: "hypermotion", jornada: 9, fecha_partido: "2026-10-24T18:30" },
  idiomas_disponibles: ["ca"], traducciones: { ca: { titulo: "El Lugo s'imposa", contenido: "<p>Text</p>" } },
};
const meta = (h, nombre) => new RegExp(`<meta name="${nombre}" content="([^"]*)"`).exec(h)[1];

test("texto plano: entidades nombradas, numéricas y sin doble decodificación", () => {
  assert.equal(textoPlanoDesdeHtmlSeo("<p>venci&oacute;&nbsp;&Oacute;scar &#233;xito &#xE9;pico</p><p>&iquest;S&iacute;?</p>"), "venció Óscar éxito épico ¿Sí?");
  assert.equal(textoPlanoDesdeHtmlSeo("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
  assert.equal(textoPlanoDesdeHtmlSeo("<b>Gol</b>azo<style>.x{}</style>"), "Golazo");
});

test("description: sin entidades literales y con los dos equipos", () => {
  const d = meta(construirMetaNoticia(cronica, undefined), "description");
  assert.ok(!/&amp;(nbsp|oacute|amp);|nbsp;/.test(d), d);
  assert.ok(d.includes("CD Lugo - Real Valladolid CF"));
});

test("idioma: solo se sirve si hay traducción", () => {
  assert.equal(idiomaServidoSeo(cronica, "ca"), "ca");
  assert.equal(idiomaServidoSeo(cronica, "eu"), "es");
  assert.equal(idiomaServidoSeo(cronica, "xx"), "es");
  assert.equal(idiomaServidoSeo(cronica, undefined), "es");
});

test("canonical: cada idioma con traducción apunta a sí mismo; x-default al castellano", () => {
  const base = "https://elotrofutbol.media/futbol/hypermotion/lugo-valladolid";
  const es = construirMetaNoticia(cronica, undefined);
  const ca = construirMetaNoticia(cronica, "ca");
  const eu = construirMetaNoticia(cronica, "eu"); // sin traducción -> se sirve como castellano
  assert.ok(es.includes(`rel="canonical" href="${base}">`));
  assert.ok(ca.includes(`rel="canonical" href="${base}?lang=ca">`));
  assert.ok(ca.includes(`href="${base}" hreflang="x-default"`));
  assert.ok(eu.includes(`rel="canonical" href="${base}">`));
  assert.ok(eu.includes('property="og:locale" content="es_ES"'));
});

test("dateline: se quita la cabecera de agencia y se respeta el texto normal", () => {
  assert.equal(quitarDatelineSeo("MADRID, 4 oct. - El Real Madrid ganó."), "El Real Madrid ganó.");
  assert.equal(quitarDatelineSeo("LUGO (Galicia), 24 de octubre: El Lugo venció."), "El Lugo venció.");
  assert.equal(quitarDatelineSeo("El Lugo venció, 2-1, al Valladolid."), "El Lugo venció, 2-1, al Valladolid.");
  assert.equal(quitarDatelineSeo("Madrid, 4 oct. El texto sigue"), "Madrid, 4 oct. El texto sigue"); // no es cabecera en mayúsculas
});

test("description sin subtítulo: no empieza por la cabecera de agencia", () => {
  const a = { ...cronica, tipo: "noticia", resultado: null, subtitulo: "", contenido: "<p>LUGO, 24 oct. - El Lugo sumó tres puntos ante el Valladolid en el Anxo Carro.</p>" };
  const d = meta(construirMetaNoticia(a, undefined), "description");
  assert.ok(d.startsWith("El Lugo sumó"), d);
});

test("JSON-LD: con crédito de foto, las imágenes son ImageObject con creditText", () => {
  const a = { ...cronica, imagen_url: "https://res.cloudinary.com/x/image/upload/v1/foto.jpg", imagenes: [{ url: "https://res.cloudinary.com/x/image/upload/v1/foto.jpg", credito: "Foto: Juan Pérez" }] };
  const h = construirMetaNoticia(a, undefined);
  const ld = JSON.parse(/id="seo-jsonld">(.*?)<\/script>/s.exec(h)[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
  assert.equal(ld.image.length, 3);
  assert.equal(ld.image[0]["@type"], "ImageObject");
  assert.equal(ld.image[0].creditText, "Foto: Juan Pérez");
});
