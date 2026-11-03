// Prueba de integración de las "Insignias por hitos" contra SQLite real (node:sqlite): comprueba
// que las consultas de calcularInsignias son válidas y que la lógica de extremo a extremo
// (crónica, fotos públicas, partido en directo, permanencia) da lo esperado. Uso:
//   node --no-warnings --test tests/insignias-hitos-sqlite.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ruta = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url);
const fuente = readFileSync(ruta, "utf8");
const ini = fuente.indexOf("const INSIGNIAS_HITOS");
const fin = fuente.indexOf("// Nivel efectivo de una fila de users según su rol");
assert.ok(ini > 0 && fin > ini, "no se encuentra el bloque de insignias");
const { calcularInsignias } = new Function(`${fuente.slice(ini, fin)}\nreturn { calcularInsignias };`)();

// Adaptador mínimo con la forma de D1: prepare(sql).bind(...).first()/all()/run().
function nuevaEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, accion TEXT, entidad TEXT, entidad_id TEXT, created_at TEXT);
    CREATE TABLE results (id INTEGER PRIMARY KEY, inicio_cronometro_at TEXT);
    CREATE TABLE media (id INTEGER PRIMARY KEY, visibilidad TEXT NOT NULL DEFAULT 'publico');
    CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER, media_id INTEGER, vinculado_por_id INTEGER);
  `);
  const DB = {
    prepare(sql) {
      const sentencia = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return sentencia.get(...args) ?? null; },
        async all() { return { results: sentencia.all(...args) }; },
        async run() { sentencia.run(...args); return { success: true }; },
      };
      return api;
    },
  };
  return { env: { DB }, db };
}
const porId = (lista, id) => lista.find((i) => i.id === id);

test("redactor nuevo: nada conseguido, y no guarda nada", async () => {
  const { env, db } = nuevaEnv();
  const l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 });
  assert.deepEqual(l.map((i) => [i.id, i.conseguida, i.actual]), [["primera_cronica", false, 0], ["fotos_10", false, 0], ["primer_directo", false, 0]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settings").get().n, 0);
});

test("primera crónica sale del conteo de publicaciones y se guarda", async () => {
  const { env, db } = nuevaEnv();
  const l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 2 });
  assert.equal(porId(l, "primera_cronica").conseguida, true);
  const fila = db.prepare("SELECT value FROM settings WHERE key = 'insignias_hitos:7'").get();
  assert.ok(JSON.parse(fila.value).primera_cronica);
});

test("fotos: solo cuentan las públicas vinculadas por esa persona; 10 = conseguida", async () => {
  const { env, db } = nuevaEnv();
  for (let i = 1; i <= 12; i++) db.prepare("INSERT INTO media (id, visibilidad) VALUES (?, ?)").run(i, i <= 9 ? "publico" : "privado");
  for (let i = 1; i <= 12; i++) db.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (1, ?, 5)").run(i);
  db.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (1, 1, 99)").run(); // de otra persona
  let l = await calcularInsignias(env, { id: 5, rol: "fotografo" }, {});
  assert.deepEqual(l.map((i) => i.id), ["fotos_10"]);
  assert.equal(l[0].actual, 9);
  assert.equal(l[0].conseguida, false);
  db.prepare("UPDATE media SET visibilidad = 'publico' WHERE id = 10").run();
  l = await calcularInsignias(env, { id: 5, rol: "fotografo" }, {});
  assert.equal(l[0].conseguida, true);
});

test("primer directo: evento durante el partido cuenta; uno añadido al día siguiente, no", async () => {
  const { env, db } = nuevaEnv();
  db.prepare("INSERT INTO results (id, inicio_cronometro_at) VALUES (1, '2026-10-25 16:00:00')").run();
  db.prepare("INSERT INTO results (id, inicio_cronometro_at) VALUES (2, '2026-10-25 18:00:00')").run();
  db.prepare("INSERT INTO results (id, inicio_cronometro_at) VALUES (3, NULL)").run();
  const ev = (uid, rid, cuando) => db.prepare("INSERT INTO activity_log (usuario_id, accion, entidad, entidad_id, created_at) VALUES (?, 'crear_evento_partido', 'resultado', ?, ?)").run(uid, String(rid), cuando);
  ev(7, 2, "2026-10-26 09:00:00"); // partido 2: lo rellenó al día siguiente
  ev(7, 3, "2026-10-25 20:00:00"); // partido 3: nunca se inició el cronómetro
  let l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 });
  assert.equal(porId(l, "primer_directo").conseguida, false);
  ev(7, 1, "2026-10-25 16:03:00"); // partido 1: en directo
  ev(7, 1, "2026-10-26 08:00:00"); // y corrige más tarde: no cambia nada
  l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 });
  assert.equal(porId(l, "primer_directo").conseguida, true);
});

test("el directo de otra persona no cuenta", async () => {
  const { env, db } = nuevaEnv();
  db.prepare("INSERT INTO results (id, inicio_cronometro_at) VALUES (1, '2026-10-25 16:00:00')").run();
  db.prepare("INSERT INTO activity_log (usuario_id, accion, entidad, entidad_id, created_at) VALUES (8, 'crear_evento_partido', 'resultado', '1', '2026-10-25 16:03:00')").run();
  const l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 });
  assert.equal(porId(l, "primer_directo").conseguida, false);
});

test("permanente: una vez guardada, sigue conseguida aunque los datos ya no la respalden", async () => {
  const { env } = nuevaEnv();
  await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 1 });
  const l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 }); // despublicó la crónica
  assert.equal(porId(l, "primera_cronica").conseguida, true);
});

test("admin: no aplica (null)", async () => {
  const { env } = nuevaEnv();
  assert.equal(await calcularInsignias(env, { id: 1, rol: "admin" }, {}), null);
});

test("si las tablas no existen, no revienta: todo a cero", async () => {
  const { env, db } = nuevaEnv();
  db.exec("DROP TABLE match_gallery; DROP TABLE activity_log; DROP TABLE settings;");
  const l = await calcularInsignias(env, { id: 7, rol: "redactor" }, { cronica: 0 });
  assert.ok(l.every((i) => !i.conseguida));
});
