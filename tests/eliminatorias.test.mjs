// node --test worker/tests/eliminatorias.test.mjs
//
// Playoffs automáticos: generación de los cuadros a partir de la clasificación y de
// los partidos de results (elimGenerarCuadros) y avance de ganadores (elimEfectivo).
// Se extrae el bloque del fuente porque index.js no exporta nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(aqui, "../src/index.js"), "utf8");
const ini = src.indexOf("const ELIM_LIGAS");
const fin = src.indexOf("// ---------- RESPONSABILIDADES ESPECÍFICAS (Funcionalidades > Responsabilidades) ----------");
const iniClasif = src.indexOf("function calcularClasificacionBoletin(partidos) {");
const finClasif = src.indexOf("// Recupera, para una competición dada", iniClasif);
const { elimEfectivo, elimGenerarCuadros, elimAnalizarLiga, elimLeerLigas, calcularClasificacionBoletin } = new Function(
  src.slice(iniClasif, finClasif) + "\n" + src.slice(ini, fin) +
  "\nreturn { elimEfectivo, elimGenerarCuadros, elimAnalizarLiga, elimLeerLigas, calcularClasificacionBoletin };"
)();
const calcular = calcularClasificacionBoletin;

// ---------- Enlace con partidos reales y avance de ganadores ----------
const fila = (id, local, visitante, gl, gv, estado = "finalizado", extra = {}) => ({
  id, equipo_local: local, equipo_visitante: visitante, goles_local: gl, goles_visitante: gv, estado,
  fecha_partido: "2026-06-07T20:00", fecha_partido_retrasado: null, penaltis_local: null, penaltis_visitante: null,
  finalizado_no_cubierto: 0, ...extra,
});
const cuadroBase = (rondas) => [{ id: "c1", nombre: "Playoff", competicion: "hypermotion", visible: true, tipo: "playoff_ascenso", rondas }];
const cruce = (id, a, b, partidos, extra = {}) => ({ id, a, b, partidos, penaltis: { a: null, b: null }, ganador: "", ...extra });
const part = (resultado_id = null, a = null, b = null, fecha = "") => ({ a, b, fecha, resultado_id });


test("el partido real manda sobre lo escrito a mano y se orienta aunque A sea el visitante", () => {
  const cuadros = cuadroBase([{ id: "r1", nombre: "Final", cruces: [
    cruce("x1", "Racing", "Eibar", [part(1, 9, 9), part(2, 9, 9)]),
  ] }]);
  // Ida: local Racing 2-0. Vuelta: local Eibar 1-1 (A = Racing es el visitante).
  const mapa = { 1: fila(1, "Racing", "Eibar", 2, 0), 2: fila(2, "Éibar", "Racing", 1, 1) };
  const [c] = elimEfectivo(cuadros, mapa);
  const x = c.rondas[0].cruces[0];
  assert.deepEqual([x.partidos[0].a, x.partidos[0].b], [2, 0]);
  assert.deepEqual([x.partidos[1].a, x.partidos[1].b], [1, 1]);
  assert.equal(x.partidos[1].fecha, "2026-06-07T20:00");
  assert.equal(x.partidos[0].real.desajuste, false);
  // El original no se toca.
  assert.equal(cuadros[0].rondas[0].cruces[0].partidos[0].a, 9);
});

test("un partido en juego muestra el marcador pero no cierra el cruce; uno programado se queda sin goles", () => {
  const cuadros = cuadroBase([{ id: "r1", nombre: "Final", cruces: [cruce("x1", "A", "B", [part(1), part(2, 5, 5)])] }]);
  const [c] = elimEfectivo(cuadros, { 1: fila(1, "A", "B", 1, 0, "en_juego"), 2: fila(2, "B", "A", null, null, "programado") });
  const [p1, p2] = c.rondas[0].cruces[0].partidos;
  assert.deepEqual([p1.a, p1.b, p1.vivo], [1, 0, true]);
  assert.deepEqual([p2.a, p2.b], [null, null]);
});

test("equipos que no encajan: se marca desajuste y no se aplican goles", () => {
  const cuadros = cuadroBase([{ id: "r1", nombre: "Final", cruces: [cruce("x1", "A", "B", [part(1, 3, 3)])] }]);
  const [c] = elimEfectivo(cuadros, { 1: fila(1, "A", "Z", 1, 0) });
  const p = c.rondas[0].cruces[0].partidos[0];
  assert.equal(p.real.desajuste, true);
  assert.deepEqual([p.a, p.b], [3, 3]);
});

