// GET /api/galerias/partidos: portada pública de galerías (lista de partidos con fotos públicas).
// Ejecuta el handler REAL contra SQLite en memoria. Uso:
//   node --test tests/galerias-partidos.test.mjs
//   (en worker-secondary: node --test test/galerias-partidos.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const entrada = new URL(process.env.WORKER_ENTRY || "../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

function montar({ conVisibilidad = true, conFoco = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT);
    CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, equipo_local TEXT, equipo_visitante TEXT, escudo_local_url TEXT, escudo_visitante_url TEXT,
      goles_local INTEGER, goles_visitante INTEGER, penaltis_local INTEGER, penaltis_visitante INTEGER, fecha_partido TEXT, estado TEXT, competicion TEXT, jornada INTEGER);
    CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, cloudinary_url TEXT, titulo TEXT, descripcion TEXT, tipo TEXT, autor_id INTEGER, autor_nombre TEXT, club TEXT,
      created_at TEXT DEFAULT (datetime('now'))${conVisibilidad ? ", visibilidad TEXT DEFAULT 'publico'" : ""}${conFoco ? ", portada_foco TEXT" : ""});
    CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER, media_id INTEGER, orden INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), equipo TEXT);
  `);
  const partido = sqlite.prepare("INSERT INTO results (slug, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado, competicion, jornada) VALUES (?,?,?,?,?,?,?,?,?)");
  partido.run("celta-b-lugo", "Celta Fortuna", "CD Lugo", 2, 1, "2026-11-01", "finalizado", "primera_federacion", 9);
  partido.run("avila-logrones", "Avilés", "Logroñés", 0, 0, "2026-10-18", "finalizado", "segunda_federacion", 8);
  partido.run("sin-fotos", "Equipo X", "Equipo Y", 1, 1, "2026-10-25", "finalizado", "primera_federacion", 8);
  partido.run(null, "Sin", "Slug", 1, 1, "2026-10-30", "finalizado", "primera_federacion", 8);
  const nuevaFoto = (resultId, url, tipo, vis, orden) => {
    const m = sqlite.prepare(`INSERT INTO media (cloudinary_url, titulo, tipo${conVisibilidad ? ", visibilidad" : ""}${conFoco ? ", portada_foco" : ""}) VALUES (?,?,?${conVisibilidad ? ",?" : ""}${conFoco ? ",?" : ""})`)
      .run(...[url, "t", tipo, ...(conVisibilidad ? [vis] : []), ...(conFoco ? ["60% 30%"] : [])]);
    sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, orden) VALUES (?,?,?)").run(resultId, Number(m.lastInsertRowid), orden);
  };
  for (let i = 1; i <= 6; i++) nuevaFoto(1, `https://res.cloudinary.com/x/image/upload/v1/celta${i}.jpg`, "foto", "publico", i);
  nuevaFoto(1, "https://res.cloudinary.com/x/video/upload/v1/video.mp4", "video", "publico", 7);
  nuevaFoto(1, "https://res.cloudinary.com/x/image/upload/v1/privada.jpg", "foto", "privado", 0);
  nuevaFoto(2, "https://res.cloudinary.com/x/image/upload/v1/avila1.jpg", "foto", "publico", 1);
  nuevaFoto(2, "https://res.cloudinary.com/x/image/upload/v1/avila2.jpg", "foto", "privado", 2);
  nuevaFoto(4, "https://res.cloudinary.com/x/image/upload/v1/sinslug.jpg", "foto", "publico", 1);
  const DB = {
    prepare(sql) {
      const st = sqlite.prepare(sql);
      const mk = (args) => ({
        first: async () => st.get(...args) ?? null,
        all: async () => ({ results: st.all(...args) }),
        run: async () => { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      });
      return { ...mk([]), bind: (...args) => mk(args) };
    },
  };
  return { sqlite, env: { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef" } };
}
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
// El worker cachea las lecturas públicas por URL dentro del isolate: un parámetro único evita
// que un test reciba la respuesta cacheada de otro con datos distintos.
let contador = 0;
async function pedir(env, query = "") {
  const url = "https://api.test/api/galerias/partidos" + query + (query ? "&" : "?") + "t=" + (++contador);
  const res = await worker.fetch(new Request(url), env, ctx);
  return { status: res.status, data: await res.json() };
}

test("lista los partidos con fotos públicas, del más reciente al más antiguo, sin los de slug vacío ni sin fotos", async () => {
  const { env } = montar();
  const { status, data } = await pedir(env);
  assert.equal(status, 200);
  assert.deepEqual(data.partidos.map((p) => p.slug), ["celta-b-lugo", "avila-logrones"]);
  assert.equal(data.hayMas, false);
});

test("el total cuenta solo lo público (fotos + vídeos) y las muestras son 4 fotos con su foco", async () => {
  const { env } = montar();
  const { data } = await pedir(env);
  const celta = data.partidos[0];
  assert.equal(celta.total, 7); // 6 fotos + 1 vídeo; la privada no cuenta
  assert.equal(celta.fotos.length, 4);
  assert.ok(celta.fotos.every((f) => /celta\d\.jpg$/.test(f.url)), "solo fotos públicas, nunca el vídeo ni la privada");
  assert.equal(celta.fotos[0].foco, "60% 30%");
  const avila = data.partidos[1];
  assert.equal(avila.total, 1);
  assert.deepEqual(avila.fotos.map((f) => f.url.split("/").pop()), ["avila1.jpg"]);
});

test("filtra por competición y por equipo (sin distinguir mayúsculas)", async () => {
  const { env } = montar();
  assert.deepEqual((await pedir(env, "?competicion=segunda_federacion")).data.partidos.map((p) => p.slug), ["avila-logrones"]);
  assert.deepEqual((await pedir(env, "?q=CELTA")).data.partidos.map((p) => p.slug), ["celta-b-lugo"]);
  assert.deepEqual((await pedir(env, "?q=logro")).data.partidos.map((p) => p.slug), ["avila-logrones"]);
  assert.equal((await pedir(env, "?q=zzz")).data.partidos.length, 0);
});

test("un texto con comodines o una competición rara no rompe ni filtra de más", async () => {
  const { env } = montar();
  const a = await pedir(env, "?q=%25%25%25");
  assert.equal(a.status, 200);
  assert.equal((await pedir(env, "?competicion=x'%20OR%201=1")).data.partidos.length, 2); // se ignora el valor no válido
});

test("la primera página trae el resumen: partidos y fotos por competición, total general y últimas fotos", async () => {
  const { env } = montar();
  const { data } = await pedir(env);
  const porComp = Object.fromEntries(data.competiciones.map((c) => [c.clave, c]));
  assert.deepEqual([porComp.primera_federacion.partidos, porComp.primera_federacion.fotos], [1, 7]); // solo celta (7): el partido sin slug no cuenta
  assert.deepEqual([porComp.segunda_federacion.partidos, porComp.segunda_federacion.fotos], [1, 1]);
  assert.equal(data.general.total, 9); // todo lo público: 7 + 1 + 1
  assert.ok(data.general.recientes.length >= 1 && data.general.recientes.length <= 5);
  assert.ok(data.general.recientes.every((f) => !/privada|avila2|video/.test(f.url)));
});

test("la segunda página no repite el resumen", async () => {
  const { env } = montar();
  const { data } = await pedir(env, "?pagina=2");
  assert.equal(data.competiciones, undefined);
  assert.equal(data.general, undefined);
  assert.equal(data.partidos.length, 0);
});

test("pagina de 18 en 18 con hayMas", async () => {
  const { env, sqlite } = montar();
  for (let i = 0; i < 20; i++) {
    const r = sqlite.prepare("INSERT INTO results (slug, equipo_local, equipo_visitante, fecha_partido, estado, competicion) VALUES (?,?,?,?,?,?)").run(`p-${i}`, "L" + i, "V" + i, "2026-09-" + String(10 + (i % 15)), "finalizado", "hypermotion");
    const m = sqlite.prepare("INSERT INTO media (cloudinary_url, titulo, tipo, visibilidad) VALUES (?,?,?,?)").run(`https://res.cloudinary.com/x/image/upload/v1/p${i}.jpg`, "t", "foto", "publico");
    sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, orden) VALUES (?,?,0)").run(Number(r.lastInsertRowid), Number(m.lastInsertRowid));
  }
  const p1 = (await pedir(env)).data;
  assert.equal(p1.partidos.length, 18);
  assert.equal(p1.hayMas, true);
  const p2 = (await pedir(env, "?pagina=2")).data;
  assert.equal(p2.partidos.length, 4); // 22 partidos con galería en total
  assert.equal(p2.hayMas, false);
  assert.equal(new Set([...p1.partidos, ...p2.partidos].map((p) => p.id)).size, 22);
});

test("funciona aunque la BD aún no tenga las columnas visibilidad ni portada_foco", async () => {
  const { env } = montar({ conVisibilidad: false, conFoco: false });
  const { status, data } = await pedir(env);
  assert.equal(status, 200);
  assert.equal(data.partidos.length, 2);
  assert.equal(data.partidos[0].fotos[0].foco, null);
});
