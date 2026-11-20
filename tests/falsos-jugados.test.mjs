// Partidos futuros marcados como "Jugado · sin cubrir" por una fecha mal puesta que el cron arrancó solo.
//   node --no-warnings --test tests/falsos-jugados.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/falsos-jugados.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
for (const f of ["migracion_fin_no_cubierto.sql", "migracion_programado.sql", "migracion_porras.sql", "migracion_anadido_anunciado.sql"]) {
  try { sqlite.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")); } catch { /* columna/tabla ya en schema */ }
}
const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...limpiar(args)) ?? null,
      all: async () => ({ results: st.all(...limpiar(args)) }),
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
};
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef" };
globalThis.fetch = async () => new Response("{}", { status: 200 });

function madrid(ms) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const ahora = Date.now(), MIN = 60000, DIA = 24 * 60 * MIN;
let k = 0;
function partido({ estado = "programado", fecha, noCubierto = 0, goles = null, fuente = "redaccion" }) {
  k++;
  return Number(sqlite.prepare(
    `INSERT INTO results (competicion, grupo, jornada, equipo_local, equipo_visitante, estado, fecha_partido, finalizado_no_cubierto, goles_local, goles_visitante, fuente, inicio_cronometro_at)
     VALUES ('segunda_federacion', 'Grupo 5', 21, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`Local ${k}`, `Visitante ${k}`, estado, fecha, noCubierto, goles, goles, fuente, estado === "programado" ? null : "2026-01-24 16:00:00").lastInsertRowid);
}
const evento = (id, tipo, equipo = "ninguno") =>
  sqlite.prepare("INSERT INTO match_events (resultado_id, tipo, equipo, minuto, orden) VALUES (?, ?, ?, 0, 0)").run(id, tipo, equipo);
const leer = (id) => sqlite.prepare("SELECT * FROM results WHERE id = ?").get(id);
const nEventos = (id) => sqlite.prepare("SELECT COUNT(*) n FROM match_events WHERE resultado_id = ?").get(id).n;

test("un partido FUTURO 'finalizado sin cubrir' vuelve a programado y se limpia lo que dejó el cron", async () => {
  const id = partido({ estado: "finalizado", noCubierto: 1, goles: 0, fecha: madrid(ahora + 80 * DIA) });
  evento(id, "inicio_partido"); evento(id, "descanso"); evento(id, "fin_descanso"); evento(id, "fin_partido");
  const reparados = await worker.repararPartidosFalsamenteJugados(env, { forzar: true });
  assert.ok(reparados >= 1);
  const p = leer(id);
  assert.equal(p.estado, "programado");
  assert.equal(p.finalizado_no_cubierto, 0);
  assert.equal(p.goles_local, null);
  assert.equal(p.inicio_cronometro_at, null);
  assert.equal(nEventos(id), 0);
});

test("no toca partidos ya jugados, en juego legítimo, con cobertura real ni cubiertos a mano", async () => {
  const pasado = partido({ estado: "finalizado", noCubierto: 1, goles: 0, fecha: madrid(ahora - 3 * DIA) });
  const enJuegoAhora = partido({ estado: "en_juego", goles: 0, fecha: madrid(ahora - 30 * MIN) });
  const cubierto = partido({ estado: "finalizado", noCubierto: 0, goles: 2, fecha: madrid(ahora + 80 * DIA) }); // fecha rara pero cubierto a mano
  const conGol = partido({ estado: "en_juego", goles: 1, fecha: madrid(ahora + 80 * DIA) });
  evento(conGol, "inicio_partido"); evento(conGol, "gol", "local");
  await worker.repararPartidosFalsamenteJugados(env, { forzar: true });
  assert.equal(leer(pasado).estado, "finalizado");
  assert.equal(leer(pasado).finalizado_no_cubierto, 1);
  assert.equal(leer(enJuegoAhora).estado, "en_juego");
  assert.equal(leer(cubierto).estado, "finalizado");
  assert.equal(leer(conGol).estado, "en_juego");
  assert.equal(nEventos(conGol), 2);
});

test("el cron NO arranca un partido con fecha de hace meses, y sí uno que empezó hace minutos", async () => {
  const viejo = partido({ fecha: "2026-01-24T17:00" });
  const reciente = partido({ fecha: madrid(ahora - 5 * MIN) });
  await worker.iniciarPartidosProgramadosCuyaHoraHaLlegado(env);
  assert.equal(leer(viejo).estado, "programado");
  assert.equal(leer(reciente).estado, "en_juego");
});

test("futuro 'finalizado' 0-0 con la marca ya borrada (alguien guardó el partido tras corregir la fecha) también se repara", async () => {
  const id = partido({ estado: "finalizado", noCubierto: 0, goles: 0, fecha: madrid(ahora + 80 * DIA) });
  evento(id, "inicio_partido"); evento(id, "fin_partido");
  const conMarcador = partido({ estado: "finalizado", noCubierto: 0, goles: 2, fecha: madrid(ahora + 80 * DIA) });
  await worker.repararPartidosFalsamenteJugados(env, { forzar: true });
  assert.equal(leer(id).estado, "programado");
  assert.equal(leer(id).goles_local, null);
  assert.equal(nEventos(id), 0);
  assert.equal(leer(conMarcador).estado, "finalizado"); // con marcador real no se toca
});
