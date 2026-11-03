// Recordatorio de galería a fotógrafos acreditados (worker/src/index.js).
// Uso: node tests/recordatorio-galeria.test.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ruta = process.argv[2] || new URL("../src/index.js", import.meta.url).pathname;
const fuente = fs.readFileSync(ruta, "utf-8").replace(/\r\n/g, "\n");
function entre(ini, fin) {
  const a = fuente.indexOf(ini);
  const b = fuente.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, `no encuentro tramo ${ini} -> ${fin}`);
  return fuente.slice(a, b);
}
const funcion = (nombre) => entre(`function ${nombre}(`, "\n}\n") + "\n}\n";

const codigo = [
  funcion("aSqliteDatetimeUTC"), funcion("offsetMadridEnMinutos"), funcion("fechaPartidoAUtcSqlite"),
  funcion("msDesdeFechaBD"), funcion("diaYHoraEnMadrid"), funcion("syncSinAcentos"), funcion("syncClaveEquipo"),
  funcion("escapeHtmlEmail"),
  entre("const ALIAS_CLUBES_CANONICOS", "// Clave \"gruesa\" de un equipo"),
  entre("const TONOS_EMAIL", "// ---------- Newsletter"),
  entre("const GALERIA_RECORDATORIO_INTERVALO_MS", "async function enviarRecordatoriosInactividadSiToca"),
].join("\n");

const NOW = Date.parse("2026-10-24T20:30:00Z"); // 22:30 en Madrid (CEST)
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE results (id INTEGER PRIMARY KEY, jornada INTEGER, equipo_local TEXT, equipo_visitante TEXT,
    goles_local INTEGER, goles_visitante INTEGER, fecha_partido TEXT, estado TEXT);
  CREATE TABLE acreditaciones (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT, equipo TEXT, tipo_acreditacion TEXT,
    jornada_partido TEXT, fecha_partido TEXT, estado TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, activo INTEGER DEFAULT 1);
  CREATE TABLE media (id INTEGER PRIMARY KEY, autor_id INTEGER);
  CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER, media_id INTEGER, vinculado_por_id INTEGER);
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
        async run() { const r = st.run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
      return o;
    },
  },
};
let falla = false;
const enviados = [];
const ctx = {
  SITIO_URL: "https://elotrofutbol.media", EMAIL_NOTIFICACIONES: "avisos@test",
  console, Date: FakeDate, Math, Number, String, Array, Set, Map, Promise, Intl, isNaN, RegExp,
  enviarEmailNotificacion: async (_e, msg, opts) => { if (falla) return false; enviados.push({ ...msg, destinatario: opts?.destinatario }); return true; },
};
vm.createContext(ctx);
vm.runInContext(codigo + "\nthis.__api = { enviarRecordatoriosGaleriaSiToca, partidoDeAcreditacionGaleria, mismoEquipoGaleria };", ctx);
const api = ctx.__api;
const reiniciarIntervalo = () => vm.runInContext("GALERIA_RECORDATORIO_ULTIMO_MS = 0", ctx);

const R = db.prepare("INSERT INTO results (id, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado) VALUES (?,?,?,?,?,?,?,?)");
R.run(1, 9, "CD Castellón", "Real Avilés", 2, 1, "2026-10-24T18:00", "finalizado");     // acabó hace rato
R.run(2, 9, "Racing Ferrol", "CD Lugo", 0, 0, "2026-10-24T21:00", "finalizado");        // aún no toca (empezó hace 1,5 h)
R.run(3, 9, "Real Murcia", "Intercity", 1, 1, "2026-10-24", "finalizado");              // solo fecha, ya son las 22:30
R.run(4, 10, "CD Castellón", "Real Avilés", null, null, "2026-10-24T18:00", "programado"); // no finalizado
R.run(5, 8, "UD Logroñés", "Real Avilés", 3, 0, "2026-10-23T20:00", "finalizado");     // ayer
const A = db.prepare("INSERT INTO acreditaciones (id, nombre, email, equipo, tipo_acreditacion, jornada_partido, fecha_partido, estado) VALUES (?,?,?,?,?,?,?,?)");
A.run(1, "Laura Pérez Gómez", "laura@x.es", "CD Castellón", "Fotógrafo (césped)", "Jornada 9: CD Castellón - Real Avilés", null, "aprobada");
A.run(2, "Pepe Ruiz", "pepe@x.es", "Real Avilés", "Fotógrafo (césped)", "Jornada 9 Castellón-Avilés", null, "aprobada");    // ya subió su galería
A.run(3, "Ana Prensa", "ana@x.es", "CD Castellón", "Prensa (pupitre)", "Jornada 9", null, "aprobada");                       // no es fotógrafo
A.run(4, "Rosa Pendiente", "rosa@x.es", "CD Castellón", "Fotógrafo (césped)", "Jornada 9", null, "pendiente");               // no aprobada
A.run(5, "Sin Datos", "sin@x.es", "Real Murcia", "Fotógrafo (césped)", "", null, "aprobada");                               // ni fecha ni jornada: no se adivina
A.run(6, "Marta Soler Gil", "marta@x.es", "Real Murcia", "Fotógrafo (césped)", "Murcia - Intercity", "2026-10-24", "aprobada"); // solo fecha
A.run(7, "Tarde Todavía", "tarde@x.es", "Racing Ferrol", "Fotógrafo (césped)", "Jornada 9", null, "aprobada");             // partido 2 aún no toca
A.run(8, "Otra Jornada", "otra@x.es", "CD Castellón", "Fotógrafo (césped)", "Jornada 10", null, "aprobada");                // la jornada 10 no está finalizada
A.run(9, "Luis Ayer", "luis@x.es", "UD Logroñés", "Fotógrafo (césped)", "J8 Logroñés - Avilés", null, "aprobada");          // partido de ayer
db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(11, "laura@x.es");
db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(12, "PEPE@x.es");
db.prepare("INSERT INTO media (id, autor_id) VALUES (100, 12)").run();
db.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (1, 100, 12)").run();

