// Centro de partido (fase 2): clasificación, forma reciente y cara a cara.
//   node --no-warnings --test tests/centro-partido-datos.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../../public/js/centro-partido-datos.js");

let id = 0;
const P = (local, visitante, gl, gv, fecha, extra = {}) => ({
  id: ++id, equipo_local: local, equipo_visitante: visitante,
  goles_local: gl, goles_visitante: gv, estado: "finalizado", fecha_partido: fecha, ...extra,
});

test("clasificación: 3 puntos por victoria, 1 por empate, orden por puntos, diferencia y goles", () => {
  const t = C.calcularClasificacion([
    P("A", "B", 2, 0, "2026-09-01T18:00"),
    P("C", "A", 1, 1, "2026-09-08T18:00"),
    P("B", "C", 3, 0, "2026-09-15T18:00"),
  ]);
  assert.deepEqual(t.map((f) => [f.equipo, f.pts, f.pj]), [["A", 4, 2], ["B", 3, 2], ["C", 1, 2]]);
  assert.equal(t.find((f) => f.equipo === "A").gf, 3);
});

test("clasificación: ignora programados y sin marcador; el partido en juego es provisional", () => {
  const t = C.calcularClasificacion([
    P("A", "B", null, null, "2026-09-01T18:00", { estado: "programado" }),
    P("A", "B", 1, 0, "2026-09-02T18:00", { estado: "en_juego" }),
    P("C", "D", null, null, "2026-09-02T18:00"),
  ]);
  assert.equal(t.length, 2);
  assert.ok(t.every((f) => f.enVivo));
  assert.equal(t[0].equipo, "A");
});

test("clasificación: 0-0 cuenta como empate y no se confunde con 'sin marcador'", () => {
  const t = C.calcularClasificacion([P("A", "B", 0, 0, "2026-09-01T18:00")]);
  assert.equal(t.length, 2);
  assert.equal(t[0].pts, 1);
});

test("zonas: hypermotion, primera y segunda federación", () => {
  assert.equal(C.zonaParaPosicion("hypermotion", 2, 22), "ascenso");
  assert.equal(C.zonaParaPosicion("hypermotion", 6, 22), "playoff");
  assert.equal(C.zonaParaPosicion("hypermotion", 19, 22), "descenso");
  assert.equal(C.zonaParaPosicion("primera_federacion", 1, 20), "ascenso");
  assert.equal(C.zonaParaPosicion("segunda_federacion", 13, 18), "playout");
  assert.equal(C.zonaParaPosicion("segunda_federacion", 10, 18), "");
});

test("forma reciente: últimos 5 jugados, más reciente primero, V/E/D desde el equipo", () => {
  const lista = [
    P("A", "X", 2, 0, "2026-09-01T18:00"),
    P("Y", "A", 1, 1, "2026-09-08T18:00"),
    P("A", "Z", 0, 1, "2026-09-15T18:00"),
    P("W", "A", 0, 3, "2026-09-22T18:00"),
    P("A", "V", 4, 4, "2026-09-29T18:00"),
    P("U", "A", 0, 1, "2026-10-06T18:00"),
    P("A", "T", null, null, "2026-10-13T18:00", { estado: "programado" }),
  ];
  const f = C.formaReciente(lista, "A");
  assert.equal(f.length, 5);
  assert.deepEqual(f.map((x) => x.res), ["V", "E", "V", "D", "E"]);
  assert.equal(f[0].rival, "U");
  assert.equal(f[0].local, false);
});

test("forma reciente: con antesDe solo cuenta lo anterior y excluye el propio partido", () => {
  const actual = P("A", "B", 2, 1, "2026-10-01T18:00");
  const lista = [
    P("A", "X", 1, 0, "2026-09-01T18:00"),
    actual,
    P("A", "Y", 0, 2, "2026-10-20T18:00"),
  ];
  const f = C.formaReciente(lista, "A", { excluirId: actual.id, antesDe: actual.fecha_partido });
  assert.equal(f.length, 1);
  assert.equal(f[0].rival, "X");
});

test("forma reciente: un partido sin fecha no se cuela cuando hay límite de fecha", () => {
  const lista = [P("A", "X", 1, 0, null)];
  assert.equal(C.formaReciente(lista, "A", { antesDe: "2026-10-01T18:00" }).length, 0);
  assert.equal(C.formaReciente(lista, "A").length, 1);
});

