// Fase 3: buscador de jugadores (/api/stats/buscar) y sitemap de fichas (/sitemap-jugadores.xml).
//   node --no-warnings --test tests/descubrimiento-jugadores.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/descubrimiento-jugadores.test.mjs
//
// Usa el esquema REAL (worker/schema.sql) sobre SQLite en memoria: se comprueba la
// ruta completa (consultas a D1, agregado, correcciones del panel, caché y XML).
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
const columnas = (t) => sqlite.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [tabla, col, mig] of [
  ["articles", "banner_urgente", "migracion_banner_urgente.sql"],
  ["results", "mvp_jugador", "migracion_mvp_partido.sql"],
]) {
  if (!columnas(tabla).includes(col)) sqlite.exec(readFileSync(new URL("../" + mig, import.meta.url), "utf8"));
}

const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
let lecturasDB = 0;
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => { lecturasDB++; return st.get(...limpiar(args)) ?? null; },
      all: async () => { lecturasDB++; return { results: st.all(...limpiar(args)) }; },
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
};
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef", TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil() {} };

async function pedir(ruta, opciones = {}, entorno = env) {
  return worker.fetch(new Request("https://api.test" + ruta, opciones), entorno, ctx);
}
const jsonDe = async (ruta) => { const r = await pedir(ruta); return { status: r.status, cuerpo: await r.json() }; };

// ---- Datos: 2 partidos de Segunda Federación de hoy + 1 de Primera ----
const hoy = new Date().toISOString().slice(0, 10);
const partido = (comp, grupo, local, visitante, gl, gv) => Number(sqlite.prepare(
  `INSERT INTO results (competicion, grupo, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado)
   VALUES (?,?,?,?,?,?,?,?, 'finalizado')`).run(comp, grupo, 1, local, visitante, gl, gv, hoy).lastInsertRowid);
const p1 = partido("segunda_federacion", "Grupo 1", "CD Castellón", "Real Unión", 3, 1);
const p2 = partido("primera_federacion", null, "Burgos CF", "Zamora CF", 1, 0);
const evento = (rid, tipo, equipo, jugador, minuto, asist = null) => sqlite.prepare(
  "INSERT INTO match_events (resultado_id, tipo, equipo, jugador, jugador_asistencia, minuto) VALUES (?,?,?,?,?,?)").run(rid, tipo, equipo, jugador, asist, minuto);
sqlite.prepare("INSERT INTO alineaciones (result_id, equipo, jugadores) VALUES (?,?,?)").run(p1, "CD Castellón", JSON.stringify([
  { nombre: "Rodrigo Martínez", dorsal: 9, titular: true }, { nombre: "Rodrigo Pérez", dorsal: 4, titular: true }, { nombre: "Pablo Gómez", dorsal: 7, titular: true },
]));
evento(p1, "gol", "local", "Rodrigo Martínez", 10, "Pablo Gómez");
evento(p1, "gol", "local", "Rodrigo Martínez", 40);
evento(p1, "gol", "local", "Pablo Gómez", 70);
evento(p1, "roja", "visitante", "5", 80);               // solo dorsal: sin nombre
evento(p1, "amarilla", "visitante", "Mikel Ruiz", 33);
evento(p2, "gol", "local", "Rodrigo Santos", 5);

test("buscar: encuentra por nombre, con competición, slug y datos para enlazar", async () => {
  const { status, cuerpo } = await jsonDe("/api/stats/buscar?q=rodrigo&competicion=segunda_federacion");
  assert.equal(status, 200);
  assert.equal(cuerpo.jugadores.length, 2);
  assert.equal(cuerpo.jugadores[0].jugador, "Rodrigo Martínez"); // más goles primero
  assert.equal(cuerpo.jugadores[0].goles, 2);
  assert.equal(cuerpo.jugadores[0].competicion, "segunda_federacion");
  assert.match(cuerpo.jugadores[0].slug, /^cd-castellon~/);
  assert.equal(cuerpo.limite, 10);
});

test("buscar: sin competición busca en las tres", async () => {
  const { cuerpo } = await jsonDe("/api/stats/buscar?q=rodrigo");
  assert.equal(cuerpo.jugadores.length, 3);
  assert.deepEqual([...new Set(cuerpo.jugadores.map((j) => j.competicion))].sort(), ["primera_federacion", "segunda_federacion"]);
});

test("buscar: club, tildes y fichas solo con dorsal", async () => {
  let r = (await jsonDe("/api/stats/buscar?q=castellon")).cuerpo;
  assert.deepEqual(r.clubes.map((c) => c.club), ["CD Castellón"]);
  r = (await jsonDe("/api/stats/buscar?q=martinez&competicion=segunda_federacion")).cuerpo;
  assert.equal(r.jugadores.length, 1);
  r = (await jsonDe("/api/stats/buscar?q=dorsal&competicion=segunda_federacion")).cuerpo;
  assert.equal(r.jugadores.length, 0);
});