test("un partido sin cubrir no cuenta como jugado", () => {
  const cuadros = cuadroBase([{ id: "r1", nombre: "Final", cruces: [cruce("x1", "A", "B", [part(1)])] }]);
  const [c] = elimEfectivo(cuadros, { 1: fila(1, "A", "B", 1, 0, "finalizado", { finalizado_no_cubierto: 1 }) });
  const p = c.rondas[0].cruces[0].partidos[0];
  assert.equal(p.real.estado, "sin_cubrir");
  assert.deepEqual([p.a, p.b], [null, null]);
});

test("los penaltis del último partido real deciden el cruce igualado", () => {
  const cuadros = cuadroBase([
    { id: "r1", nombre: "Semis", cruces: [cruce("s1", "A", "B", [part(1)]), cruce("s2", "C", "D", [part(2)])] },
    { id: "r2", nombre: "Final", cruces: [cruce("f", "", "", [part()])] },
  ]);
  const mapa = { 1: fila(1, "A", "B", 1, 1, "finalizado", { penaltis_local: 3, penaltis_visitante: 5 }), 2: fila(2, "C", "D", 2, 0) };
  const [c] = elimEfectivo(cuadros, mapa);
  assert.deepEqual(c.rondas[0].cruces[0].penaltis, { a: 3, b: 5 });
  assert.equal(c.rondas[1].cruces[0].a, "B"); // pasa B por penaltis
  assert.equal(c.rondas[1].cruces[0].b, "C");
});

test("avanza los ganadores a la ronda siguiente sin pisar equipos escritos a mano", () => {
  const cuadros = cuadroBase([
    { id: "r1", nombre: "Semis", cruces: [
      cruce("s1", "A", "B", [part(null, 2, 0)]),
      cruce("s2", "C", "D", [part(null, 0, 1)]),
    ] },
    { id: "r2", nombre: "Final", cruces: [cruce("f", "", "Manual", [part()])] },
  ]);
  const [c] = elimEfectivo(cuadros, {});
  const f = c.rondas[1].cruces[0];
  assert.equal(f.a, "A");
  assert.equal(f.auto_a, "A");
  assert.equal(f.b, "Manual"); // lo escrito a mano no se pisa
  assert.equal(f.auto_b, undefined);
});

test("un empate global sin penaltis no avanza a nadie, y el ganador forzado sí", () => {
  const rondas = (forzado) => [
    { id: "r1", nombre: "Semis", cruces: [
      cruce("s1", "A", "B", [part(null, 1, 0), part(null, 0, 1)], { ganador: forzado }),
      cruce("s2", "C", "D", [part(null, 1, 0), part(null, 1, 0)]),
    ] },
    { id: "r2", nombre: "Final", cruces: [cruce("f", "", "", [part()])] },
  ];
  const sin = elimEfectivo(cuadroBase(rondas("")), {})[0].rondas[1].cruces[0];
  assert.equal(sin.a, "");
  assert.equal(sin.b, "C");
  const con = elimEfectivo(cuadroBase(rondas("b")), {})[0].rondas[1].cruces[0];
  assert.equal(con.a, "B");
});

test("sin equipos, el primer partido enlazado los rellena", () => {
  const cuadros = cuadroBase([{ id: "r1", nombre: "Final", cruces: [cruce("x1", "", "", [part(1), part(2)])] }]);
  const [c] = elimEfectivo(cuadros, { 1: fila(1, "Racing", "Eibar", 1, 0), 2: fila(2, "Eibar", "Racing", 0, 0) });
  const x = c.rondas[0].cruces[0];
  assert.deepEqual([x.a, x.b], ["Racing", "Eibar"]);
  assert.deepEqual([x.partidos[1].a, x.partidos[1].b], [0, 0]);
});


// ---------- Generación automática de los cuadros ----------
const AHORA = new Date("2026-06-01T00:00:00Z"); // temporada 2025/26
const E = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]; // de mejor a peor clasificado
let SEQ = 1000;