test("cara a cara: cuenta victorias de cada lado con independencia de quién fue local", () => {
  const lista = [
    P("A", "B", 2, 0, "2024-09-01T18:00"),
    P("B", "A", 1, 1, "2025-02-01T18:00"),
    P("B", "A", 3, 1, "2025-09-01T18:00"),
    P("A", "C", 5, 0, "2025-10-01T18:00"),
  ];
  const r = C.caraACara(lista, "A", "B");
  assert.equal(r.total, 3);
  assert.deepEqual([r.a, r.e, r.b], [1, 1, 1]);
  assert.deepEqual([r.golesA, r.golesB], [4, 4]);
  assert.equal(r.desde, "2024-09-01");
  assert.equal(r.ultimos[0].fecha, "2025-09-01T18:00");
  assert.equal(r.ultimos[0].res, "D");
});

test("cara a cara: sin enfrentamientos devuelve total 0", () => {
  const r = C.caraACara([P("A", "C", 1, 0, "2025-01-01T18:00")], "A", "B");
  assert.equal(r.total, 0);
  assert.deepEqual(r.ultimos, []);
});

test("cara a cara: en un partido ya jugado no se cuenta a sí mismo", () => {
  const actual = P("A", "B", 2, 1, "2026-10-01T18:00");
  const r = C.caraACara([P("B", "A", 0, 0, "2026-03-01T18:00"), actual], "A", "B", { excluirId: actual.id, antesDe: actual.fecha_partido });
  assert.equal(r.total, 1);
  assert.equal(r.e, 1);
});

test("conPartidoActual sustituye la fila del partido por la versión al día", () => {
  const vieja = P("A", "B", 0, 0, "2026-10-01T18:00", { estado: "en_juego" });
  const nueva = { ...vieja, goles_local: 2 };
  const r = C.conPartidoActual([vieja, P("C", "D", 1, 0, "2026-09-01T18:00")], nueva);
  assert.equal(r.length, 2);
  assert.equal(r.find((p) => p.id === vieja.id).goles_local, 2);
});

test("tieneTabla: solo ligas, no copas ni amistosos", () => {
  assert.ok(C.tieneTabla("hypermotion"));
  assert.ok(!C.tieneTabla("amistoso"));
  assert.ok(!C.tieneTabla("copa_del_rey"));
});

test("temporada: de julio a junio, con etiqueta y marca de actual", () => {
  const ahora = new Date("2026-11-16T12:00:00");
  const t = C.temporadaDe("2026-10-01T18:00", ahora);
  assert.deepEqual([t.desde, t.hasta, t.etiqueta, t.actual], ["2026-07-01", "2027-07-01", "2026/27", true]);
  const t2 = C.temporadaDe("2026-03-10T18:00", ahora);
  assert.deepEqual([t2.desde, t2.etiqueta, t2.actual], ["2025-07-01", "2025/26", false]);
  assert.equal(C.temporadaDe("2026-06-30T20:00", ahora).etiqueta, "2025/26");
  assert.equal(C.temporadaDe("2026-07-01T20:00", ahora).etiqueta, "2026/27");
  assert.equal(C.temporadaDe(null, ahora).etiqueta, "2026/27");
});

test("delTemporada: descarta otras temporadas; sin fecha solo cuenta en la actual", () => {
  const ahora = new Date("2026-11-16T12:00:00");
  const lista = [
    P("A", "B", 1, 0, "2026-09-01T18:00"),
    P("A", "C", 1, 0, "2025-09-01T18:00"),
    P("A", "D", 1, 0, null),
  ];
  assert.equal(C.delTemporada(lista, C.temporadaDe("2026-09-01", ahora)).length, 2);
  assert.equal(C.delTemporada(lista, C.temporadaDe("2025-09-01", ahora)).length, 1);
});

test("puestoEnTabla: posición, puntos, partidos y diferencia; null si el equipo aún no ha jugado", () => {
  const tabla = C.calcularClasificacion([
    P("A", "B", 2, 0, "2026-09-01T18:00"),
    P("C", "A", 1, 1, "2026-09-08T18:00"),
  ]);
  assert.deepEqual(C.puestoEnTabla(tabla, "A"), { pos: 1, total: 3, pts: 4, pj: 2, dg: 2 });
  assert.equal(C.puestoEnTabla(tabla, "B").pos, 3);
  assert.equal(C.puestoEnTabla(tabla, "Z"), null);
  assert.equal(C.puestoEnTabla([], "A"), null);
});
