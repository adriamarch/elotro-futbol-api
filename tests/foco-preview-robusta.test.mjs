// Preview en redes (og:image) BLINDADA con el foco de la portada.
// Uso: node --test tests/foco-preview-robusta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "foco-prev-"));
const archivo = join(dir, "sw.mjs");
writeFileSync(archivo, fs.readFileSync(new URL("../../public/src-worker.js", import.meta.url), "utf8")
  + "\nexport { seoImagenSocialWorker, resolverImagenSocial, medidasFotoCloudinary, OG_DIMS_MEM, OG_IMG_MEM, imagenSocialEnMemoria };\n");

const FOTO = "https://res.cloudinary.com/demo/image/upload/v1/portada.jpg";

// Caché compartida simulada (Cache API) y fetch controlable.
function instalarEntorno({ medidas }) {
  const almacen = new Map();
  globalThis.caches = { default: {
    match: async (req) => almacen.has(req.url) ? new Response(almacen.get(req.url)) : undefined,
    put: async (req, res) => { almacen.set(req.url, await res.text()); },
  } };
  const llamadas = { info: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("fl_getinfo")) {
      llamadas.info++;
      if (!medidas) throw new Error("timeout");
      return new Response(JSON.stringify({ input: { width: medidas.w, height: medidas.h } }), { status: 200 });
    }
    return new Response(new Uint8Array(5000), { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": "5000" } });
  };
  return llamadas;
}

test("sin medidas pasadas, seoImagenSocialWorker usa las ya conocidas (mismo encuadre que la web)", async () => {
  const sw = await import(pathToFileURL(archivo).href + "?a");
  const sinMedidas = sw.seoImagenSocialWorker(FOTO, 1200, 630, "62% 30%").url;
  sw.OG_DIMS_MEM.set(FOTO, { w: 3000, h: 4000 }); // vertical: solo cuenta la Y
  const conMedidas = sw.seoImagenSocialWorker(FOTO, 1200, 630, "62% 30%").url;
  assert.notEqual(sinMedidas, conMedidas);
  assert.match(conMedidas, /g_xy_center,x_0\.5,y_0\.\d+/); // X centrada (foto más alta que ancha), Y calculada
  sw.OG_DIMS_MEM.delete(FOTO);
});

test("con medidas la tarjeta sale con el recorte exacto y se recuerda 6 h", async () => {
  const llamadas = instalarEntorno({ medidas: { w: 4000, h: 3000 } });
  const sw = await import(pathToFileURL(archivo).href + "?b");
  const r = await sw.resolverImagenSocial(FOTO, "20% 70%", { waitUntil() {} });
  assert.equal(r.via, "recorte");
  assert.ok(llamadas.info >= 1);
  const e = [...sw.OG_IMG_MEM.values()][0];
  assert.equal(e.ttl, 6 * 3600 * 1000);
});

test("si Cloudinary no da las medidas, la tarjeta se marca -aprox y solo se recuerda 5 min", async () => {
  instalarEntorno({ medidas: null });
  const sw = await import(pathToFileURL(archivo).href + "?c");
  const r = await sw.resolverImagenSocial(FOTO, "20% 70%", { waitUntil() {} });
  assert.match(r.via, /-aprox$/);
  const e = [...sw.OG_IMG_MEM.values()][0];
  assert.equal(e.ttl, 5 * 60 * 1000);
});

test("sin foco elegido TAMBIÉN se piden las medidas (deciden cara vs. foto entera) y sin ellas se marca -aprox 5 min", async () => {
  const llamadas = instalarEntorno({ medidas: null });
  const sw = await import(pathToFileURL(archivo).href + "?d");
  const r = await sw.resolverImagenSocial(FOTO, "50% 50%", { waitUntil() {} });
  assert.equal(r.via, "recorte-aprox");
  assert.ok(llamadas.info >= 1);
  assert.equal([...sw.OG_IMG_MEM.values()][0].ttl, 5 * 60 * 1000);
});

test("sin foco y foto horizontal: recorte con cara, se recuerda 6 h", async () => {
  instalarEntorno({ medidas: { w: 3000, h: 2000 } });
  const sw = await import(pathToFileURL(archivo).href + "?d2");
  const r = await sw.resolverImagenSocial(FOTO, "", { waitUntil() {} });
  assert.equal(r.via, "recorte");
  assert.match(r.url, /c_fill,g_face:auto/);
  assert.equal([...sw.OG_IMG_MEM.values()][0].ttl, 6 * 3600 * 1000);
});

test("sin foco y foto vertical (la del tuit): sale ENTERA sobre fondo difuminado, sin cortar la cabeza", async () => {
  instalarEntorno({ medidas: { w: 2400, h: 3200 } });
  const sw = await import(pathToFileURL(archivo).href + "?d3");
  const r = await sw.resolverImagenSocial(FOTO, "", { waitUntil() {} });
  assert.equal(r.via, "recorte");
  assert.match(r.url, /c_pad,b_blurred:400:15,w_1200,h_630/);
  assert.equal(r.ancho, 1200);
  assert.equal(r.alto, 630);
});

test("imagenSocialEnMemoria devuelve lo ya resuelto sin red", async () => {
  instalarEntorno({ medidas: { w: 4000, h: 3000 } });
  const sw = await import(pathToFileURL(archivo).href + "?e");
  assert.equal(sw.imagenSocialEnMemoria(FOTO, "20% 70%"), null);
  await sw.resolverImagenSocial(FOTO, "20% 70%", { waitUntil() {} });
  assert.equal(sw.imagenSocialEnMemoria(FOTO, "20% 70%").via, "recorte");
});
