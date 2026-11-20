// Guardián de Responsables: actividad sospechosa de un admin -> pierde el rol, se le cierran las sesiones
// y se devuelve de la papelera lo que borró. Corre la lógica REAL sobre SQLite en memoria.
// Uso: node --test tests/guardian-admins.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

function extraer(ruta) {
  const f = fs.readFileSync(new URL(ruta, import.meta.url), "utf8");
  const a = f.indexOf("// ===== GUARDIAN-ADMINS:INICIO =====");
  const b = f.indexOf("// ===== GUARDIAN-ADMINS:FIN =====");
  assert.ok(a > 0 && b > a, "bloque del guardián no encontrado en " + ruta);
  return f.slice(a, b);
}

function entorno() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, nombre TEXT, rol TEXT, activo INTEGER DEFAULT 1, email TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, revoked_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT,
      accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE papelera (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, entidad_id INTEGER, titulo TEXT,
      eliminado_por_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
  `);
  const DB = { prepare: (q) => {
    const st = sql.prepare(q.replace(/datetime\('now'\)/g, "datetime('now')"));
    let args = [];
    const o = { bind: (...a) => { args = a; return o; },
      first: async () => st.get(...args) || null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => st.run(...args) };
    return o;
  } };
  const out = { alertas: [], correos: [], restaurados: [], cacheVaciada: 0 };
  const ctx = vm.createContext({
    console, Date, Object, Array, Math, Number, JSON, Set, Map, String, Promise, Boolean,
    registrarActividad: async (env, req, p, { accion, entidad, entidad_id, descripcion, detalle }) => {
      sql.prepare("INSERT INTO activity_log (usuario_id, usuario_nombre, usuario_rol, accion, entidad, entidad_id, descripcion, detalle) VALUES (?,?,?,?,?,?,?,?)")
        .run(p.uid, p.nombre, p.rol, accion, entidad ?? null, entidad_id == null ? null : String(entidad_id), descripcion, detalle ? JSON.stringify(detalle) : null);
    },
    enviarAlerta: async (env, clave, titulo, detalle) => { out.alertas.push({ clave, titulo, detalle }); },
    enviarEmailNotificacion: async (env, c, o) => { out.correos.push({ a: o.destinatario, asunto: c.asunto }); return true; },
    emailLectorEntregable: (e) => /@/.test(String(e || "")),
    invalidarCacheCorta: () => { out.cacheVaciada++; },
    papeleraRestaurar: async (env, fila) => { if (fila.id === out.fallaId) throw new Error("falla"); sql.prepare("DELETE FROM papelera WHERE id = ?").run(fila.id); out.restaurados.push(fila.id); },
  });
  sql.prepare("INSERT INTO settings (key, value) VALUES ('guardian_admins', ?)").run(JSON.stringify({ exentos: [] }));
  const env = { DB };
  vm.runInContext(extraer("../src/index.js") + "\nthis.__g = { guardianEvaluar, guardianLimpiarConfig, guardianPuntos, guardianLeerConfig };", ctx);
  return { sql, env, ctx, out, g: ctx.__g };
}

// Simula que el admin 1 hace N acciones (cada una registra actividad y evalúa el guardián).
async function actuar(e, uid, accion, n, detalle) {
  for (let i = 0; i < n; i++) {
    e.sql.prepare("INSERT INTO activity_log (usuario_id, usuario_nombre, usuario_rol, accion, descripcion, detalle) VALUES (?,?,?,?,?,?)")
      .run(uid, "Admin " + uid, "admin", accion, "x", detalle ? JSON.stringify(detalle) : null);
    await e.g.guardianEvaluar(e.env, { uid, nombre: "Admin " + uid, rol: "admin" }, accion);
  }
}
function base(e) {
  e.sql.exec(`INSERT INTO users (id, nombre, rol, email) VALUES (1,'Admin Uno','admin','uno@x.es'),(2,'Admin Dos','admin','dos@x.es'),(3,'Colab','redactor','c@x.es');
    INSERT INTO sessions (id, user_id) VALUES ('s1',1),('s2',1),('s3',2);`);
}

test("uso normal (pocos borrados) no dispara nada", async () => {
  const e = entorno(); base(e);
  await actuar(e, 1, "eliminar_articulo", 8); // 24 puntos < 40
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
  assert.equal(e.out.alertas.length, 0);
});

test("borrado masivo: pierde el rol, sesiones cerradas, papelera restaurada y avisos", async () => {
  const e = entorno(); base(e);
  for (let i = 1; i <= 5; i++) e.sql.prepare("INSERT INTO papelera (tipo, entidad_id, titulo, eliminado_por_id) VALUES ('articulo',?,?,1)").run(i, "N" + i);
  e.sql.prepare("INSERT INTO papelera (tipo, entidad_id, titulo, eliminado_por_id) VALUES ('articulo',99,'de otro',3)").run();
  await actuar(e, 1, "eliminar_articulo", 14); // 42 puntos
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "redactor");
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=1 AND revoked_at IS NULL").get().n, 0);
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=2 AND revoked_at IS NULL").get().n, 1, "no toca a otros");
  assert.equal(e.out.restaurados.length, 5, "restaura lo suyo");
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM papelera WHERE eliminado_por_id=3").get().n, 1, "no restaura lo de otros");
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM activity_log WHERE accion='guardian_bloqueo'").get().n, 1);
  assert.equal(e.out.alertas.length, 1);
  assert.deepEqual(e.out.correos.map((c) => c.a), ["dos@x.es"]);
  assert.ok(e.out.cacheVaciada >= 1);
});

test("el único Responsable activo NO pierde el rol (solo se avisa, una vez)", async () => {
  const e = entorno();
  e.sql.exec("INSERT INTO users (id, nombre, rol, email) VALUES (1,'Solo','admin','s@x.es'),(3,'Colab','redactor','c@x.es')");
  await actuar(e, 1, "eliminar_articulo", 20);
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM activity_log WHERE accion='guardian_alerta'").get().n, 1);
  assert.equal(e.out.correos.length, 0);
});

test("cambios de rol/desactivaciones en cadena puntúan; editar nombres no", async () => {
  const e = entorno(); base(e);
  await actuar(e, 1, "editar_usuario", 30, { nombre: "x", rol: "redactor", _rol_cambiado: false, _desactivado: false });
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
  await actuar(e, 1, "editar_usuario", 7, { _rol_cambiado: true });
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "redactor");
});

test("cuenta exenta o guardián apagado: no actúa", async () => {
  let e = entorno(); base(e);
  e.sql.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('guardian_admins', ?)").run(JSON.stringify({ exentos: [1] }));
  await actuar(e, 1, "eliminar_articulo", 20);
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
  e = entorno(); base(e);
  e.sql.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('guardian_admins', ?)").run(JSON.stringify({ activo: false }));
  await actuar(e, 1, "eliminar_articulo", 20);
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
});

test("si una restauración falla se cuenta y el resto sigue", async () => {
  const e = entorno(); base(e);
  for (let i = 1; i <= 3; i++) e.sql.prepare("INSERT INTO papelera (tipo, entidad_id, titulo, eliminado_por_id) VALUES ('media',?,?,1)").run(i, "M" + i);
  e.out.fallaId = 2;
  await actuar(e, 1, "eliminar_media", 20);
  assert.equal(e.out.restaurados.length, 2);
  const d = JSON.parse(e.sql.prepare("SELECT detalle FROM activity_log WHERE accion='guardian_bloqueo'").get().detalle);
  assert.equal(d.fallidos, 1);
});

test("la configuración se sanea (umbral y ventana con límites)", () => {
  const e = entorno();
  const c = e.g.guardianLimpiarConfig({ umbral: 1, ventana_min: 9999, exentos: [3, "x", 3, -1, 7] });
  assert.equal(c.umbral, 20);
  assert.equal(c.ventana_min, 60);
  assert.deepEqual([...c.exentos], [3, 7]);
});

test("el mismo bloque está en la API principal y en la secundaria", () => {
  assert.equal(extraer("../src/index.js"), extraer("../../worker-secondary/src/index.js"));
  for (const r of ["../src/index.js", "../../worker-secondary/src/index.js"]) {
    const f = fs.readFileSync(new URL(r, import.meta.url), "utf8");
    assert.match(f, /await guardianEvaluar\(env, payload, accion\)/);
    assert.match(f, /_rol_cambiado: rolFinalUsuario !== user\.rol/);
    assert.match(f, /path === "\/api\/guardian"/);
  }
});

test("por defecto la cuenta #1 (el dueño) está exenta y puede borrar en masa sin consecuencias", async () => {
  const e = entorno(); base(e);
  e.sql.prepare("DELETE FROM settings WHERE key = 'guardian_admins'").run(); // config por defecto
  assert.deepEqual([...e.g.guardianLimpiarConfig(null).exentos], [1]);
  await actuar(e, 1, "eliminar_articulo", 40);
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=1").get().rol, "admin");
  assert.equal(e.out.alertas.length, 0);
  await actuar(e, 2, "eliminar_articulo", 14); // otro Responsable sí queda vigilado
  assert.equal(e.sql.prepare("SELECT rol FROM users WHERE id=2").get().rol, "redactor");
});
