// Comprueba cargarEstadoInactividadUsuarios (lo que ven los admins en Usuarios).
// Uso: node tests/inactividad-usuarios.test.mjs [ruta/al/index.js]
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

const codigo = [
  entre("const INACTIVIDAD_DIAS_HASTA_PRIMER_AVISO", "function diaYHoraEnMadrid("),
  entre("function diaYHoraEnMadrid(", "// Días naturales"),
  entre("const EXCEPCION_DURACIONES_DIAS", "function construirEmailExcepcionActividad("), // excepcionalidades de actividad
  entre("// Historial de avisos de inactividad: una entrada", "\n\n/*\n * ====="),
  "this.cargar = cargarEstadoInactividadUsuarios; this.registrar = registrarHistorialAviso; this.parsear = parsearHistorialAvisos;",
].join("\n");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE articles (id INTEGER PRIMARY KEY, autor_id INTEGER, coautor_id INTEGER, fecha_publicacion TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT, created_at TEXT, rol TEXT, activo INTEGER);
  CREATE TABLE media (id INTEGER PRIMARY KEY, autor_id INTEGER);
  CREATE TABLE match_gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER, media_id INTEGER, vinculado_por_id INTEGER, created_at TEXT);
  CREATE TABLE excepciones_actividad (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, dias INTEGER NOT NULL,
    desde TEXT NOT NULL, hasta TEXT NOT NULL, cancelada_at TEXT);
  CREATE TABLE recordatorios_inactividad (user_id INTEGER PRIMARY KEY, ref_actividad TEXT NOT NULL,
    avisos_enviados INTEGER NOT NULL DEFAULT 0, ultimo_aviso_at TEXT, admins_avisados_at TEXT, updated_at TEXT, historial_avisos TEXT);