// Liga a doble vuelta (método del círculo) en la que siempre gana el equipo de mejor
// nivel (el que va antes en `equipos`): la tabla sale Alfa, Beta, Gamma...
function liga(equipos, grupo, { estadoUltima = "finalizado" } = {}) {
  const n = equipos.length, filas = [], rot = [...equipos];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const x = rot[i], y = rot[n - 1 - i];
      const fuerte = equipos.indexOf(x) < equipos.indexOf(y) ? x : y;
      for (const vuelta of [0, 1]) {
        const local = (vuelta === 0) === (r % 2 === 0) ? x : y;
        const visita = local === x ? y : x;
        const jornada = r + 1 + vuelta * (n - 1);
        filas.push({
          id: SEQ++, grupo, jornada, equipo_local: local, equipo_visitante: visita,
          goles_local: local === fuerte ? 1 : 0, goles_visitante: visita === fuerte ? 1 : 0,
          estado: jornada === 2 * (n - 1) ? estadoUltima : "finalizado",
          fecha_partido: `2026-03-${String(jornada).padStart(2, "0")}T20:00`, fecha_partido_retrasado: null,
          penaltis_local: null, penaltis_visitante: null, finalizado_no_cubierto: 0,
        });
      }
    }
    rot.splice(1, 0, rot.pop());
  }
  return filas;
}
// Partido de playoff: jornada posterior a la última de la liga regular.
const po = (local, visitante, gl, gv, fecha, grupo = null, jornada = 100) => ({
  id: SEQ++, grupo, jornada, equipo_local: local, equipo_visitante: visitante, goles_local: gl, goles_visitante: gv,
  estado: "finalizado", fecha_partido: fecha, fecha_partido_retrasado: null,
  penaltis_local: null, penaltis_visitante: null, finalizado_no_cubierto: 0,
});
const nombres = (c) => c.rondas.map((r) => r.cruces.map((x) => [x.a, x.b]));

test("antes de la última jornada sale un cuadro provisional con la clasificación del momento", () => {
  const filas = liga(E, null, { estadoUltima: "programado" });
  const [c] = elimGenerarCuadros({ hypermotion: filas }, calcular, AHORA);
  assert.equal(c.clasif, "provisional");
  assert.match(c.nota, /Provisional/);
  assert.equal(c.rondas[0].cruces.length, 2);
  assert.deepEqual(elimGenerarCuadros({}, calcular, AHORA), [], "sin partidos no hay cuadro");
});

test("a mitad de liga (calendario entero cargado, solo unas jornadas jugadas) ya hay cuadro provisional", () => {
  const filas = liga(E, null).map((p) => (p.jornada > 4 ? { ...p, estado: "programado", goles_local: null, goles_visitante: null } : p));
  const [c] = elimGenerarCuadros({ hypermotion: filas }, calcular, AHORA);
  assert.equal(c.clasif, "provisional");
  const tabla = calcular(filas).map((f) => f.equipo);
  assert.deepEqual(nombres(c)[0], [[tabla[2], tabla[5]], [tabla[3], tabla[4]]]);
});

test("si falta un partido de la jornada 1 la liga no se acorta: la última jornada sigue siendo la 10", () => {
  const filas = liga(E, null).filter((p) => !(p.jornada === 1 && p.equipo_local === "Alfa"));
  const an = elimAnalizarLiga(filas, calcular);
  assert.equal(an.grupos[0].ultima, 10);
});

test("al empezar la última jornada sale un cuadro provisional con la clasificación de ese momento", () => {
  const filas = liga(E, null, { estadoUltima: "programado" });
  const ultima = filas.filter((p) => p.jornada === 10);
  ultima[0].estado = "en_juego";
  const tabla = calcular(filas.filter((p) => p.estado === "finalizado")).map((f) => f.equipo);
  const [c] = elimGenerarCuadros({ hypermotion: filas }, calcular, AHORA);
  assert.equal(c.clasif, "provisional");
  assert.match(c.nota, /Provisional/);
  assert.deepEqual(nombres(c)[0], [[tabla[2], tabla[5]], [tabla[3], tabla[4]]]);
});

test("al acabar la liga el cuadro queda fijado: 3.º-6.º y 4.º-5.º en Hypermotion", () => {
  const [c] = elimGenerarCuadros({ hypermotion: liga(E, null) }, calcular, AHORA);
  assert.equal(c.id, "hypermotion-unico");
  assert.equal(c.clasif, "final");
  assert.equal(c.temporada, "2025/26");
  assert.deepEqual(c.rondas.map((r) => r.nombre), ["Semifinales", "Final"]);
  assert.deepEqual(nombres(c), [[["Gamma", "Zeta"], ["Delta", "Epsilon"]], [["", ""]]]);
  assert.equal(c.rondas[0].cruces[0].partidos.length, 2, "ida y vuelta");
});

