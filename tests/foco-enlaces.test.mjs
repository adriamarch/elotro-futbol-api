// El FOCO de la portada llega a los enlaces: tarjetas sociales (og:image / twitter:image / JSON-LD),
// RSS, sitemap y precalentado. Uso: node --test tests/foco-enlaces.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const leer = (r) => fs.readFileSync(new URL(r, import.meta.url), "utf8");

// --- worker del sitio (funciones puras) ---
const dir = mkdtempSync(join(tmpdir(), "foco-enl-"));
const archivo = join(dir, "sw.mjs");
writeFileSync(archivo, leer("../../public/src-worker.js") + "\nexport { seoFocoPar, seoFocoClave, seoImagenSocialWorker, claveImagenSocial, candidatosImagenSocial, construirMetaNoticia };\n");
const sw = await import(pathToFileURL(archivo).href);

// --- worker de la API: validador + helpers de recorte ---
function cargarApi(ruta) {
  const f = fs.readFileSync(ruta, "utf8");
  const a = f.indexOf("// ---------- FOCO DE IMAGEN: validador ÚNICO del backend");
  const b = f.indexOf("// true si el error es por una columna que aún no existe", a);
  const c = f.indexOf("function focoCloudinarySimple");
  const d0 = f.indexOf("// Imagen de portada recortada 16:9", c);
  const d = f.indexOf("\n}\n", f.indexOf("function imagenParaFeed", d0)) + 3;
  assert.ok(a >= 0 && b > a && c >= 0 && d > c);
  const ctx = { URL };
  vm.createContext(ctx);
  vm.runInContext(f.slice(a, b) + "\n" + f.slice(c, d) + "\nthis.api={normalizarFocoOpcional,imagenParaFeed,transformacionSocialCloudinary};", ctx);
  return ctx.api;
}
const apis = [cargarApi(new URL("../src/index.js", import.meta.url).pathname), cargarApi(new URL("../../worker-secondary/src/index.js", import.meta.url).pathname)];

// --- motor del frontend ---
const motor = {};
vm.createContext(motor);
vm.runInContext(leer("../../public/js/foco.js"), motor);
const EOF_FOCO = motor.EOF_FOCO;

const FOTO = "https://res.cloudinary.com/demo/image/upload/v1/portada.jpg";
const CASOS = ["62% 30%", "62 30", "62.5% 30%", "  10%   90%  ", "center top", "top left", "bottom right", "right", "top", "999% 999%", "-20% 40%", [10, 20], { x: 70, y: "25%" }];
const INVALIDOS = ["", "   ", null, undefined, "abc", "50% 50% 50%", '50%" onerror="x', "x".repeat(500), true, {}, []];

test("el parser del worker del sitio coincide con la web y con la API para cualquier formato", () => {
  for (const c of CASOS) {
    const web = EOF_FOCO.normalizar(c);
    const par = sw.seoFocoPar(c);
    assert.deepEqual(par, [web.x, web.y], JSON.stringify(c));
    for (const api of apis) assert.equal(api.normalizarFocoOpcional(c), `${par[0]}% ${par[1]}%`);
  }
  for (const c of INVALIDOS) {
    assert.equal(sw.seoFocoPar(c), null, JSON.stringify(c));
    for (const api of apis) assert.equal(api.normalizarFocoOpcional(c), null);
  }
});

test("la tarjeta del enlace recorta alrededor del foco con CUALQUIER formato válido", () => {
  for (const c of ["62 30", "62% 30%", { x: 62, y: 30 }]) {
    assert.match(sw.seoImagenSocialWorker(FOTO, 1200, 630, c).url, /c_fill,g_xy_center,x_0\.62,y_0\.3,w_1200,h_630/, JSON.stringify(c));
  }
  assert.match(sw.seoImagenSocialWorker(FOTO, 1200, 630, "center top").url, /g_xy_center,x_0\.5,y_0\.0,/);
  // sin foco o centro: recorte centrado en la CARA (g_face:auto; sin cara vuelve a g_auto), nunca g_auto a secas
  for (const c of ["", null, "50% 50%", "center", "basura"]) assert.match(sw.seoImagenSocialWorker(FOTO, 1200, 630, c).url, /c_fill,g_face:auto,w_1200,h_630/);
});

test("la clave de caché es canónica: mismo foco = misma tarjeta; otro foco = otra", () => {
  assert.equal(sw.claveImagenSocial(FOTO, "62 30"), sw.claveImagenSocial(FOTO, "62% 30%"));
  assert.equal(sw.claveImagenSocial(FOTO, ""), sw.claveImagenSocial(FOTO, "50% 50%"));
  assert.notEqual(sw.claveImagenSocial(FOTO, "62% 30%"), sw.claveImagenSocial(FOTO, "10% 30%"));
});

test("las candidatas de respaldo también conservan el foco", () => {
  const c = sw.candidatosImagenSocial(FOTO, "62% 30%", { w: 3000, h: 2000 });
  assert.ok(c[0].url.includes("g_xy_center") && c[1].url.includes("g_xy_center"));
});

test("el worker de la API construye EXACTAMENTE la misma URL que el del sitio (misma caché)", () => {
  const dims = { w: 3000, h: 2000 };
  for (const foco of ["62% 30%", "0% 100%", "50% 50%", "", "10% 10%"]) {
    for (const d of [dims, null, { w: 3000, h: 4000 }, { w: 2000, h: 2000 }, { w: 2200, h: 2000 }]) {
      const esperado = sw.seoImagenSocialWorker(FOTO, 1200, 630, foco, d).url;
      for (const api of apis) {
        const t = api.transformacionSocialCloudinary(foco, 1200, 630, d);
        assert.equal(FOTO.replace("/upload/", `/upload/${t}/`), esperado, `${foco} ${JSON.stringify(d)}`);
      }
    }
  }
});