`);
const env = { DB: { prepare: (sql) => {
  const q = (args) => ({
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql.replace("datetime('now')", "datetime('now')")).run(...args),
  });
  return { ...q([]), bind: (...args) => q(args) };
} } };
const ctx = vm.createContext({ console, Date, Math, Number, Map, Promise, Intl });
vm.runInContext(codigo, ctx);

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const usuarios = [
  { id: 1, rol: "redactor", created_at: hace(100) },  // 3 avisos, sin subir nada
  { id: 2, rol: "redactor", created_at: hace(100) },  // tenía 3 avisos pero subió una noticia después -> reinicio
  { id: 3, rol: "redactor", created_at: hace(3) },    // recién llegado, sin fila
  { id: 4, rol: "admin", created_at: hace(100) },     // no aplica
  { id: 5, rol: "redactor", created_at: hace(100) },  // 5 avisos + admins avisados
  { id: 6, rol: "redactor", created_at: hace(100) },  // 3 avisos, pero firma como segundo autor una noticia reciente -> reinicio
  { id: 7, rol: "redactor", created_at: hace(100) },  // excepcionalidad EN VIGOR hoy
  { id: 8, rol: "redactor", created_at: hace(100) },  // excepcionalidad de 7 días ya terminada -> esos días no cuentan
  { id: 9, rol: "redactor", created_at: hace(100) },  // excepcionalidad CANCELADA -> como si no existiera
  { id: 10, rol: "fotografo", created_at: hace(100) }, // fotógrafo: colgó una galería hace 3 días (foto suya)
  { id: 11, rol: "fotografo", created_at: hace(100) }, // fotógrafo: nunca ha colgado una galería
  { id: 12, rol: "fotografo", created_at: hace(100) }, // fotógrafo: vinculó hace 5 días una foto de otra persona a un partido
  { id: 13, rol: "fotografo", created_at: hace(100) }, // fotógrafo con excepcionalidad en vigor
];
db.prepare("INSERT INTO media VALUES (?,?)").run(1, 10);
db.prepare("INSERT INTO media VALUES (?,?)").run(2, 99);
db.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id, created_at) VALUES (?,?,?,?)").run(1, 1, 10, hace(3).slice(0, 19).replace("T", " "));
db.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id, created_at) VALUES (?,?,?,?)").run(2, 2, 12, hace(5).slice(0, 19).replace("T", " "));
const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const exc = db.prepare("INSERT INTO excepciones_actividad (user_id, dias, desde, hasta, cancelada_at) VALUES (?,?,?,?,?)");
exc.run(7, 7, dia(-2), dia(4), null);
exc.run(8, 7, dia(-17), dia(-11), null);
exc.run(9, 7, dia(-2), dia(4), "2026-01-01 00:00:00");
exc.run(13, 7, dia(-2), dia(4), null);
db.prepare("INSERT INTO recordatorios_inactividad (user_id, ref_actividad, avisos_enviados, ultimo_aviso_at, admins_avisados_at, updated_at) VALUES (?,?,?,?,?,?)").run(1, hace(40), 3, hace(6), null, hace(6));
db.prepare("INSERT INTO recordatorios_inactividad (user_id, ref_actividad, avisos_enviados, ultimo_aviso_at, admins_avisados_at, updated_at) VALUES (?,?,?,?,?,?)").run(2, hace(40), 3, hace(6), null, hace(6));
db.prepare("INSERT INTO articles VALUES (?,?,?,?)").run(1, 2, null, hace(2)); // noticia posterior a la ref guardada
db.prepare("INSERT INTO recordatorios_inactividad (user_id, ref_actividad, avisos_enviados, ultimo_aviso_at, admins_avisados_at, updated_at) VALUES (?,?,?,?,?,?)").run(5, hace(60), 5, hace(10), hace(5), hace(5));

db.prepare("INSERT INTO recordatorios_inactividad (user_id, ref_actividad, avisos_enviados, ultimo_aviso_at, admins_avisados_at, updated_at) VALUES (?,?,?,?,?,?)").run(6, hace(40), 3, hace(6), null, hace(6));
db.prepare("INSERT INTO articles VALUES (?,?,?,?)").run(2, 2, 6, hace(1)); // coautor_id = 6

// Ojo: ref guardada de 1 y 5 debe coincidir con la ref real (created_at) para que el ciclo siga vigente
for (const id of [1, 5]) {
  db.prepare("UPDATE recordatorios_inactividad SET ref_actividad = ? WHERE user_id = ?").run(usuarios.find((u) => u.id === id).created_at, id);
}

const mapa = await ctx.cargar(env, usuarios);
assert.equal(mapa.has(4), false, "los admins no entran");
assert.equal(mapa.get(1).avisos_enviados, 3);
assert.ok(mapa.get(1).ultimo_aviso_at);
assert.equal(mapa.get(2).avisos_enviados, 0, "si sube una noticia, el ciclo se reinicia");
assert.equal(mapa.get(2).ultimo_aviso_at, null);
assert.equal(mapa.get(3).avisos_enviados, 0);
assert.equal(mapa.get(3).dias_sin_subir, 3);
assert.equal(mapa.get(3).referencia_at, usuarios[2].created_at, "sin noticias, la referencia es el alta de la cuenta");
assert.ok(Date.parse(mapa.get(2).referencia_at) > Date.parse(usuarios[1].created_at), "con noticia, la referencia es la noticia");
assert.equal(mapa.get(6).avisos_enviados, 0, "ser segundo autor cuenta como actividad propia: el ciclo se reinicia");
assert.equal(mapa.get(6).dias_sin_subir, 1);
assert.equal(mapa.get(5).avisos_enviados, 5);
assert.ok(mapa.get(5).admins_avisados_at);

// ---- Excepcionalidades de actividad ----
assert.equal(mapa.get(1).excepcion_en_vigor, false, "sin excepcionalidad: no está en vigor");
assert.equal(mapa.get(7).excepcion_en_vigor, true, "en vigor: el panel no debe anunciar avisos");
assert.equal(mapa.get(8).excepcion_en_vigor, false, "ya terminada: no está en vigor");
assert.equal(mapa.get(8).dias_sin_subir, 93, "los 7 días de una excepcionalidad terminada no cuentan como inactividad");
assert.equal(mapa.get(9).excepcion_en_vigor, false, "cancelada: no cuenta");
assert.equal(mapa.get(9).dias_sin_subir, 100, "cancelada: los días cuentan con normalidad");

// ---- Fotógrafos: la referencia es su última galería de partido ----
assert.equal(mapa.get(10).dias_sin_subir, 3, "foto suya vinculada a un partido: cuenta como galería");
assert.equal(mapa.get(10).referencia_tipo, "galeria");
assert.equal(mapa.get(11).dias_sin_subir, 100, "sin ninguna galería: se cuenta desde el alta de la cuenta");
assert.equal(mapa.get(12).dias_sin_subir, 5, "vincular fotos a un partido también cuenta");
assert.equal(mapa.get(1).referencia_tipo, "noticia");
assert.equal(mapa.get(13).excepcion_en_vigor, true, "los fotógrafos también pueden tener excepcionalidad");

// La consulta de la pasada diaria es válida y elige la referencia según el rol
{
  const sqlPasada = entre("`SELECT u.id, u.nombre, u.email, u.created_at, u.rol,", "`\n    ).all()").slice(1);
  for (const u of usuarios) db.prepare("INSERT INTO users VALUES (?,?,?,?,?,1)").run(u.id, "N" + u.id, `u${u.id}@x.es`, u.created_at, u.rol);
  const filas = db.prepare(sqlPasada).all();
  assert.ok(!filas.some((f) => f.rol === "admin"), "los admins no entran en la pasada");
  const f10 = filas.find((f) => f.id === 10), f11 = filas.find((f) => f.id === 11), f1 = filas.find((f) => f.id === 1);
  assert.ok(f10.ultima_galeria, "el fotógrafo con galería trae su fecha");
  assert.equal(f11.ultima_galeria, null);
  assert.equal(f1.ultima_galeria, null, "a los redactores no se les calcula galería");
}

// ---- Historial de cada aviso ----
const hist1 = [{ numero: 1, enviado_at: hace(16), dias_sin_subir: 84 }, { numero: 2, enviado_at: hace(11), dias_sin_subir: 89 }];
db.prepare("UPDATE recordatorios_inactividad SET historial_avisos = ? WHERE user_id = 1").run(JSON.stringify(hist1));
const conHist = await ctx.cargar(env, usuarios);
assert.equal(conHist.get(1).avisos.length, 2);
assert.equal(conHist.get(1).avisos[1].numero, 2);
assert.equal(JSON.stringify(conHist.get(2).avisos), "[]", "ciclo reiniciado: sin historial");
assert.equal(JSON.stringify(conHist.get(5).avisos), "[]", "sin historial guardado (avisos anteriores a la migración)");

// registrar: añade al ciclo en curso y lo sustituye si el ciclo es nuevo
await ctx.registrar(env, { userId: 1, cicloPrevio: true, numeroAviso: 3, enviadoAtIso: hace(0), diasSinSubir: 100 });
let g = ctx.parsear(db.prepare("SELECT historial_avisos h FROM recordatorios_inactividad WHERE user_id = 1").get().h);
assert.equal(JSON.stringify(g.map((h) => h.numero)), "[1,2,3]");
await ctx.registrar(env, { userId: 1, cicloPrevio: false, numeroAviso: 1, enviadoAtIso: hace(0), diasSinSubir: 31 });
g = ctx.parsear(db.prepare("SELECT historial_avisos h FROM recordatorios_inactividad WHERE user_id = 1").get().h);
assert.equal(JSON.stringify(g.map((h) => h.numero)), "[1]", "ciclo nuevo: el historial empieza de cero");
assert.equal(JSON.stringify(ctx.parsear("basura{")), "[]", "JSON roto no rompe nada");

// Sin la columna (migración sin aplicar): ni el listado ni el envío fallan
db.exec("ALTER TABLE recordatorios_inactividad DROP COLUMN historial_avisos");
const sinCol = await ctx.cargar(env, usuarios);
assert.equal(sinCol.get(1).avisos_enviados, 3, "el estado sigue saliendo");
assert.equal(JSON.stringify(sinCol.get(1).avisos), "[]");
await ctx.registrar(env, { userId: 1, cicloPrevio: true, numeroAviso: 4, enviadoAtIso: hace(0), diasSinSubir: 1 }); // no debe lanzar

// Sin la tabla de excepcionalidades (migración sin aplicar) el listado sigue funcionando
db.exec("DROP TABLE excepciones_actividad");
const sinExc = await ctx.cargar(env, usuarios);
assert.equal(sinExc.get(1).avisos_enviados, 3, "sin tabla de excepcionalidades el estado sigue saliendo");
assert.equal(sinExc.get(7).excepcion_en_vigor, false);

// Sin match_gallery el estado de redactores sigue funcionando y los fotógrafos se cuentan desde el alta
db.exec("DROP TABLE match_gallery");
const sinGal = await ctx.cargar(env, usuarios);
assert.equal(sinGal.get(1).avisos_enviados, 3);
assert.equal(sinGal.get(10).dias_sin_subir, 100);

// Sin la tabla (migración sin aplicar) no debe romper el listado
db.exec("DROP TABLE recordatorios_inactividad");
const vacio = await ctx.cargar(env, usuarios);
assert.equal(vacio.size, 0);

console.log("inactividad-usuarios: OK");
