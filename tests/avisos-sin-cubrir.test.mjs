import { DatabaseSync } from "node:sqlite";
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

// Tramos reales del Worker (nada reescrito a mano)
const codigo = [
  entre("function escapeHtmlEmail(", "\n}\n") + "\n}\n",
  entre("function plantillaEmail(", "\n// ---------- Newsletter"),
  entre("const UMBRAL_PRIMERA_PARTE_SIN_DESCANSO", "// Umbral de partido \"colgado\""),
  entre("function minutoEnVivoServidor(", "// ---------- Avisos de partidos sin cubrir"),
  entre("// ---------- Avisos de partidos sin cubrir", "async function publicarArticulosProgramados"),
].join("\n");

// ---- BD real (SQLite) con el esquema mínimo ----
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE results (id INTEGER PRIMARY KEY, competicion TEXT, jornada INTEGER, equipo_local TEXT, equipo_visitante TEXT,
    autor_id INTEGER, autor_nombre TEXT, estado TEXT, finalizado_no_cubierto INTEGER DEFAULT 0,
    inicio_cronometro_at TEXT, cronometro_pausado_en INTEGER, ajuste_cronometro_minutos INTEGER DEFAULT 0,
    aviso_desatendido_mitad TEXT);
  CREATE TABLE match_events (id INTEGER PRIMARY KEY AUTOINCREMENT, resultado_id INTEGER, tipo TEXT, created_at TEXT);
  CREATE TABLE avisos_desatendidos_cola (resultado_id INTEGER PRIMARY KEY, partido TEXT NOT NULL, jornada INTEGER,
    redactor TEXT, motivo_corto TEXT NOT NULL, encolado_ms INTEGER NOT NULL);
`);
const env = {
  DB: {
    prepare(sql) {
      const st = db.prepare(sql);
      let params = [];
      const o = {
        bind(...p) { params = p; return o; },
        async first() { return st.get(...params) ?? null; },
        async all() { return { results: st.all(...params) }; },
        async run() { st.run(...params); return { success: true }; },
      };
      return o;
    },
  },
};

const enviados = [];
const ctx = {
  SITIO_URL: "https://elotrofutbol.media",
  EMAIL_NOTIFICACIONES: "avisos@test",
  console,
  Date, Math, Number, String, Array, Set, Map, Promise, Infinity, isNaN,
  enviarEmailNotificacion: async (_env, msg, opts) => { enviados.push({ ...msg, destinatario: opts?.destinatario }); return true; },
  registrarActividad: async () => {},
};
vm.createContext(ctx);
vm.runInContext(codigo + "\nthis.__api = { revisarPartidosDesatendidos, evaluarSituacionDesatendida, leerColaAvisosDesatendidos, fechaBdAMs };", ctx);
const api = ctx.__api;

// ---- helpers de fecha ----
const ts = (minAtras) => new Date(Date.now() - minAtras * 60000).toISOString().replace("T", " ").slice(0, 19);
function partido(id, { estado = "en_juego", inicioMinAtras = null, ajuste = 0, pausadoEn = null, autor = "Ana López", comp = "hypermotion", jornada = 5, noCubierto = 0, mitad = null, local = `Local ${id}`, visit = `Visit ${id}` }) {
  db.prepare(`INSERT INTO results (id, competicion, jornada, equipo_local, equipo_visitante, autor_nombre, estado, finalizado_no_cubierto,
    inicio_cronometro_at, cronometro_pausado_en, ajuste_cronometro_minutos, aviso_desatendido_mitad) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, comp, jornada, local, visit, autor, estado, noCubierto, inicioMinAtras === null ? null : ts(inicioMinAtras), pausadoEn, ajuste, mitad);
}
function evento(resultadoId, tipo, minAtras) {
  db.prepare("INSERT INTO match_events (resultado_id, tipo, created_at) VALUES (?,?,?)").run(resultadoId, tipo, ts(minAtras));
}
const enCola = () => db.prepare("SELECT resultado_id FROM avisos_desatendidos_cola ORDER BY resultado_id").all().map((f) => f.resultado_id);
const cargarEnJuego = () => db.prepare(`SELECT id, competicion, jornada, equipo_local, equipo_visitante, autor_id, autor_nombre,
  inicio_cronometro_at, cronometro_pausado_en, ajuste_cronometro_minutos, aviso_desatendido_mitad FROM results WHERE estado='en_juego'`).all();

// ---- escenarios ----
// 1: 2ª parte NORMAL: min. 60 corriendo (45 + 15), descanso y fin_descanso, último evento hace 10' -> NO avisar
partido(1, { inicioMinAtras: 15, ajuste: 45 });
evento(1, "inicio_partido", 75); evento(1, "descanso", 30); evento(1, "fin_descanso", 15); evento(1, "gol", 10);
// 2: 1ª parte abandonada: min. 60 corriendo, descanso AUTOMÁTICO del cron, sin fin_descanso -> sin_descanso
partido(2, { inicioMinAtras: 60, autor: "Luis Gil" });
evento(2, "inicio_partido", 60); evento(2, "descanso", 15);
// 3: 2ª parte abandonada: min. 105 corriendo, último evento hace 40' -> sin_final
partido(3, { inicioMinAtras: 60, ajuste: 45, autor: null, comp: "segunda_federacion", jornada: 6 });
evento(3, "fin_descanso", 55); evento(3, "gol", 40);
// 4: parado en el descanso desde hace 30' -> descanso_sin_reanudar
partido(4, { inicioMinAtras: 80, pausadoEn: 45, autor: "Ana López", comp: "primera_federacion" });
evento(4, "descanso", 30);
// 5: min. 62 sin fin_descanso PERO con un evento hace 2' -> cubierto, NO avisar
partido(5, { inicioMinAtras: 62 });
evento(5, "gol", 2);
// 6: en el descanso desde hace 10' -> normal, NO avisar
partido(6, { inicioMinAtras: 55, pausadoEn: 45 });
evento(6, "descanso", 10);

