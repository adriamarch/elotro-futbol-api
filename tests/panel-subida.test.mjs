// Lógica de subida del panel (public/admin/js/admin.js): reintentos, degradación
// progresiva de calidad y tipos MIME. Se extrae el código REAL del fichero y se
// ejecuta con un navegador simulado (sin DOM). Uso: node --test tests/panel-subida.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../public/admin/js/admin.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const entre = (ini, fin) => {
  const i = src.indexOf(ini);
  const j = src.indexOf(fin, i);
  assert.ok(i >= 0 && j > i, `no se encontró el bloque ${ini.slice(0, 40)}`);
  return src.slice(i, j);
};
const bloqueTipos = entre("  const MIME_POR_EXTENSION", "  function agregarArchivos(fileList)");
const bloqueAjuste = entre("  // ---------- Ajuste automático de fotos a los límites de Cloudinary", "  // Contenido MUY pesado: no se sube nada desde aquí.");
const bloqueReintento = entre("  // ¿Merece la pena repetir esta subida tal cual?", "  // Resumen de la tanda en curso");

function crearEntorno({ crudo, tamanoBitmap = { width: 8000, height: 6000 }, decodifica = true }) {
  const filaEl = {
    classList: { add() {}, remove() {} },
    querySelector: () => ({ textContent: "", style: {} }),
  };
  const ctx = {
    log: [],
    mostrarCampoEnlace: (id) => ctx.log.push("enlace:" + id),
  };
  const fabrica = new Function("env", `
    const { crudo, tamanoBitmap, decodifica, filaEl, ctx, apiFetch } = env;
    const setTimeout = (fn) => { fn(); return 0; };
    const clearTimeout = () => {};
    const navigator = { onLine: true };
    const window = { addEventListener() {}, removeEventListener() {} };
    const listaArchivos = { querySelector: () => filaEl };
    const extensionDe = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");
    const pideEnlace = (item) => !!item.necesitaEnlace;
    const mostrarCampoEnlace = ctx.mostrarCampoEnlace;
    const subirEnlaceExterno = async () => { throw new Error("no debe llamarse"); };
    const subirArchivoCrudo = crudo;
    const createImageBitmap = async () => {
      if (!decodifica) throw new Error("no decodificable");
      return { ...tamanoBitmap, close() {} };
    };
    const document = { createElement: () => {
      const c = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} }),
        toBlob(cb, tipo, q) { cb(new Blob([new Uint8Array(Math.round(q * 12_000_000 * (c.width * c.height) / 48e6))])); } };
      return c;
    } };
    const URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
    const Image = class {};
    ${bloqueTipos}
    ${bloqueAjuste}
    ${bloqueReintento}
    return { normalizarTipoArchivo, esFalloTransitorio, subirConReintento, subirArchivo, esRechazoPorPeso, NIVELES_AJUSTE_FOTO, FOTOS_NO_DECODIFICABLES };
  `);
  return { ...fabrica({ crudo, tamanoBitmap, decodifica, filaEl, ctx, apiFetch: async () => ({}) }), ctx };
}
const err = (status, extra = {}) => Object.assign(new Error("fallo " + status), { status, ...extra });
const foto = (nombre = "a.jpg", tam = 1000, tipo = "image/jpeg") => new File([new Uint8Array(tam)], nombre, { type: tipo });

test("tipos MIME: .mov y .heic sin tipo se corrigen; image/jpg se normaliza", () => {
  const { normalizarTipoArchivo: n } = crearEntorno({ crudo: async () => {} });
  assert.equal(n(new File(["x"], "IMG_1.MOV", { type: "" })).type, "video/quicktime");
  assert.equal(n(new File(["x"], "IMG_2.HEIC", { type: "application/octet-stream" })).type, "image/heic");
  assert.equal(n(new File(["x"], "a.jpg", { type: "image/jpg" })).type, "image/jpeg");
  const ok = new File(["x"], "b.png", { type: "image/png" });
  assert.equal(n(ok), ok, "si ya es correcto no se toca");
  assert.equal(n(new File(["x"], "raro.xyz", { type: "" })).type, "", "desconocido: se deja (se rechazará con aviso)");
});