test("RSS y sitemap: la imagen del enlace respeta el foco (y sin foco sigue igual)", () => {
  for (const api of apis) {
    assert.match(api.imagenParaFeed(FOTO, "62% 30%"), /c_fill,g_xy_center,x_0\.62,y_0\.3,w_1200,h_675/);
    assert.match(api.imagenParaFeed(FOTO, "50% 50%"), /c_fill,g_face:auto,w_1200,h_675/);
    assert.match(api.imagenParaFeed(FOTO), /g_face:auto/);
    assert.equal(api.imagenParaFeed("https://otro.com/a.jpg", "62% 30%"), "https://otro.com/a.jpg");
    assert.equal(api.imagenParaFeed(""), "");
  }
});

test("la página de la noticia anuncia og:image y JSON-LD con el foco", () => {
  const art = { tipo: "noticia", categoria: "hypermotion", slug: "x", titulo: "T", subtitulo: "", contenido: "<p>a</p>", imagen_url: FOTO, imagen_foco: "left top", fecha_publicacion: "2026-10-24 20:00:00" };
  const h = sw.construirMetaNoticia(art, undefined);
  assert.match(/property="og:image" content="([^"]*)"/.exec(h)[1], /g_xy_center,x_0\.0,y_0\.0/);
  assert.ok((h.match(/g_xy_center,x_0\.0,y_0\.0/g) || []).length >= 4, "og, twitter y las 3 del JSON-LD");
});

// --- seo.js (navegador) ---
function cargarSeoCliente(metas) {
  const cabeza = { querySelector: (q) => { const m = /property="([^"]+)"/.exec(q); return m && metas[m[1]] !== undefined ? { getAttribute: () => metas[m[1]] } : null; } };
  const ctx = { document: { head: cabeza }, EOF_FOCO, console };
  vm.createContext(ctx);
  vm.runInContext(leer("../../public/js/seo.js") + "\nthis.r={seoImagenSocial,seoPortadaSocial,seoImagenSocialConservada};", ctx);
  return ctx.r;
}
test("seo.js (cliente): recorta con el foco y usa la misma portada que el worker", () => {
  const c = cargarSeoCliente({});
  assert.match(c.seoImagenSocial(FOTO, 1200, 630, "62% 30%").url, /g_xy_center,x_0\.62,y_0\.3/);
  assert.match(c.seoImagenSocial(FOTO, 1200, 630, "50% 50%").url, /g_face:auto/);
  assert.deepEqual({ ...c.seoPortadaSocial({ imagen_url: FOTO, imagen_foco: "10% 20%" }) }, { url: FOTO, foco: "10% 20%" });
  const o = c.seoPortadaSocial({ imagenes: [{ tipo: "tweet", url: "https://t/1" }, { url: "https://f/a.jpg", foco: "1% 2%" }, { url: "https://f/b.jpg", grupo: "x", foco: "3% 4%" }] });
  assert.deepEqual({ ...o }, { url: "https://f/b.jpg", foco: "3% 4%" });
  assert.equal(c.seoPortadaSocial({ imagenes: [{ tipo: "tweet", url: "https://t/1" }] }).url, "");
});
test("seo.js (cliente): no pisa el og:image que ya sirvió el worker para esa foto", () => {
  const servida = FOTO.replace("/upload/", "/upload/f_jpg,q_auto:good,c_fill,g_xy_center,x_0.5,y_0.31,w_1200,h_630/");
  const c = cargarSeoCliente({ "og:image": servida, "og:image:width": "1200", "og:image:height": "630" });
  const r = c.seoImagenSocialConservada(FOTO, 1200, 630, "62% 30%");
  assert.equal(r.url, servida);
  assert.equal(r.ancho, 1200);
  // otra foto distinta: se recalcula con su foco
  const r2 = c.seoImagenSocialConservada("https://res.cloudinary.com/demo/image/upload/v1/otra.jpg", 1200, 630, "62% 30%");
  assert.match(r2.url, /g_xy_center,x_0\.62/);
  assert.ok(!r2.conservada);
});

test("sin foco: la foto vertical/cuadrada sale ENTERA sobre fondo difuminado (no se cortan cabezas)", () => {
  for (const d of [{ w: 3000, h: 4000 }, { w: 2000, h: 2000 }, { w: 2200, h: 2000 }]) {
    const u = sw.seoImagenSocialWorker(FOTO, 1200, 630, "", d).url;
    assert.match(u, /c_pad,b_blurred:400:15,w_1200,h_630/, JSON.stringify(d));
    assert.ok(!/c_fill|g_auto/.test(u));
  }
  // apaisada (>= 1,15): recorte con cara
  assert.match(sw.seoImagenSocialWorker(FOTO, 1200, 630, "", { w: 3000, h: 2000 }).url, /c_fill,g_face:auto/);
  // con foco elegido NUNCA se rellena: manda el foco del redactor aunque la foto sea vertical
  assert.match(sw.seoImagenSocialWorker(FOTO, 1200, 630, "62% 30%", { w: 3000, h: 4000 }).url, /c_fill,g_xy_center/);
});

test("el respaldo sin IA sin foco ancla arriba (g_north) para conservar las caras", () => {
  const c = sw.candidatosImagenSocial(FOTO, "", { w: 3000, h: 2000 });
  assert.match(c[1].url, /c_fill,g_north,w_1200,h_630/);
  assert.ok(!c.some((x) => /g_auto/.test(x.url)), "ninguna candidata usa g_auto a secas");
});
