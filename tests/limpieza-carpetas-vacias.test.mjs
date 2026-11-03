// Limpieza de carpetas privadas vacías: se borran a los 5 días de quedar vacías.
// Se extrae el bloque real del código fuente y se ejecuta contra SQLite en memoria.
//   node --test tests/limpieza-carpetas-vacias.test.mjs
//   (en worker-secondary: node --test test/limpieza-carpetas-vacias.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ruta = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url);
const fuente = readFileSync(ruta, "utf8");
const ini = fuente.indexOf("// ---------- LIMPIEZA DE CARPETAS PRIVADAS VACÍAS");
const fin = fuente.indexOf("// ---------- Notificaciones por correo ----------");
assert.ok(ini > 0 && fin > ini, "no se encuentra el bloque de limpieza de carpetas");

const DIA = 24 * 3600 * 1000;
function montar() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE media_carpetas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, creada_por_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, carpeta_id INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, accion TEXT, entidad_id TEXT, descripcion TEXT);
    INSERT INTO media_carpetas (nombre) VALUES ('Vacía'), ('Con fotos'), ('Otra vacía');
    INSERT INTO media (carpeta_id) VALUES (2);
  `);
  const DB = {
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return st;
    },
  };
  const registrarActividad = async (env, req, payload, d) => {
    sqlite.prepare("INSERT INTO activity_log (accion, entidad_id, descripcion) VALUES (?, ?, ?)").run(d.accion, d.entidad_id, d.descripcion);
  };
  const lib = new Function("registrarActividad", `${fuente.slice(ini, fin)}\nreturn { limpiar: limpiarCarpetasVaciasSiToca, plan: planificarLimpiezaCarpetasVacias, reset(){ CARPETAS_LIMPIEZA_ULTIMO_MS = 0; } };`)(registrarActividad);
  return { sqlite, env: { DB }, ...lib };
}

test("plan: las carpetas vacías sin fecha guardada empiezan a contar ahora", () => {
  const ahora = Date.now();
  const { mapa, borrar } = montar().plan({}, [{ id: 1 }], ahora);
  assert.equal(borrar.length, 0);
  assert.equal(Date.parse(mapa[1]), ahora);
});

test("plan: a los 5 días exactos se borra; a los 4 días y 23 h, no", () => {
  const ahora = Date.now();
  const l = montar();
  assert.equal(l.plan({ 1: new Date(ahora - 5 * DIA).toISOString() }, [{ id: 1 }], ahora).borrar.length, 1);
  assert.equal(l.plan({ 1: new Date(ahora - 5 * DIA + 3600 * 1000).toISOString() }, [{ id: 1 }], ahora).borrar.length, 0);
});

test("plan: una carpeta que ya no está vacía sale del mapa (el contador se reinicia)", () => {
  const ahora = Date.now();
  const { mapa } = montar().plan({ 1: new Date(ahora - 9 * DIA).toISOString(), 2: new Date(ahora - DIA).toISOString() }, [{ id: 2 }], ahora);
  assert.deepEqual(Object.keys(mapa), ["2"]);
});

test("plan: una fecha guardada rara o futura se trata como 'vacía desde ahora'", () => {
  const ahora = Date.now();
  const { mapa, borrar } = montar().plan({ 1: "basura", 2: new Date(ahora + 3 * DIA).toISOString() }, [{ id: 1 }, { id: 2 }], ahora);
  assert.equal(borrar.length, 0);
  assert.equal(Date.parse(mapa[1]), ahora);
  assert.equal(Date.parse(mapa[2]), ahora);
});

test("primera pasada: apunta las vacías, no borra nada y no toca las que tienen archivos", async () => {
  const { sqlite, env, limpiar } = montar();
  assert.equal(await limpiar(env), 0);
  const mapa = JSON.parse(sqlite.prepare("SELECT value FROM settings WHERE key='carpetas_vacias_desde'").get().value);
  assert.deepEqual(Object.keys(mapa).sort(), ["1", "3"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM media_carpetas").get().n, 3);
});

test("pasada con 5 días cumplidos: borra solo las vacías y lo registra", async () => {
  const { sqlite, env, limpiar, reset } = montar();
  const hace6 = new Date(Date.now() - 6 * DIA).toISOString();
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('carpetas_vacias_desde', ?)").run(JSON.stringify({ 1: hace6, 3: new Date().toISOString() }));
  reset();
  assert.equal(await limpiar(env), 1);
  const quedan = sqlite.prepare("SELECT nombre FROM media_carpetas ORDER BY id").all().map((c) => c.nombre);
  assert.deepEqual(quedan, ["Con fotos", "Otra vacía"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity_log WHERE accion='borrar_carpeta_media_vacia'").get().n, 1);
  const mapa = JSON.parse(sqlite.prepare("SELECT value FROM settings WHERE key='carpetas_vacias_desde'").get().value);
  assert.deepEqual(Object.keys(mapa), ["3"]);
});

test("si la carpeta recibe un archivo antes del borrado, se conserva y su contador se anula", async () => {
  const { sqlite, env, limpiar, reset } = montar();
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('carpetas_vacias_desde', ?)").run(JSON.stringify({ 1: new Date(Date.now() - 8 * DIA).toISOString() }));
  sqlite.prepare("INSERT INTO media (carpeta_id) VALUES (1)").run();
  reset();
  assert.equal(await limpiar(env), 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM media_carpetas WHERE id = 1").get().n, 1);
  const mapa = JSON.parse(sqlite.prepare("SELECT value FROM settings WHERE key='carpetas_vacias_desde'").get().value);
  assert.equal(mapa[1], undefined);
});

test("sin la tabla de carpetas no falla", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); CREATE TABLE media (id INTEGER PRIMARY KEY, carpeta_id INTEGER);");
  const env = { DB: { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: sqlite.prepare(sql).all(...a) }; }, async first() { return sqlite.prepare(sql).get(...a) || null; }, async run() { sqlite.prepare(sql).run(...a); return { meta: { changes: 1 } }; } }; return st; } } };
  const { limpiar } = new Function("registrarActividad", `${fuente.slice(ini, fin)}\nreturn { limpiar: limpiarCarpetasVaciasSiToca };`)(async () => {});
  assert.equal(await limpiar(env), 0);
});