test("buscar: consulta corta o vacía → listas vacías sin leer la base de datos", async () => {
  for (const q of ["", "a", "%20%20"]) {
    const antes = lecturasDB;
    const { status, cuerpo } = await jsonDe("/api/stats/buscar?q=" + q + "&competicion=hypermotion");
    assert.equal(status, 200);
    assert.deepEqual([cuerpo.jugadores, cuerpo.clubes], [[], []]);
    assert.equal(lecturasDB, antes);
  }
});

test("buscar: competición inválida → 400", async () => {
  const { status } = await jsonDe("/api/stats/buscar?q=rodrigo&competicion=liga_fantasma");
  assert.equal(status, 400);
});

test("buscar: la respuesta se cachea (misma consulta no vuelve a leer D1)", async () => {
  await jsonDe("/api/stats/buscar?q=pablo&competicion=segunda_federacion");
  const antes = lecturasDB;
  const { cuerpo } = await jsonDe("/api/stats/buscar?q=pablo&competicion=segunda_federacion");
  assert.equal(cuerpo.jugadores.length, 1);
  assert.equal(lecturasDB, antes);
});

test("buscar: otra consulta de la misma competición reutiliza el agregado ya calculado", async () => {
  await jsonDe("/api/stats/buscar?q=pablo&competicion=segunda_federacion");
  const antes = lecturasDB;
  const { cuerpo } = await jsonDe("/api/stats/buscar?q=mikel&competicion=segunda_federacion");
  assert.equal(cuerpo.jugadores.length, 1);
  assert.equal(lecturasDB, antes, "no hubo lecturas nuevas a D1");
});

test("las correcciones del panel (ocultar) se aplican y una escritura vacía las cachés", async () => {
  const slug = "cd-castellon~rodrigo-perez";
  const id = Number(sqlite.prepare("INSERT INTO jugadores (slug, club, nombre, dorsal, oculto) VALUES (?,?,?,?,1)").run(slug, "CD Castellón", "Rodrigo Pérez", 4).lastInsertRowid);
  sqlite.prepare("INSERT INTO jugador_alias (jugador_id, club, clave) VALUES (?,?,?)").run(id, "CD Castellón", "rodrigo perez");
  // Todavía cacheado: sigue saliendo (la frescura máxima es el TTL).
  let { cuerpo } = await jsonDe("/api/stats/buscar?q=rodrigo&competicion=segunda_federacion");
  const antes = cuerpo.jugadores.length;
  // Cualquier escritura a /api/ vacía las cachés de ese isolate (aquí, una sin sesión: 401).
  const w = await pedir("/api/admin/jugadores/fusionar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(w.status, 401);
  ({ cuerpo } = await jsonDe("/api/stats/buscar?q=rodrigo&competicion=segunda_federacion"));
  assert.ok(cuerpo.jugadores.every((j) => j.jugador !== "Rodrigo Pérez"), "el jugador oculto ya no se encuentra");
  assert.equal(cuerpo.jugadores.length, antes - 1);
});

test("sitemap-jugadores.xml: XML válido con plantillas y fichas, sin ocultos ni fichas sin nombre", async () => {
  const r = await pedir("/sitemap-jugadores.xml");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /application\/xml/);
  const xml = await r.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/elotrofutbol\.media\/plantilla\?c=segunda_federacion&amp;club=CD%20Castell%C3%B3n<\/loc>/);
  assert.match(xml, /<loc>https:\/\/elotrofutbol\.media\/jugador\?c=segunda_federacion&amp;j=cd-castellon~rodrigo-martinez<\/loc>/);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.ok(!xml.includes("rodrigo-perez"), "el oculto no está");
  assert.ok(!xml.includes("dorsal-"), "las fichas solo con dorsal no están");
  assert.ok(!/&(?!amp;)/.test(xml), "ningún & sin escapar");
  assert.ok(xml.includes("primera_federacion"), "incluye otras competiciones");
});

test("sitemap-jugadores.xml: si la base de datos falla responde 503, no un sitemap vacío", async () => {
  const roto = { ...env, DB: { prepare() { throw new Error("D1 caída"); } } };
  // Caché de fuentes vacía: una escritura en este mismo isolate la limpia.
  await pedir("/api/admin/jugadores/fusionar", { method: "POST", body: "{}" });
  const r = await pedir("/sitemap-jugadores.xml", {}, roto);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("Retry-After"), "300");
});