test("no hay cuadro si la liga tiene menos equipos que puestos de playoff", () => {
  assert.deepEqual(elimGenerarCuadros({ hypermotion: liga(E.slice(0, 4), null) }, calcular, AHORA), []);
});

test("los partidos del playoff se enlazan solos, no cuentan para la tabla y los ganadores llegan a la final", () => {
  const regular = liga(E, null);
  const filas = [
    ...regular,
    po("Zeta", "Gamma", 0, 1, "2026-06-01T20:00"), po("Gamma", "Zeta", 2, 0, "2026-06-05T20:00"),
    po("Epsilon", "Delta", 1, 0, "2026-06-01T20:00"), po("Delta", "Epsilon", 0, 0, "2026-06-05T20:00"),
    po("Epsilon", "Gamma", 1, 1, "2026-06-10T20:00"), po("Gamma", "Epsilon", 2, 1, "2026-06-14T20:00"),
  ];
  const an = elimAnalizarLiga(filas, calcular);
  assert.equal(an.fuera.length, 6);
  assert.equal(an.grupos[0].tabla[2].pj, 10, "el playoff no suma partidos a la tabla");
  const [c] = elimGenerarCuadros({ hypermotion: filas }, calcular, AHORA);
  const [s1, s2] = c.rondas[0].cruces;
  // Gamma (A) juega la ida de visitante: sus goles salen del lado correcto.
  assert.deepEqual(s1.partidos.map((p) => [p.a, p.b]), [[1, 0], [2, 0]]);
  assert.deepEqual(s2.partidos.map((p) => [p.a, p.b]), [[0, 1], [0, 0]]);
  const fin = c.rondas[1].cruces[0];
  assert.deepEqual([fin.a, fin.b], ["Gamma", "Epsilon"]);
  assert.deepEqual(fin.partidos.map((p) => [p.a, p.b]), [[1, 1], [2, 1]]);
  assert.ok(fin.partidos.every((p) => p.real === undefined), "el detalle interno no sale al público");
});

test("sin partidos de playoff en results los marcadores quedan vacíos y no se inventa nada", () => {
  const [c] = elimGenerarCuadros({ hypermotion: liga(E, null) }, calcular, AHORA);
  const x = c.rondas[0].cruces[0];
  assert.deepEqual(x.partidos.map((p) => [p.a, p.b, p.resultado_id]), [[null, null, null], [null, null, null]]);
});

test("Primera Federación: un cuadro por grupo con 2.º-5.º y 3.º-4.º, y el empate global lo gana el mejor clasificado", () => {
  const g1 = E.map((e) => `${e} I`), g2 = E.map((e) => `${e} II`);
  const filas = [
    ...liga(g1, "Grupo 1"), ...liga(g2, "Grupo 2"),
    po("Epsilon I", "Beta I", 1, 1, "2026-06-01T20:00", "Grupo 1"), po("Beta I", "Epsilon I", 1, 1, "2026-06-05T20:00", "Grupo 1"),
    po("Gamma I", "Delta I", 0, 2, "2026-06-01T20:00", "Grupo 1"), po("Delta I", "Gamma I", 2, 0, "2026-06-05T20:00", "Grupo 1"),
  ];
  const cuadros = elimGenerarCuadros({ primera_federacion: filas }, calcular, AHORA);
  assert.deepEqual(cuadros.map((c) => c.id), ["primera_federacion-grupo1", "primera_federacion-grupo2"]);
  assert.deepEqual(cuadros.map((c) => c.grupo), ["Grupo 1", "Grupo 2"]);
  const [c1, c2] = cuadros;
  assert.deepEqual(nombres(c2)[0], [["Beta II", "Epsilon II"], ["Gamma II", "Delta II"]]);
  assert.equal(c1.rondas[0].cruces[0].empate, "a");
  // Beta I (2.º) no gana a Epsilon I (5.º) en el campo (1-1 y 1-1) pero pasa por clasificación; Delta I gana 4-0.
  assert.deepEqual([c1.rondas[1].cruces[0].a, c1.rondas[1].cruces[0].b], ["Beta I", "Delta I"]);
  assert.equal(c1.rondas[1].cruces[0].empate, "a", "en la final también pasa el mejor clasificado");
  assert.match(c1.nota, /mejor clasificado/);
});