const detectados = {};
for (const p of cargarEnJuego()) detectados[p.id] = await api.evaluarSituacionDesatendida(env, p);
assert.equal(detectados[1], null, "2ª parte normal no debe avisar");
assert.equal(detectados[2].tipo, "sin_descanso");
assert.equal(detectados[3].tipo, "sin_final");
assert.equal(detectados[4].tipo, "descanso_sin_reanudar");
assert.equal(detectados[5], null, "con actividad reciente no debe avisar");
assert.equal(detectados[6], null, "descanso reciente no debe avisar");
console.log("✔ evaluación por tipo (2ª parte normal y actividad reciente ya no dan falsos avisos)");

// Detección + cola (cron de un minuto)
await api.revisarPartidosDesatendidos(env, ctx, cargarEnJuego());
assert.deepEqual(enCola(), [2, 3, 4]);
assert.equal(enviados.length, 0, "aún no toca enviar (lote 20 / espera 30')");
console.log("✔ cola:", enCola(), "y ningún email todavía");

// Segundo minuto: no vuelve a encolar (una vez por mitad) ni duplica
await api.revisarPartidosDesatendidos(env, ctx, cargarEnJuego());
assert.deepEqual(enCola(), [2, 3, 4]);
console.log("✔ idempotente: una vez por mitad");

// Casos que solo se ven al ENVIAR:
// 7: encolado pero cerrado por el cron (finalizado_no_cubierto) -> "cerrado_auto"
partido(7, { estado: "finalizado", noCubierto: 1, autor: "Luis Gil", jornada: 4 });
// 8: encolado pero ya resuelto a mano -> se descarta
partido(8, { estado: "finalizado", noCubierto: 0 });
// 2 se resuelve durante la espera (redactor inicia la 2ª parte) -> se descarta
evento(2, "fin_descanso", 1);
db.prepare("UPDATE results SET cronometro_pausado_en = NULL, ajuste_cronometro_minutos = 45, inicio_cronometro_at = ? WHERE id = 2").run(ts(15));
const viejo = Date.now() - 31 * 60000;
for (const id of [7, 8]) db.prepare("INSERT INTO avisos_desatendidos_cola VALUES (?,?,?,?,?,?)").run(id, `Local ${id} - Visit ${id}`, 4, null, "x", viejo);
db.prepare("UPDATE avisos_desatendidos_cola SET encolado_ms = ?").run(viejo); // el más antiguo lleva 31' esperando

await api.revisarPartidosDesatendidos(env, ctx, cargarEnJuego());
assert.deepEqual(enCola(), [], "la cola se vacía al enviar");
assert.equal(enviados.length, 1, "un único email");
const mail = enviados[0];
console.log("\n===== ASUNTO =====\n" + mail.asunto);
console.log("\n===== TEXTO =====\n" + mail.texto + "\n");

assert.match(mail.asunto, /^⚠️ 3 partidos sin cubrir/);
assert.match(mail.asunto, /1 sin final/);
assert.match(mail.asunto, /1 parados en el descanso/);
assert.match(mail.asunto, /1 cerrados por el sistema/);
assert.doesNotMatch(mail.asunto, /sin descanso/, "el partido 2 se resolvió durante la espera");
assert.ok(!mail.texto.includes("Local 8"), "el resuelto a mano no aparece");
assert.ok(!mail.texto.includes("Local 2 "), "el que retomó la 2ª parte no aparece");
assert.ok(mail.texto.includes("panel.html?minuto_a_minuto=3"));
assert.ok(!mail.texto.includes("/admin/minuto-a-minuto.html"), "ya no hay enlaces a páginas inexistentes");
assert.ok(!mail.html.includes("/admin/resultados.html"));
assert.ok(mail.html.includes("panel.html?ir=resultados.lista&sin_cubrir=1"));
// orden por gravedad: sin final -> descanso -> cerrado
const iF = mail.texto.indexOf("SIN FINAL"), iD = mail.texto.indexOf("PARADOS EN EL DESCANSO"), iC = mail.texto.indexOf("CERRADOS AUTOM");
assert.ok(iF >= 0 && iF < iD && iD < iC, "grupos ordenados de más a menos grave");
assert.ok(mail.texto.includes("Por redactor:"));
console.log("✔ email único, agrupado por tipo, sin los resueltos y con enlaces válidos");

// Cola que se queda vacía tras validar -> no se envía nada
enviados.length = 0;
db.prepare("INSERT INTO avisos_desatendidos_cola VALUES (?,?,?,?,?,?)").run(8, "Local 8 - Visit 8", 4, null, "x", viejo);
await api.revisarPartidosDesatendidos(env, ctx, []);
assert.equal(enviados.length, 0);
assert.deepEqual(enCola(), []);
console.log("✔ si todo se resolvió durante la espera, no se manda email");

// Tope de filas y fechas tipo Date (driver pg)
assert.equal(api.fechaBdAMs(new Date(1700000000000)), 1700000000000);
assert.equal(api.fechaBdAMs("2026-09-29 10:00:00"), Date.UTC(2026, 8, 29, 10, 0, 0));
assert.equal(api.fechaBdAMs("2026-09-29T10:00:00Z"), Date.UTC(2026, 8, 29, 10, 0, 0));
assert.ok(Number.isNaN(api.fechaBdAMs(null)));
console.log("✔ fechas: D1, ISO y Date de pg");

fs.writeFileSync("/tmp/digest.html", mail.html);
console.log("\nTODO OK  (" + ruta + ")");
