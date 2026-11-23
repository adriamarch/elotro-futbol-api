// Relleno automático: (1) solo temporada en curso, (2) nunca 'finalizado' si aún no ha pasado.
// Usa el código REAL del Worker (admite ruta del Worker secundario como argumento).
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ruta = process.argv[2] || new URL("../src/index.js", import.meta.url).pathname;
const fuente = fs.readFileSync(ruta, "utf-8");
function entre(ini, fin) {
  const a = fuente.indexOf(ini);
  const b = fuente.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, `no encuentro tramo ${ini} -> ${fin}`);
  return fuente.slice(a, b);
}
const codigo = [
  "const SYNC_VIVO_MIN_TRAS_INICIO_MS = 100 * 60 * 1000;",
  entre("function syncPartesMadrid(", "// strTime de TheSportsDB"),
  entre("function syncPartidoPendienteDeResultado(", "// ¿Toca reintentar esta ronda"),
  entre("const SYNC_FINALIZAR_SOLO_JORNADA_CERRADA", "// Aplica los eventos de UNA liga"),
].join("\n");
const ctx = vm.createContext({ Intl, Date });
vm.runInContext(codigo + "\nthis.api = { syncTemporada, syncRangoTemporadaActual, syncFechaEnTemporadaActual, syncPuedeFinalizar };", ctx);
const { syncTemporada, syncRangoTemporadaActual, syncFechaEnTemporadaActual, syncPuedeFinalizar } = ctx.api;

// Temporada según el reloj
assert.equal(syncTemporada(new Date("2026-11-23T12:00:00Z")), "2026-2027");
assert.equal(syncTemporada(new Date("2027-06-30T12:00:00Z")), "2026-2027");
const r = syncRangoTemporadaActual(new Date("2026-11-23T12:00:00Z"));
assert.deepEqual([r.desde, r.hasta], ["2026-07-01", "2027-06-30"]);

// (1) Fuera de temporada
assert.equal(syncFechaEnTemporadaActual("2025-03-31", r), false);
assert.equal(syncFechaEnTemporadaActual("2025-03-31T18:30", r), false);
assert.equal(syncFechaEnTemporadaActual("2026-06-30", r), false);
assert.equal(syncFechaEnTemporadaActual("2028-01-10", r), false);
assert.equal(syncFechaEnTemporadaActual("2026-08-15", r), true);
assert.equal(syncFechaEnTemporadaActual("2027-06-30T20:00", r), true);

// (2) Finalizar solo si ya ha pasado
const ahora = { fecha: "2026-11-23", hora: "20:00" };
const cal = [
  { jornada: 13, fecha_inicio: "2026-11-20", fecha_fin: "2026-11-23" },
  { jornada: 14, fecha_inicio: "2026-11-27", fecha_fin: "2026-11-30" },
];
assert.equal(syncPuedeFinalizar("2026-11-21T16:00", 13, cal, ahora), true);   // ya jugado
assert.equal(syncPuedeFinalizar("2026-11-23T19:30", 13, cal, ahora), false);  // empezó hace 30 min
assert.equal(syncPuedeFinalizar("2026-11-23T17:00", 13, cal, ahora), true);   // hace 3 h
assert.equal(syncPuedeFinalizar("2026-11-28T18:00", 14, cal, ahora), false);  // futuro
assert.equal(syncPuedeFinalizar("2026-11-22", 13, cal, ahora), true);         // solo día, ya pasó
assert.equal(syncPuedeFinalizar("2026-11-23", 13, cal, ahora), false);        // solo día, hoy antes de las 23:00
assert.equal(syncPuedeFinalizar("2026-11-24T18:00", 12, cal, ahora), false);  // fecha futura aunque jornada pasada
assert.equal(syncPuedeFinalizar(null, 13, cal, ahora), false);
// jornada que aún no ha empezado según el calendario, aunque la fecha del partido (mal) sea pasada
assert.equal(syncPuedeFinalizar("2026-11-21T16:00", 14, cal, ahora), false);

console.log("relleno-salvaguardas OK");
