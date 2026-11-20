// Rechazo automático de acreditaciones sin respuesta cuando empieza el partido (SIN correo).
//   node --no-warnings --test tests/acreditaciones-autorechazo.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/acreditaciones-autorechazo.test.mjs
//
// Esquema real (schema.sql + migracion_acreditaciones_v2.sql) sobre SQLite en memoria. Resend simulado
// sustituyendo fetch: el test comprueba que NO sale ninguna petición de correo.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../migracion_acreditaciones_v2.sql", import.meta.url), "utf8"));
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
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef", RESEND_API_KEY: "re_test", RESEND_FROM: "Test <no-reply@elotrofutbol.media>" };
const pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

let peticiones = [];
globalThis.fetch = async (url, init = {}) => {
  peticiones.push({ url: String(url), method: init.method || "GET" });
  return new Response("{}", { status: 200 });
};

// Reloj de pared de Madrid ("YYYY-MM-DDTHH:MM") para un instante: así se escribe fecha_partido en el panel.
function madrid(ms) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` };
}
const ahora = Date.now();
const MIN = 60000, DIA = 24 * 60 * MIN;

let n = 0;
function partido({ local, visitante, estado = "programado", fecha, retrasado = null, jornada = 7 }) {
  return Number(sqlite.prepare(
    `INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, estado, fecha_partido, fecha_partido_retrasado)
     VALUES ('primera_federacion', ?, ?, ?, ?, ?, ?)`
  ).run(jornada, local, visitante, estado, fecha, retrasado).lastInsertRowid);
}
function acred({ equipo, estado = "pendiente", fecha = null, jornada = "Jornada 7", nota = null }) {
  n++;
  return Number(sqlite.prepare(
    `INSERT INTO acreditaciones (nombre, email, dni, equipo, tipo_evento, tipo_acreditacion, funciones, jornada_partido, estado, fecha_partido, nota_admin)
     VALUES (?, ?, '12345678Z', ?, 'Partido', 'Fotógrafo', 'Fotos', ?, ?, ?, ?)`
  ).run(`Persona ${n}`, `p${n}@x.es`, equipo, jornada, estado, fecha, nota).lastInsertRowid);
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Solicitud SIN fecha en el campo, con el partido solo descrito en el texto (como las del formulario público).
function acredTexto({ equipo, texto, creadaMs }) {
  n++;
  const creada = new Date(creadaMs).toISOString().slice(0, 19).replace("T", " ");
  return Number(sqlite.prepare(
    `INSERT INTO acreditaciones (nombre, email, dni, equipo, tipo_evento, tipo_acreditacion, funciones, jornada_partido, estado, fecha_partido, created_at)
     VALUES (?, ?, '12345678Z', ?, 'Partido', 'Fotógrafo', 'Fotos', ?, 'solicitada', NULL, ?)`
  ).run(`Persona ${n}`, `p${n}@x.es`, equipo, texto, creada).lastInsertRowid);
}
const textoFecha = (ms, hora) => { const [y, m, d] = madrid(ms).dia.split("-").map(Number); return `${d} de ${MESES[m - 1]} a las ${hora}`; };
const leer = (id) => sqlite.prepare("SELECT * FROM acreditaciones WHERE id = ?").get(id);

test("al empezar el partido sin respuesta se rechaza sola y sin correo", async () => {
  const hoy = madrid(ahora).dia;
  const ayer = madrid(ahora - DIA).dia;
  const manana = madrid(ahora + DIA).dia;

  // 1) programado, empezó hace 10 min -> rechazada
  partido({ local: "Alpha FC", visitante: "Beta FC", fecha: madrid(ahora - 10 * MIN).hora });
  const a1 = acred({ equipo: "Alpha FC", estado: "pendiente", fecha: hoy });
  // 1b) solicitada al club, sin respuesta, con nota previa -> rechazada y conserva la nota
  const a1b = acred({ equipo: "Beta FC", estado: "solicitada", fecha: hoy, nota: "Pedida el lunes" });
  // 2) programado, empieza en 2 h -> intacta
  partido({ local: "Gamma FC", visitante: "Delta FC", fecha: madrid(ahora + 120 * MIN).hora });
  const a2 = acred({ equipo: "Gamma FC", estado: "solicitada", fecha: hoy });
  // 3) en juego (sea cual sea su hora) -> rechazada
  partido({ local: "Epsilon FC", visitante: "Zeta FC", estado: "en_juego", fecha: madrid(ahora - 30 * MIN).hora });
  const a3 = acred({ equipo: "Zeta FC", fecha: hoy });
  // 4) sin partido localizado y fecha de ayer -> rechazada
  const a4 = acred({ equipo: "Equipo Sin Partido", fecha: ayer });
  // 5) sin partido localizado y fecha de hoy -> intacta (no se sabe la hora)
  const a5 = acred({ equipo: "Equipo Sin Partido Hoy", fecha: hoy });
  // 6) ya aprobada, partido empezado -> intacta
  partido({ local: "Eta FC", visitante: "Theta FC", estado: "en_juego", fecha: madrid(ahora - 20 * MIN).hora });
  const a6 = acred({ equipo: "Eta FC", estado: "aprobada", fecha: hoy });
  // 7) aplazado con hora ya pasada -> intacta (no se juega)
  partido({ local: "Iota FC", visitante: "Kappa FC", estado: "aplazado", fecha: madrid(ahora - 60 * MIN).hora });
  const a7 = acred({ equipo: "Iota FC", fecha: hoy });
  // 8) fecha futura -> intacta
  const a8 = acred({ equipo: "Equipo Futuro", fecha: manana });
  // 9) retrasado con la nueva hora en el futuro -> intacta
  partido({ local: "Lambda FC", visitante: "Mu FC", estado: "retrasado", fecha: madrid(ahora - 90 * MIN).hora, retrasado: madrid(ahora + 180 * MIN).hora });
  const a9 = acred({ equipo: "Lambda FC", fecha: hoy });
  // 10) sin fecha: se localiza por jornada + equipo; el partido ya empezó -> rechazada
  partido({ local: "Nu FC", visitante: "Xi FC", jornada: 12, fecha: madrid(ahora - 15 * MIN).hora });
  const a10 = acred({ equipo: "Xi FC", fecha: null, jornada: "Jornada 12 · Nu FC - Xi FC" });
  // 12) Caso real: sin fecha, partido de hace 10 días (no es de hoy ni de ayer) localizado por jornada.
  partido({ local: "Alcantarilla CF", visitante: "Los Garres", estado: "finalizado", jornada: 9, fecha: madrid(ahora - 10 * DIA).hora });
  const a12 = acredTexto({ equipo: "Alcantarilla CF.", creadaMs: ahora - 20 * DIA, texto: `Alcantarilla CF - Los Garres. Domingo ${textoFecha(ahora - 10 * DIA, 18)}. Jornada 9.` });
  // 13) Sin partido en Resultados y sin fecha: se lee del texto (ya pasó) -> rechazada
  const a13 = acredTexto({ equipo: "Club Fuera De Resultados", creadaMs: ahora - 20 * DIA, texto: `Sábado ${textoFecha(ahora - 10 * DIA, 17)}.` });
  // 14) Lo mismo con fecha del texto en el futuro -> intacta
  const a14 = acredTexto({ equipo: "Otro Club Fuera De Resultados", creadaMs: ahora - 1 * DIA, texto: `Sábado ${textoFecha(ahora + 3 * DIA, 17)}.` });
  // 11) cancelada -> intacta
  const a11 = acred({ equipo: "Alpha FC", estado: "cancelada", fecha: ayer });

  peticiones = [];
  await worker.scheduled({ scheduledTime: ahora }, env, ctx);
  await Promise.all(pendientes);

  for (const id of [a1, a1b, a3, a4, a10, a12, a13]) {
    const r = leer(id);
    assert.equal(r.estado, "rechazada", `la solicitud ${id} debía quedar rechazada`);
    assert.equal(r.revisado_por, "Sistema (automático)");
    assert.match(r.nota_admin, /Rechazada automáticamente/);
    assert.ok(r.revisado_at);
  }
  assert.match(leer(a1b).nota_admin, /^Pedida el lunes · Rechazada automáticamente/, "conserva la nota previa");

  assert.equal(leer(a2).estado, "solicitada");
  assert.equal(leer(a5).estado, "pendiente");
  assert.equal(leer(a6).estado, "aprobada");
  assert.equal(leer(a7).estado, "pendiente");
  assert.equal(leer(a8).estado, "pendiente");
  assert.equal(leer(a9).estado, "pendiente");
  assert.equal(leer(a11).estado, "cancelada");
  assert.equal(leer(a14).estado, "solicitada", "fecha del texto en el futuro: no se toca");

  // Nunca correo al solicitante.
  assert.deepEqual(peticiones.filter((p) => /resend\.com/.test(p.url) && p.method === "POST"), [], "no debe enviarse ningún correo");

  // Queda constancia en el registro de actividad.
  const log = sqlite.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE accion = 'acreditacion_rechazada_auto'").get();
  assert.equal(Number(log.c), 7);
});

test("una segunda pasada inmediata no repite nada (límite de frecuencia) y respeta lo resuelto a mano", async () => {
  const id = acred({ equipo: "Equipo Sin Partido", fecha: madrid(ahora - DIA).dia });
  await worker.scheduled({ scheduledTime: Date.now() }, env, ctx);
  await Promise.all(pendientes);
  assert.equal(leer(id).estado, "pendiente", "dentro del intervalo no vuelve a revisar");
});