// ---- emparejamiento acreditación -> partido ----
const todos = db.prepare("SELECT * FROM results WHERE estado = 'finalizado'").all();
assert.equal(api.partidoDeAcreditacionGaleria(db.prepare("SELECT * FROM acreditaciones WHERE id=1").get(), todos).id, 1);
assert.equal(api.partidoDeAcreditacionGaleria(db.prepare("SELECT * FROM acreditaciones WHERE id=5").get(), todos), null, "sin fecha ni jornada no se adivina");
assert.equal(api.partidoDeAcreditacionGaleria(db.prepare("SELECT * FROM acreditaciones WHERE id=8").get(), todos), null, "otra jornada");
assert.equal(api.mismoEquipoGaleria("Celta Fortuna", "RC Celta"), false, "equipos filiales no se confunden");

// ---- pasada completa ----
const n1 = await api.enviarRecordatoriosGaleriaSiToca(env);
const destinos = enviados.map((e) => e.destinatario).sort();
assert.deepEqual(destinos, ["laura@x.es", "luis@x.es", "marta@x.es"], "solo a quien toca: " + destinos);
assert.equal(n1, 3);
const laura = enviados.find((e) => e.destinatario === "laura@x.es");
assert.match(laura.asunto, /CD Castellón - Real Avilés/);
assert.match(laura.html, /Galería de partido/);
assert.match(laura.html, /admin\/panel\.html/);
assert.match(laura.html, /2 ?- ?1|2-1/);
assert.match(laura.texto, /mensaje automático/i);
assert.doesNotMatch(laura.texto, /sin acceso/i);
const marta = enviados.find((e) => e.destinatario === "marta@x.es");
assert.match(marta.texto, /aún no tienes acceso al panel/i, "sin cuenta: lo dice");

// ---- sin duplicados ----
reiniciarIntervalo();
assert.equal(await api.enviarRecordatoriosGaleriaSiToca(env), 0);
assert.equal(enviados.length, 3);
// Pepe ya subió: queda anotado pero no se le escribe nunca
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recordatorios_galeria WHERE acreditacion_id = 2").get().n, 1);

// ---- intervalo de 10 min: otra llamada seguida no hace nada ----
assert.equal(await api.enviarRecordatoriosGaleriaSiToca(env), 0);

// ---- si el envío falla se libera y se reintenta ----
db.prepare("DELETE FROM recordatorios_galeria WHERE acreditacion_id = 6").run();
falla = true; reiniciarIntervalo();
assert.equal(await api.enviarRecordatoriosGaleriaSiToca(env), 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recordatorios_galeria WHERE acreditacion_id = 6").get().n, 0, "fallo -> se libera");
falla = false; reiniciarIntervalo();
assert.equal(await api.enviarRecordatoriosGaleriaSiToca(env), 1);
assert.equal(enviados.at(-1).destinatario, "marta@x.es");

// ---- interruptor ----
db.prepare("DELETE FROM recordatorios_galeria").run();
reiniciarIntervalo();
assert.equal(await api.enviarRecordatoriosGaleriaSiToca({ ...env, RECORDATORIO_GALERIA_DESACTIVADO: "1" }), 0);

console.log("recordatorio-galeria: OK");