test("Hypermotion: el empate global sin penaltis no avanza a nadie (no se inventa una regla)", () => {
  const filas = [
    ...liga(E, null),
    po("Zeta", "Gamma", 1, 1, "2026-06-01T20:00"), po("Gamma", "Zeta", 1, 1, "2026-06-05T20:00"),
  ];
  const [c] = elimGenerarCuadros({ hypermotion: filas }, calcular, AHORA);
  assert.deepEqual(c.rondas[1].cruces[0].a, "");
  assert.equal(c.rondas[0].cruces[0].empate, "");
});

test("Segunda Federación: los clasificados salen de la tabla y los cruces, de los partidos entre ellos (sorteo)", () => {
  const g1 = E.map((e) => `${e} I`), g2 = E.map((e) => `${e} II`);
  const base = [...liga(g1, "Grupo 1"), ...liga(g2, "Grupo 2")];
  assert.deepEqual(elimGenerarCuadros({ segunda_federacion: base }, calcular, AHORA), [], "sin sorteo todavía no hay cuadro");
  const filas = [
    ...base,
    po("Beta I", "Epsilon II", 1, 0, "2026-06-01T20:00", "Grupo 1"), po("Epsilon II", "Beta I", 0, 0, "2026-06-05T20:00", "Grupo 2"),
    po("Alfa I", "Beta II", 3, 0, "2026-06-01T20:00", "Grupo 1"), // el campeón de grupo no juega este playoff
    po("Gamma II", "Delta I", 2, 1, "2026-06-01T20:00", "Grupo 2"),
    po("Beta I", "Gamma II", 1, 0, "2026-06-12T20:00", "Grupo 1"), po("Gamma II", "Beta I", 0, 0, "2026-06-16T20:00", "Grupo 2"),
  ];
  const [c] = elimGenerarCuadros({ segunda_federacion: filas }, calcular, AHORA);
  assert.equal(c.id, "segunda_federacion-playoff");
  assert.deepEqual(c.rondas.map((r) => r.nombre), ["Semifinales", "Final"]);
  assert.deepEqual(c.rondas.map((r) => r.cruces.length), [2, 1]);
  assert.deepEqual(nombres(c)[1], [["Beta I", "Gamma II"]]);
  const semi = c.rondas[0].cruces.find((x) => x.a === "Beta I");
  assert.deepEqual(semi.partidos.map((p) => [p.a, p.b]), [[1, 0], [0, 0]]);
  assert.equal(semi.partidos.length, 2);
  const todos = JSON.stringify(c);
  assert.ok(!todos.includes("Alfa I") && !todos.includes("Beta II"), "solo juegan los clasificados 2.º-5.º");
});

test("elimAnalizarLiga: lo posterior a la última jornada va a 'fuera' y un grupo sin liga regular también", () => {
  const regular = liga(E, "Grupo 1");
  const extra = po("Alfa", "Beta", 1, 0, "2026-06-01T20:00", "Grupo 1");
  const huerfano = po("X", "Y", 1, 0, "2026-06-02T20:00", null);
  const an = elimAnalizarLiga([...regular, extra, huerfano], calcular);
  assert.equal(an.grupos.length, 1);
  assert.equal(an.grupos[0].ultima, 10);
  assert.equal(an.grupos[0].completo, true);
  assert.deepEqual(an.fuera.map((p) => p.id).sort(), [extra.id, huerfano.id].sort());
});

test("lee los partidos de la temporada en curso (desde el 1 de julio) de cada liga con playoff", async () => {
  const llamadas = [];
  const env = { DB: { prepare: () => ({ bind: (...a) => ({ all: async () => { llamadas.push(a); return { results: [{ id: 1 }] }; } }) }) } };
  const out = await elimLeerLigas(env, AHORA);
  assert.deepEqual(Object.keys(out).sort(), ["hypermotion", "primera_federacion", "segunda_federacion"]);
  assert.deepEqual(llamadas.map((a) => a[1]), ["2025-07-01", "2025-07-01", "2025-07-01"]);
  llamadas.length = 0;
  await elimLeerLigas(env, new Date("2026-11-07T10:00:00Z"));
  assert.equal(llamadas[0][1], "2026-07-01");
});
