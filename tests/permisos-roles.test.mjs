// Matriz de permisos por rol (admin / redactor / fotógrafo) y vigencia de las sesiones.
// Ejecuta el handler REAL (src/index.js) contra una base SQLite en memoria que imita D1.
//   node --no-warnings --test tests/permisos-roles.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/permisos-roles.test.mjs
//
// Qué protege (cada punto, una regresión que ya ocurrió):
//   1. El rol y "activo" salen de la BASE, no del JWT: degradar o desactivar a alguien
//      surte efecto ya, y cambiar rol / desactivar / restablecer contraseña cierra sus sesiones.
//   2. Borrar un partido: solo autor, admin o permiso temporal (editar/relevo sigue abierto).
//   3. Encuestas del panel: un fotógrafo no las lista ni las crea.
//   4. Clubes personalizados: un fotógrafo no los crea y nadie pisa el escudo de otro.
//   5. Fichas de club: un fotógrafo no las edita ni las propone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

// ---- D1 falso sobre node:sqlite (solo las tablas que tocan estas rutas) ----
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT,
  rol TEXT NOT NULL DEFAULT 'redactor', activo INTEGER NOT NULL DEFAULT 1, nivel INTEGER NOT NULL DEFAULT 1, email TEXT,
  equipo TEXT, categorias_fijas TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, user_agent TEXT, ip TEXT,
  created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT,
  entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, autor_id INTEGER, equipo_local TEXT, equipo_visitante TEXT,
  mvp_jugador TEXT, mvp_equipo TEXT);
CREATE TABLE edit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo_entidad TEXT, entidad_id INTEGER, solicitante_id INTEGER,
  autor_id INTEGER, estado TEXT, permiso_expira_at TEXT, resuelta_at TEXT);
CREATE TABLE custom_clubs (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, categoria TEXT NOT NULL, escudo_url TEXT,
  autor_id INTEGER, autor_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (nombre, categoria));
