import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Uso: node tests/fusion-previas.test.mjs [ruta/al/index.js]
// (se puede lanzar contra worker/src/index.js y worker-secondary/src/index.js)
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
  // normalizarFoco (sistema de foco de imágenes) vive más arriba en el Worker y la
  // usa normalizarImagenes; sin ella parseImagenesFusion falla y devuelve [] en silencio.
  entre("const FOCO_CENTRO", "// true si el error es por una columna que aún no existe"),
  entre("const POSICIONES_IMAGEN_VALIDAS", "// ---------- Fusión de las previas"),
  entre("// ---------- Fusión de las previas", "// ---------- Alineaciones ----------"),
].join("\n");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE articles (id INTEGER PRIMARY KEY, slug TEXT, titulo TEXT, tipo TEXT, categoria TEXT, resultado_id INTEGER, publicado INTEGER DEFAULT 1);
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
      };
      return o;
    },
  },
};

const ctx = { console, JSON, Math, Number, String, Array, Set, Map, Object, RegExp, IDIOMAS_TRADUCCION: ["eu", "ca", "gl", "en"] };
vm.createContext(ctx);
vm.runInContext(
  codigo + "\nthis.__api = { SQL_OCULTAR_SEGUNDO_DE_FUSION, contarBloquesHtmlFusion, clavesDistintivasFusion, puntuarLadosFusion, ordenarSeccionesFusion, buscarGrupoFusionPartido, idsGrupoFusion, remapearSlugsFusion, fusionarGrupoDePartido };",
  ctx
);
const api = ctx.__api;

// ladoPorTextoFusion se sustituyó en el Worker por puntuarLadosFusion (puntuación
// l/v) + ordenarSeccionesFusion (que compara textos entre sí). Este ayudante
// reproduce la decisión sencilla "a qué lado se inclina un texto" con el umbral
// 0.3 que usa ordenarSeccionesFusion para dos previas.
api.ladoPorTextoFusion = (art, claves) => {
  const { l, v } = api.puntuarLadosFusion(art, claves);
  const total = l + v;
  if (!total) return null;
  const reparto = (l - v) / total;
  return Math.abs(reparto) >= 0.3 ? (reparto > 0 ? "local" : "visitante") : null;
};

const nombres = { local: "Gimnàstic de Tarragona", visitante: "CE Sabadell" };
let pruebas = 0;
const ok = (nombre, fn) => { fn(); pruebas++; console.log("  ✓", nombre); };
const okAsync = async (nombre, fn) => { await fn(); pruebas++; console.log("  ✓", nombre); };

function art(id, extra = {}) {
  return {
    id, slug: `previa-${id}`, titulo: `Previa ${id}`, subtitulo: null, contenido: "<p>Texto.</p>", imagen_url: null, imagenes: null,
    autor_id: id, autor_nombre: `Autor ${id}`, coautor_id: null, coautor_nombre: null, ficha_tecnica: null, ...extra,
  };
}

console.log("Bloques y claves");
ok("cuenta bloques de primer nivel", () => {
  assert.equal(api.contarBloquesHtmlFusion("<p>a</p><p>b <b>x</b></p><ul><li>1</li></ul><img src=x>"), 4);
  assert.equal(api.contarBloquesHtmlFusion(""), 0);
});
ok("claves distintivas quitan lo compartido y lo genérico", () => {
  const c = api.clavesDistintivasFusion("Real Madrid Castilla", "Atlético Madrid B");
  assert.ok(!c.local.includes("madr*") && !c.visitante.includes("madr*"));
  assert.ok(c.local.includes("castil*"));
});

console.log("Detección de lado");
const claves = api.clavesDistintivasFusion(nombres.local, nombres.visitante);
ok("texto sobre el local", () => {
  const a = art(1, { titulo: "El Gimnàstic busca la victoria", contenido: "<p>El Gimnàstic llega en racha. Tarragona espera a su equipo.</p>" });
  assert.equal(api.ladoPorTextoFusion(a, claves), "local");
});
ok("texto sobre el visitante (apodo por raíz)", () => {
  const a = art(2, { titulo: "Sabadell, a por todas", contenido: "<p>Los sabadellenses visitan el Nou Estadi. El Sabadell quiere puntuar.</p>" });
  assert.equal(api.ladoPorTextoFusion(a, claves), "visitante");
});
ok("sin señal -> null", () => {
  assert.equal(api.ladoPorTextoFusion(art(3, { contenido: "<p>Partido importante este domingo.</p>" }), claves), null);
});