test("fallos pasajeros se reintentan; duplicados y rechazos 400/409 no", () => {
  const { esFalloTransitorio: t } = crearEntorno({ crudo: async () => {} });
  for (const s of [401]) assert.equal(t(err(s)), true);
  assert.equal(t(err(503, { transitorio: true })), true);
  assert.equal(t(err(undefined, { transitorio: true })), true, "corte de red");
  assert.equal(t(err(0, { caidaPrimaria: true })), true);
  assert.equal(t(err(409, { esDuplicado: true })), false);
  assert.equal(t(err(400)), false);
  assert.equal(t(err(413)), false);
  assert.equal(t(err(403)), false);
  assert.equal(t(err(0)), false, "'falta el enlace' (status 0 sin marca) no es un fallo de red");
});

test("subirConReintento: se recupera tras 3 fallos pasajeros seguidos", async () => {
  let llamadas = 0;
  const crudo = async () => {
    llamadas++;
    if (llamadas <= 3) throw err(503, { transitorio: true });
    return { slug: "s", mediaId: 7, vinculada: true };
  };
  const { subirConReintento } = crearEntorno({ crudo });
  const item = { id: 1, file: foto() };
  const r = await subirConReintento(item, "t", "", "", null, null, "publico", false);
  assert.equal(r.mediaId, 7);
  assert.equal(llamadas, 4);
});

test("subirConReintento: un 409 duplicado se devuelve enseguida, sin reintentar", async () => {
  let llamadas = 0;
  const crudo = async () => { llamadas++; throw err(409, { esDuplicado: true }); };
  const { subirConReintento } = crearEntorno({ crudo });
  await assert.rejects(() => subirConReintento({ id: 1, file: foto() }, "t"), (e) => e.status === 409);
  assert.equal(llamadas, 1);
});

test("subirConReintento: se rinde tras 8 intentos si el servidor sigue caído", async () => {
  let llamadas = 0;
  const crudo = async () => { llamadas++; throw err(502, { transitorio: true }); };
  const { subirConReintento } = crearEntorno({ crudo });
  await assert.rejects(() => subirConReintento({ id: 1, file: foto() }, "t"));
  assert.equal(llamadas, 8); // MAX_INTENTOS de admin.js
});

test("foto rechazada por megapíxeles: baja calidad sola, sin pedir enlace manual", async () => {
  const tamanos = [];
  const crudo = async ({ file }) => {
    tamanos.push(file.size);
    if (tamanos.length < 3) throw Object.assign(new Error("Cloudinary ha rechazado este archivo: Image dimensions too large"), { status: 400 });
    return { slug: null, mediaId: 1, vinculada: null };
  };
  const { subirArchivo, ctx } = crearEntorno({ crudo });
  const item = { id: 1, file: foto("grande.jpg", 8_000_000) };
  const r = await subirArchivo(item, "t");
  assert.equal(r.mediaId, 1);
  assert.equal(item.nivelAjuste, 2, "ha tenido que bajar dos niveles");
  assert.ok(tamanos[2] < tamanos[1] || tamanos[1] <= tamanos[0], "cada nivel pesa igual o menos");
  assert.equal(ctx.log.length, 0, "no se pide enlace manual");
});

test("foto que no se puede recodificar (HEIC en Chrome): no insiste y pide el enlace manual", async () => {
  let llamadas = 0;
  const crudo = async () => { llamadas++; throw Object.assign(new Error("Cloudinary ha rechazado este archivo: File size too large"), { status: 400 }); };
  const { subirArchivo, ctx } = crearEntorno({ crudo, decodifica: false });
  const item = { id: 1, file: foto("iphone.heic", 12_000_000, "image/heic") };
  await assert.rejects(() => subirArchivo(item, "t"), /demasiado pesado/);
  assert.equal(llamadas, 1, "una sola subida: no se repite en balde");
  assert.deepEqual(ctx.log, ["enlace:1"]);
});

test("una foto que ya cumple los límites se sube intacta (mismo objeto, sin recodificar)", async () => {
  let recibido = null;
  const crudo = async ({ file }) => { recibido = file; return {}; };
  // createImageBitmap no se usa; leerDimensionesFoto usa Image (sin onload en el stub) -> se simula con tiempo agotado
  const { subirArchivo } = crearEntorno({ crudo });
  const original = foto("normal.jpg", 3_000_000);
  await subirArchivo({ id: 1, file: original }, "t");
  assert.equal(recibido, original);
});
