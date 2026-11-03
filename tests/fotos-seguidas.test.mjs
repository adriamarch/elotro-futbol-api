import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Regla "nunca dos fotos seguidas" (separarFotosSeguidas, en normalizar fotos).
// Uso: node tests/fotos-seguidas.test.mjs [ruta/al/index.js]
// (se puede lanzar contra worker/src/index.js y worker-secondary/src/index.js)
const ruta = process.argv.find((a) => a.endsWith("index.js")) || new URL("../src/index.js", import.meta.url).pathname;
const fuente = fs.readFileSync(ruta, "utf-8");

function entre(ini, fin) {
  const a = fuente.indexOf(ini);
  const b = fuente.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, `no encuentro tramo ${ini} -> ${fin}`);
  return fuente.slice(a, b);
}

// Tramos reales del Worker (nada reescrito a mano)
const codigo = [
  entre("const FOCO_CENTRO", "// true si el error es por una columna que aún no existe"),
  entre("const POSICIONES_IMAGEN_VALIDAS", "// ---------- Fusión de las previas"),
].join("\n");
const ctx = vm.createContext({});
vm.runInContext(codigo + "\nthis.separar = separarFotosSeguidas; this.normalizar = normalizarImagenes;", ctx);
// Se pasa por JSON para comparar objetos creados dentro del contexto vm.
const separar = (...a) => JSON.parse(JSON.stringify(ctx.separar(...a)));
const guardar = (imgs, portada) => JSON.parse(JSON.stringify(ctx.normalizar(ctx.separar(imgs, portada))));
const pos = (lista) => lista.map((f) => f.posicion);

test("dos fotos al inicio: la segunda pasa a la galería", () => {
  const r = separar([
    { url: "a.jpg", posicion: "inicio" },
    { url: "b.jpg", posicion: "inicio" },
  ]);
  assert.deepEqual(pos(r), ["inicio", "galeria"]);
});

test("dos fotos tras el mismo párrafo: la segunda pasa a la galería y pierde trasParrafo", () => {
  const r = separar([
    { url: "a.jpg", posicion: "personalizada", trasParrafo: 3 },
    { url: "b.jpg", posicion: "personalizada", trasParrafo: 3 },
  ]);
  assert.deepEqual(pos(r), ["personalizada", "galeria"]);
  assert.equal("trasParrafo" in r[1], false);
});

test("fotos en párrafos distintos o inicio + párrafo 1 no se tocan (hay texto entre ellas)", () => {
  const entrada = [
    { url: "a.jpg", posicion: "inicio" },
    { url: "b.jpg", posicion: "personalizada", trasParrafo: 1 },
    { url: "c.jpg", posicion: "personalizada", trasParrafo: 2 },
    { url: "d.jpg", posicion: "galeria" },
  ];
  assert.deepEqual(separar(entrada), entrada);
});

test("una foto y un collage en el mismo hueco: el collage entero va a la galería", () => {
  const r = separar([
    { url: "a.jpg", posicion: "personalizada", trasParrafo: 2 },
    { url: "b.jpg", posicion: "collage", trasParrafo: 2, grupo: "c1", plantilla: "2-horizontal" },
    { url: "c.jpg", posicion: "collage", trasParrafo: 2, grupo: "c1", plantilla: "2-horizontal" },
  ]);
  assert.deepEqual(pos(r), ["personalizada", "galeria", "galeria"]);
});

test("un collage NO choca consigo mismo (sus filas comparten hueco)", () => {
  const entrada = [
    { url: "b.jpg", posicion: "collage", trasParrafo: 2, grupo: "c1", plantilla: "2-horizontal" },
    { url: "c.jpg", posicion: "collage", trasParrafo: 2, grupo: "c1", plantilla: "2-horizontal" },
  ];
  assert.deepEqual(separar(entrada), entrada);
});

test("un collage al inicio conserva su grupo (se mira antes de normalizar) y no se parte", () => {
  const entrada = [
    { url: "b.jpg", posicion: "inicio", grupo: "c1", plantilla: "2-horizontal" },
    { url: "c.jpg", posicion: "inicio", grupo: "c1", plantilla: "2-horizontal" },
  ];
  assert.deepEqual(separar(entrada), entrada);
});

test("portada que se pinta arriba (cabecera) + foto al inicio: la del inicio pasa a la galería", () => {
  const r = separar(
    [
      { url: "portada.jpg", posicion: "galeria" },
      { url: "b.jpg", posicion: "inicio" },
    ],
    "portada.jpg"
  );
  assert.deepEqual(pos(r), ["galeria", "galeria"]);
});

test("con marcador de partido la cabecera pasa a la galería: la foto de inicio se queda", () => {
  const entrada = [
    { url: "portada.jpg", posicion: "galeria" },
    { url: "b.jpg", posicion: "inicio" },
  ];
  assert.deepEqual(separar(entrada, "portada.jpg", true), entrada);
});

test("portada colocada dentro del texto (inicio) no cuenta como cabecera", () => {
  const entrada = [
    { url: "portada.jpg", posicion: "inicio" },
    { url: "b.jpg", posicion: "personalizada", trasParrafo: 2 },
  ];
  assert.deepEqual(separar(entrada, "portada.jpg"), entrada);
});

test("los tweets no cuentan como foto y las fotos antiguas (strings) no rompen nada", () => {
  const entrada = [
    "https://x/vieja.jpg",
    { tipo: "tweet", url: "https://x.com/a/status/1", posicion: "inicio" },
    { url: "a.jpg", posicion: "inicio" },
  ];
  assert.deepEqual(separar(entrada), entrada);
});

test("no modifica el array de entrada y acepta entradas que no son array", () => {
  const entrada = [
    { url: "a.jpg", posicion: "inicio" },
    { url: "b.jpg", posicion: "inicio" },
  ];
  separar(entrada);
  assert.equal(entrada[1].posicion, "inicio");
  assert.equal(ctx.separar(undefined), undefined);
});

test("de punta a punta: tras normalizar, la foto movida queda en la galería", () => {
  const r = guardar([
    { url: "a.jpg", posicion: "personalizada", trasParrafo: 1 },
    { url: "b.jpg", posicion: "personalizada", trasParrafo: 1 },
  ]);
  assert.deepEqual(pos(r), ["personalizada", "galeria"]);
});