console.log("Orden y títulos de sección");
ok("la primera creada habla del visitante: se reordena", () => {
  const a = art(1, { titulo: "Sabadell, a por todas", contenido: "<p>El Sabadell visita Tarragona con ganas. Sabadell llega bien.</p>" });
  const b = art(2, { titulo: "El Gimnàstic busca la victoria", contenido: "<p>El Gimnàstic llega en racha.</p>" });
  const s = api.ordenarSeccionesFusion([a, b], nombres);
  assert.deepEqual(s.map((x) => x.art.id), [2, 1]);
  assert.deepEqual(s.map((x) => x.lado), ["local", "visitante"]);
});
ok("con una sola señal, la otra es la contraria", () => {
  const a = art(1, { contenido: "<p>Partido importante.</p>" });
  const b = art(2, { titulo: "El Gimnàstic busca la victoria", contenido: "<p>El Gimnàstic llega en racha.</p>" });
  const s = api.ordenarSeccionesFusion([a, b], nombres);
  assert.deepEqual(s.map((x) => [x.art.id, x.lado]), [[2, "local"], [1, "visitante"]]);
});
ok("dos textos del mismo equipo: no se fía, orden de creación", () => {
  const a = art(1, { titulo: "El Gimnàstic llega bien", contenido: "<p>El Gimnàstic.</p>" });
  const b = art(2, { titulo: "Gimnàstic, a por todas", contenido: "<p>El Gimnàstic.</p>" });
  const s = api.ordenarSeccionesFusion([a, b], nombres);
  assert.deepEqual(s.map((x) => [x.art.id, x.lado]), [[1, null], [2, null]]);
});

// El Worker marca cada <h2> de sección con class="fusion-seccion fusion-sN" (para el color por equipo
// en noticia.html); aquí se comparan solo las etiquetas y el texto.
const lim = (html) => String(html).replace(/ class="fusion-seccion fusion-s\d+"/g, "");

console.log("Fusión");
ok("sin pistas: <h2> con el partido y el autor, en orden de creación", () => {
  const base = art(1, { contenido: "<p>Uno.</p>" });
  api.fusionarGrupoDePartido(base, [art(2, { contenido: "<p>Dos.</p>" })], nombres);
  assert.equal(lim(base.contenido), "<h2>Gimnàstic de Tarragona - CE Sabadell · Autor 1</h2><p>Uno.</p><h2>Gimnàstic de Tarragona - CE Sabadell · Autor 2</h2><p>Dos.</p>");
  assert.equal(base.coautor_nombre, "Autor 2");
  assert.equal(base.firmantes.length, 2);
  assert.equal(base.fusion.total, 2);
});
ok("con lado claro: <h2> con el equipo (sin autor), aunque la base hable del visitante", () => {
  const base = art(1, { titulo: "Sabadell, a por todas", contenido: "<p>El Sabadell visita Tarragona. Sabadell llega bien.</p>" });
  const otro = art(2, { titulo: "El Gimnàstic busca la victoria", contenido: "<p>El Gimnàstic llega en racha.</p>" });
  api.fusionarGrupoDePartido(base, [otro], nombres);
  assert.ok(lim(base.contenido).startsWith("<h2>Gimnàstic de Tarragona</h2><p>El Gimnàstic llega"));
  assert.ok(lim(base.contenido).includes("<h2>CE Sabadell</h2><p>El Sabadell visita"));
  assert.equal(base.slug, "previa-1", "la URL sigue siendo la de la primera creada");
});
ok("tres previas: todas fusionadas, tres firmantes", () => {
  const base = art(1, { contenido: "<p>Uno.</p>" });
  api.fusionarGrupoDePartido(base, [art(2, { contenido: "<p>Dos.</p>" }), art(3, { contenido: "<p>Tres.</p>" })], nombres);
  assert.equal((lim(base.contenido).match(/<h2>/g) || []).length, 3);
  assert.deepEqual(Array.from(base.firmantes, (f) => f.nombre), ["Autor 1", "Autor 2", "Autor 3"]);
  assert.equal(base.fusion.total, 3);
});
ok("fotos: se recolocan por sección y los collages no se mezclan", () => {
  const base = art(1, {
    contenido: "<p>a</p><p>b</p>",
    imagenes: JSON.stringify([{ url: "https://x/1.jpg", posicion: "personalizada", trasParrafo: 1, foco: "50% 50%" }]),
  });
  const otro = art(2, {
    contenido: "<p>c</p>",
    imagenes: JSON.stringify([
      { url: "https://x/2.jpg", posicion: "inicio", foco: "50% 50%" },
      { url: "https://x/3.jpg", posicion: "collage", trasParrafo: 1, grupo: "g1", foco: "50% 50%" },
    ]),
  });
  api.fusionarGrupoDePartido(base, [otro], nombres);
  const imgs = JSON.parse(base.imagenes);
  const por = (u) => imgs.find((i) => i.url.endsWith(u));
  // base: h2 + 2 bloques (3 bloques) ; la segunda sección empieza tras 3 bloques
  assert.equal(por("1.jpg").trasParrafo, 2);
  assert.equal(por("2.jpg").posicion, "personalizada");
  assert.equal(por("2.jpg").trasParrafo, 4);
  assert.equal(por("3.jpg").trasParrafo, 5);
  assert.equal(por("3.jpg").grupo, "fusion1-g1");
});
ok("traducción solo si TODAS están traducidas", () => {
  const base = art(1, { contenido_en: "<p>One.</p>", contenido_ca: "<p>U.</p>" });
  const otro = art(2, { contenido_en: "<p>Two.</p>", contenido_ca: null });
  api.fusionarGrupoDePartido(base, [otro], nombres);
  assert.ok(base.contenido_en.includes("<p>One.</p>") && base.contenido_en.includes("<p>Two.</p>"));
  assert.equal(base.contenido_ca, null);
  assert.ok(!base.contenido_en.includes("La visión de"), "las traducciones usan el mismo <h2> del equipo/partido, nunca \"La visión de…\"");
});