CREATE TABLE club_info (club TEXT PRIMARY KEY, entrenador TEXT, estadio TEXT, fundacion INTEGER, ciudad TEXT, autor_id INTEGER, autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE club_info_solicitudes (id INTEGER PRIMARY KEY AUTOINCREMENT, club TEXT NOT NULL, entrenador TEXT, estadio TEXT, fundacion INTEGER, ciudad TEXT,
  solicitante_id INTEGER NOT NULL, solicitante_nombre TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', resuelta_por_id INTEGER, resuelta_por_nombre TEXT,
  resuelta_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

// Encuestas: la migración real, tal cual (más un "articles" mínimo para el JOIN del listado).
sqlite.exec("CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT, slug TEXT, publicado INTEGER DEFAULT 1);");
sqlite.exec(fs.readFileSync(new URL("../migracion_encuestas.sql", import.meta.url), "utf8"));

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

const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { pendientes: [], waitUntil(p) { this.pendientes.push(Promise.resolve(p).catch(() => {})); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const ahora = Math.floor(Date.now() / 1000);
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ iat: ahora, exp: ahora + 600, ...payload })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}

function usuario(username, rol, nivel = 1, activo = 1) {
  const r = sqlite.prepare("INSERT INTO users (username, nombre, rol, nivel, activo, email) VALUES (?,?,?,?,?,?)")
    .run(username, "Nombre " + username, rol, nivel, activo, `${username}@x.es`);
  return Number(r.lastInsertRowid);
}

// Cada sesión lleva su propio "sid": la validación de sesión se cachea 20 s por isolate,
// así que un sid nuevo = lectura limpia de la base (como un isolate nuevo en producción).
let contadorSesion = 0;
async function sesion(uid, rolEnToken, { sid } = {}) {
  const id = sid || `sid-test-${++contadorSesion}`;
  sqlite.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(id, uid);
  return { sid: id, token: await jwt({ uid, rol: rolEnToken, nombre: "Nombre", tfa: true, sid: id }) };
}
const revocada = (sid) => sqlite.prepare("SELECT revoked_at FROM sessions WHERE id = ?").get(sid).revoked_at !== null;

async function api(ruta, { method = "GET", body, token } = {}) {
  const req = new Request("https://api.test" + ruta, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(ctx.pendientes.splice(0));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const nuevoPartido = (autorId) => Number(sqlite.prepare("INSERT INTO results (autor_id, equipo_local, equipo_visitante) VALUES (?, 'A', 'B')").run(autorId).lastInsertRowid);
const existePartido = (id) => !!sqlite.prepare("SELECT id FROM results WHERE id = ?").get(id);

const U = {};
test("preparación: admin, dos redactores y un fotógrafo con su sesión", async () => {
  U.admin = usuario("admin", "admin", 4);
  U.red = usuario("redactor", "redactor", 1);
  U.red2 = usuario("redactor2", "redactor", 1);
  U.foto = usuario("foto", "fotografo", 1);
  U.sAdmin = await sesion(U.admin, "admin");
  U.sRed = await sesion(U.red, "redactor");
  U.sRed2 = await sesion(U.red2, "redactor");
  U.sFoto = await sesion(U.foto, "fotografo");
});

// ---------------------------------------------------------------- 1. Vigencia de rol y cuenta
test("1. el rol sale de la base, no del token: un admin degradado deja de poder hacer cosas de admin", async () => {
  const idDegradado = usuario("exadmin", "redactor", 1); // en BD ya es redactor...
  const s = await sesion(idDegradado, "admin");           // ...pero su token (aún válido) dice admin
  const ajeno = nuevoPartido(U.red);
  const r = await api(`/api/results/${ajeno}`, { method: "DELETE", token: s.token });
  assert.equal(r.status, 403, "con el rol de la base (redactor) no puede borrar un partido ajeno");
  assert.ok(existePartido(ajeno));
});

test("1. un token de fotógrafo cuyo rol en la base es ahora redactor ya cuenta como redactor", async () => {
  const id = usuario("promocionado", "redactor", 1);
  const s = await sesion(id, "fotografo");
  const p = nuevoPartido(id);
  const r = await api(`/api/results/${p}/mvp`, { method: "PUT", token: s.token, body: { mvp_jugador: "" } });
  assert.equal(r.status, 200);
});

test("1. una sesión revocada se rechaza al instante, aunque el JWT sea recién emitido", async () => {
  const id = usuario("cierra-sesion", "redactor", 1);
  const s = await sesion(id, "redactor");
  assert.equal((await api("/api/admin/polls", { token: s.token })).status, 200);
  sqlite.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").run(s.sid);
  // Sin vaciar la caché de 20 s por isolate la revocación tarda como mucho ese tiempo;
  // con un sid nuevo ya revocado desde el principio es inmediata:
  const s2 = await sesion(id, "redactor");
  sqlite.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").run(s2.sid);
  assert.equal((await api("/api/admin/polls", { token: s2.token })).status, 401);
});

test("1. una sesión que aún no ha llegado a la réplica (fila ausente) se tolera con JWT reciente", async () => {
  const id = usuario("replica-lenta", "redactor", 1);
  const token = await jwt({ uid: id, rol: "redactor", nombre: "x", tfa: true, sid: "sid-que-no-existe-aun" });
  assert.equal((await api("/api/admin/polls", { token })).status, 200);
});

test("1. una cuenta desactivada (con sesión y token vigentes) recibe 401", async () => {
  const id = usuario("baja", "redactor", 1, 0);
  const s = await sesion(id, "redactor");
  assert.equal((await api("/api/admin/polls", { token: s.token })).status, 401);
});

test("1. un token antiguo sin sid también lee rol y activo de la base", async () => {
  const idBaja = usuario("baja-sin-sid", "redactor", 1, 0);
  const t1 = await jwt({ uid: idBaja, rol: "redactor", nombre: "x", tfa: true });
  assert.equal((await api("/api/admin/polls", { token: t1 })).status, 401);
  const idFoto = usuario("foto-sin-sid", "fotografo", 1);
  const t2 = await jwt({ uid: idFoto, rol: "admin", nombre: "x", tfa: true });
  assert.equal((await api("/api/admin/polls", { token: t2 })).status, 403);
});

test("1. PUT /api/users/:id: cambiar el rol o desactivar cierra las sesiones; editar el nombre no", async () => {
  const objetivo = usuario("objetivo", "redactor", 1);
  const s1 = await sesion(objetivo, "redactor");
  const s2 = await sesion(objetivo, "redactor");

  let r = await api(`/api/users/${objetivo}`, { method: "PUT", token: U.sAdmin.token, body: { nombre: "Otro Nombre" } });
  assert.equal(r.status, 200);
  assert.ok(!revocada(s1.sid) && !revocada(s2.sid), "editar el nombre no cierra sesiones");

  r = await api(`/api/users/${objetivo}`, { method: "PUT", token: U.sAdmin.token, body: { rol: "fotografo" } });
  assert.equal(r.status, 200);
  assert.ok(revocada(s1.sid) && revocada(s2.sid), "cambiar el rol cierra todas sus sesiones");
  assert.equal((await api("/api/admin/polls", { token: s1.token })).status, 401);

  const s3 = await sesion(objetivo, "fotografo");
  r = await api(`/api/users/${objetivo}`, { method: "PUT", token: U.sAdmin.token, body: { activo: false } });
  assert.equal(r.status, 200);
  assert.ok(revocada(s3.sid), "desactivar cierra sus sesiones");
});

test("1. reset-password cierra las sesiones de esa persona", async () => {
  const objetivo = usuario("resetea", "redactor", 1);
  const s = await sesion(objetivo, "redactor");
  const r = await api(`/api/users/${objetivo}/reset-password`, { method: "PUT", token: U.sAdmin.token, body: {} });
  assert.equal(r.status, 200);
  assert.ok(revocada(s.sid));
  assert.equal((await api("/api/admin/polls", { token: s.token })).status, 401);
});

test("1. un admin que se restablece SU contraseña conserva la sesión actual", async () => {
  const a = usuario("admin-propio", "admin", 4);
  const actual = await sesion(a, "admin");
  const otra = await sesion(a, "admin");
  const r = await api(`/api/users/${a}/reset-password`, { method: "PUT", token: actual.token, body: {} });
  assert.equal(r.status, 200);
  assert.ok(!revocada(actual.sid));
  assert.ok(revocada(otra.sid));
});

// ---------------------------------------------------------------- 2. Partidos
test("2. borrar un partido: autor sí, admin sí, otro redactor no, fotógrafo no, sin sesión 401", async () => {
  const propio = nuevoPartido(U.red);
  assert.equal((await api(`/api/results/${propio}`, { method: "DELETE" })).status, 401);
  assert.equal((await api(`/api/results/${propio}`, { method: "DELETE", token: U.sRed2.token })).status, 403);
  assert.equal((await api(`/api/results/${propio}`, { method: "DELETE", token: U.sFoto.token })).status, 403);
  assert.ok(existePartido(propio));
  assert.equal((await api(`/api/results/${propio}`, { method: "DELETE", token: U.sRed.token })).status, 200);
  assert.ok(!existePartido(propio));

  const deOtro = nuevoPartido(U.red);
  assert.equal((await api(`/api/results/${deOtro}`, { method: "DELETE", token: U.sAdmin.token })).status, 200);
});

test("2. un partido sin autor (creado por el sistema) solo lo borra un admin", async () => {
  const sinAutor = nuevoPartido(null);
  assert.equal((await api(`/api/results/${sinAutor}`, { method: "DELETE", token: U.sRed.token })).status, 403);
  assert.equal((await api(`/api/results/${sinAutor}`, { method: "DELETE", token: U.sAdmin.token })).status, 200);
});

test("2. un permiso temporal aprobado y vigente permite borrar; caducado, no", async () => {
  const p = nuevoPartido(U.red);
  sqlite.prepare("INSERT INTO edit_requests (tipo_entidad, entidad_id, solicitante_id, autor_id, estado, permiso_expira_at, resuelta_at) VALUES ('resultado', ?, ?, ?, 'aprobada', datetime('now', '-1 hour'), datetime('now', '-3 hours'))").run(p, U.red2, U.red);
  assert.equal((await api(`/api/results/${p}`, { method: "DELETE", token: U.sRed2.token })).status, 403, "permiso caducado");
  sqlite.prepare("UPDATE edit_requests SET permiso_expira_at = datetime('now', '+1 hour') WHERE entidad_id = ?").run(p);
  assert.equal((await api(`/api/results/${p}`, { method: "DELETE", token: U.sRed2.token })).status, 200, "permiso vigente");
});

test("2. el relevo en directo se mantiene: otro redactor SÍ puede editar el partido (MVP) pero un fotógrafo no", async () => {
  const p = nuevoPartido(U.red);
  const cuerpo = { mvp_jugador: "Jugador", mvp_equipo: "local" };
  assert.equal((await api(`/api/results/${p}/mvp`, { method: "PUT", token: U.sRed2.token, body: cuerpo })).status, 200);
  assert.equal((await api(`/api/results/${p}/mvp`, { method: "PUT", token: U.sFoto.token, body: cuerpo })).status, 403);
});

// ---------------------------------------------------------------- 3. Encuestas
test("3. encuestas del panel: un fotógrafo no las lista ni las crea; admin y redactor sí pueden listar", async () => {
  assert.equal((await api("/api/admin/polls")).status, 401);
  assert.equal((await api("/api/admin/polls", { token: U.sFoto.token })).status, 403);
  const crear = await api("/api/admin/polls", { method: "POST", token: U.sFoto.token, body: { pregunta: "¿Quién gana?", opciones: ["A", "B"], en_portada: true } });
  assert.equal(crear.status, 403);
  assert.equal((await api("/api/admin/polls", { token: U.sRed.token })).status, 200);
  assert.equal((await api("/api/admin/polls", { token: U.sAdmin.token })).status, 200);
});

// ---------------------------------------------------------------- 4. Clubes personalizados
test("4. clubes personalizados: un fotógrafo no puede crearlos", async () => {
  const r = await api("/api/custom-clubs", { method: "POST", token: U.sFoto.token, body: { nombre: "CD Nuevo", categoria: "hypermotion", escudo_url: "https://x/a.png" } });
  assert.equal(r.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM custom_clubs").get().n, 0);
});

test("4. el escudo de un club solo lo cambia su autor o un admin; los demás solo lo rellenan si estaba vacío", async () => {
  const club = { nombre: "CD Escudo", categoria: "hypermotion" };
  const escudo = () => sqlite.prepare("SELECT escudo_url FROM custom_clubs WHERE nombre = ?").get(club.nombre).escudo_url;

  assert.equal((await api("/api/custom-clubs", { method: "POST", token: U.sRed.token, body: { ...club, escudo_url: "https://x/original.png" } })).status, 200);
  assert.equal(escudo(), "https://x/original.png");

  // otro redactor no lo pisa (la petición no falla, pero el escudo se queda)
  assert.equal((await api("/api/custom-clubs", { method: "POST", token: U.sRed2.token, body: { ...club, escudo_url: "https://x/pisado.png" } })).status, 200);
  assert.equal(escudo(), "https://x/original.png");

  // su autor sí puede cambiarlo, y un admin también
  assert.equal((await api("/api/custom-clubs", { method: "POST", token: U.sRed.token, body: { ...club, escudo_url: "https://x/autor.png" } })).status, 200);
  assert.equal(escudo(), "https://x/autor.png");
  assert.equal((await api("/api/custom-clubs", { method: "POST", token: U.sAdmin.token, body: { ...club, escudo_url: "https://x/admin.png" } })).status, 200);
  assert.equal(escudo(), "https://x/admin.png");

  // un club sin escudo sí lo puede completar cualquier redactor
  const sinEscudo = { nombre: "CD Sin Escudo", categoria: "hypermotion" };
  await api("/api/custom-clubs", { method: "POST", token: U.sRed.token, body: sinEscudo });
  await api("/api/custom-clubs", { method: "POST", token: U.sRed2.token, body: { ...sinEscudo, escudo_url: "https://x/relleno.png" } });
  assert.equal(sqlite.prepare("SELECT escudo_url FROM custom_clubs WHERE nombre = ?").get(sinEscudo.nombre).escudo_url, "https://x/relleno.png");
});

// ---------------------------------------------------------------- 5. Fichas de club
test("5. fichas de club: un fotógrafo no puede editarlas ni proponerlas", async () => {
  const r = await api("/api/club-info", { method: "PUT", token: U.sFoto.token, body: { club: "Algún Club", entrenador: "X" } });
  assert.equal(r.status, 403);
  assert.equal((await api("/api/club-info", { method: "PUT", body: { club: "Algún Club" } })).status, 401);
});

// ---------------------------------------------------------------- 5b. Propuestas de ficha duplicadas
const pendientesDe = (club) => sqlite.prepare("SELECT COUNT(*) n FROM club_info_solicitudes WHERE club = ? AND estado = 'pendiente'").get(club).n;
test("5b. propuestas de ficha: no se puede reenviar la misma, ni la de otro redactor, ni la que ya es la ficha publicada", async () => {
  const datos = { club: "Club Duplicado", entrenador: "Ana Pérez", estadio: "Campo Uno", fundacion: 1950, ciudad: "Vigo" };

  const primera = await api("/api/club-info", { method: "PUT", token: U.sRed.token, body: datos });
  assert.equal(primera.status, 200);
  assert.equal(primera.data.pendiente, true);
  assert.equal(pendientesDe(datos.club), 1);

  // La misma propuesta tal cual: rechazada
  const repetida = await api("/api/club-info", { method: "PUT", token: U.sRed.token, body: datos });
  assert.equal(repetida.status, 409);
  assert.equal(repetida.data.duplicada, true);

  // Mayúsculas y espacios de más no la hacen distinta
  const disfrazada = await api("/api/club-info", { method: "PUT", token: U.sRed.token,
    body: { ...datos, entrenador: "  ANA   pérez ", estadio: "campo uno " } });
  assert.equal(disfrazada.status, 409);

  // Otro redactor con los mismos datos: también (ya hay una pendiente igual)
  const otro = await api("/api/club-info", { method: "PUT", token: U.sRed2.token, body: datos });
  assert.equal(otro.status, 409);
  assert.equal(pendientesDe(datos.club), 1, "no se ha creado ninguna propuesta repetida");

  // Con UN dato distinto sí se admite
  const distinta = await api("/api/club-info", { method: "PUT", token: U.sRed.token, body: { ...datos, ciudad: "Pontevedra" } });
  assert.equal(distinta.status, 200);
  assert.equal(pendientesDe(datos.club), 2);

  // Si la ficha publicada ya tiene esos datos, proponerlos no tiene sentido
  assert.equal((await api("/api/club-info", { method: "PUT", token: U.sAdmin.token, body: { ...datos, club: "Club Publicado" } })).status, 200);
  const igualALaFicha = await api("/api/club-info", { method: "PUT", token: U.sRed.token, body: { ...datos, club: "Club Publicado" } });
  assert.equal(igualALaFicha.status, 409);
  assert.equal(pendientesDe("Club Publicado"), 0);
});

test("5b. propuestas de ficha: una propuesta vacía de un club sin ficha se rechaza", async () => {
  const r = await api("/api/club-info", { method: "PUT", token: U.sRed.token, body: { club: "Club Vacío", entrenador: "  " } });
  assert.equal(r.status, 400);
  assert.equal(pendientesDe("Club Vacío"), 0);
});