console.log("Consultas (SQLite real)");
const ins = db.prepare("INSERT INTO articles (id, slug, titulo, tipo, resultado_id, publicado) VALUES (?,?,?,?,?,?)");
// partido 10: tres previas + una crónica ; partido 11: una previa
[[1, "p1", "P1", "previa", 10, 1], [2, "p2", "P2", "previa", 10, 1], [3, "p3", "P3", "previa", 10, 1],
 [4, "c1", "C1", "cronica", 10, 1], [5, "p5", "P5", "previa", 11, 1], [6, "n1", "N1", "noticia", 10, 1]].forEach((r) => ins.run(...r));
const visibles = () => db.prepare(`SELECT id FROM articles WHERE publicado = 1${api.SQL_OCULTAR_SEGUNDO_DE_FUSION} ORDER BY id`).all().map((r) => r.id);

await okAsync("solo la primera de cada partido y tipo queda visible", async () => {
  assert.deepEqual(visibles(), [1, 4, 5, 6]);
});
await okAsync("si la primera se despublica, la siguiente pasa a ser la visible", async () => {
  db.prepare("UPDATE articles SET publicado = 0 WHERE id = 1").run();
  assert.deepEqual(visibles(), [2, 4, 5, 6]);
  db.prepare("UPDATE articles SET publicado = 1 WHERE id = 1").run();
});
await okAsync("buscarGrupoFusionPartido: rol primero / otro / sin grupo", async () => {
  const g1 = await api.buscarGrupoFusionPartido(env, { id: 1, tipo: "previa", resultado_id: 10 });
  assert.equal(g1.rol, "primero");
  assert.deepEqual(Array.from(g1.grupo, (r) => r.id), [1, 2, 3]);
  assert.equal((await api.buscarGrupoFusionPartido(env, { id: 3, tipo: "previa", resultado_id: 10 })).rol, "otro");
  assert.equal(await api.buscarGrupoFusionPartido(env, { id: 5, tipo: "previa", resultado_id: 11 }), null);
  assert.equal(await api.buscarGrupoFusionPartido(env, { id: 6, tipo: "noticia", resultado_id: 10 }), null);
});
await okAsync("idsGrupoFusion: comentarios de todas juntas", async () => {
  assert.deepEqual(Array.from(await api.idsGrupoFusion(env, 2)), [1, 2, 3]);
  assert.deepEqual(Array.from(await api.idsGrupoFusion(env, 5)), [5]);
});
await okAsync("página de autor: enlaza a la fusionada y no duplica", async () => {
  const lista = [
    { id: 3, slug: "p3", tipo: "previa", resultado_id: 10, titulo: "P3" },
    { id: 4, slug: "c1", tipo: "cronica", resultado_id: 10, titulo: "C1" },
    { id: 5, slug: "p5", tipo: "previa", resultado_id: 11, titulo: "P5" },
    { id: 6, slug: "n1", tipo: "noticia", resultado_id: 10, titulo: "N1" },
  ];
  const r = await api.remapearSlugsFusion(env, lista);
  assert.deepEqual(Array.from(r, (a) => a.slug), ["p1", "c1", "p5", "n1"]);
  assert.equal(r[0].fusionada, true);
  assert.equal(r[1].fusionada, undefined);
});

console.log(`\n${pruebas} pruebas OK  (${ruta})`);
