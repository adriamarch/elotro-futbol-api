// Nombre y apellidos obligatorios:
//  - PUT /api/me/perfil: redactores y fotógrafos no pueden quedarse con un nombre de una sola palabra.
//  - POST /api/acreditaciones: el formulario exige nombre completo (mínimo dos palabras).
// Ejecuta el handler REAL contra SQLite en memoria. Uso:
//   node --test tests/apellidos-obligatorios.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --test tests/apellidos-obligatorios.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";
const PW = "una-clave-larga-1";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, avatar_foco TEXT, categorias_fijas TEXT, nivel INTEGER DEFAULT 1,
  bio TEXT, experiencia TEXT, equipo TEXT, redes_sociales TEXT,
  totp_secret TEXT, totp_activo INTEGER NOT NULL DEFAULT 0, totp_ultimo_paso INTEGER, totp_recovery TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE acreditaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT, dni TEXT, equipo TEXT, tipo_evento TEXT, tipo_acreditacion TEXT, funciones TEXT, jornada_partido TEXT, confirmado INTEGER DEFAULT 0, estado TEXT DEFAULT 'pendiente', created_at TEXT DEFAULT (datetime('now')));
`);
sqlite.prepare("INSERT INTO settings (key, value) VALUES ('acreditacion_acceso', 'solicitar')").run();

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
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

async function pbkdf2(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256));
  return [...bits].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function crearUsuario(username, nombre, rol) {
  const salt = "00112233445566778899aabbccddeeff";
  sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, email, bio) VALUES (?,?,?,?,?,?,?)")
    .run(username, await pbkdf2(PW, salt), salt, nombre, rol, username + "@x.es", "Mi bio");
}
async function login(username) {
  const res = await worker.fetch(new Request("https://api.test/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "navegador-" + username },
    body: JSON.stringify({ username, password: PW }),
  }), env, ctx);
  const data = await res.json();
  assert.equal(res.status, 200, "login " + username);
  return data.token;
}
async function putPerfil(token, nombre) {
  const res = await worker.fetch(new Request("https://api.test/api/me/perfil", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ nombre, email: "", avatar_url: "", bio: "Mi bio", experiencia: "", redes: {} }),
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const nombreEnBD = (u) => sqlite.prepare("SELECT nombre FROM users WHERE username = ?").get(u).nombre;

test("perfil: redactor y fotógrafo no pueden guardar un nombre de una sola palabra", async () => {
  await crearUsuario("red", "Carlos", "redactor");
  await crearUsuario("fot", "Ana", "fotografo");
  for (const [u, n] of [["red", "Carlos"], ["fot", "Ana"]]) {
    const t = await login(u);
    for (const malo of [n, "  " + n + "   ", "   "]) {
      const r = await putPerfil(t, malo);
      assert.equal(r.status, 400, `${u} con «${malo}»`);
    }
    assert.equal(nombreEnBD(u), n, "no se ha tocado el nombre");
  }
});

test("perfil: con nombre y apellidos se guarda (espacios normalizados), se conserva la bio y el token lleva el nombre", async () => {
  const t = await login("red");
  const r = await putPerfil(t, "Carlos   Ruiz  de la Fuente");
  assert.equal(r.status, 200);
  assert.equal(r.data.user.nombre, "Carlos Ruiz de la Fuente");
  assert.equal(nombreEnBD("red"), "Carlos Ruiz de la Fuente");
  assert.equal(sqlite.prepare("SELECT bio FROM users WHERE username='red'").get().bio, "Mi bio");
  const payload = JSON.parse(Buffer.from(r.data.token.split(".")[1], "base64url").toString());
  assert.equal(payload.nombre, "Carlos Ruiz de la Fuente");
});

test("perfil: la primera letra de nombre y apellidos se pone siempre en mayúscula", async () => {
  const t = await login("red");
  const casos = [
    ["carlos ruiz", "Carlos Ruiz"],
    ["juan garcía-lópez", "Juan García-López"],
    ["maría de los ángeles pérez", "María de los Ángeles Pérez"],
    ["ÁNGEL  núñez", "ÁNGEL Núñez"],
    ["carlos McDonald", "Carlos McDonald"],
    ["jordi i pere", "Jordi i Pere"],
  ];
  for (const [entrada, esperado] of casos) {
    const r = await putPerfil(t, entrada);
    assert.equal(r.status, 200, entrada);
    assert.equal(r.data.user.nombre, esperado, entrada);
    assert.equal(nombreEnBD("red"), esperado, entrada);
  }
});

async function api(token, metodo, ruta, cuerpo) {
  const res = await worker.fetch(new Request("https://api.test" + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(cuerpo),
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test("admin: al crear y editar usuarios el nombre se guarda con mayúscula inicial", async () => {
  await crearUsuario("adm", "Admin Prueba", "admin");
  // Los admins exigen 2FA para obtener sesión; aquí no se prueba eso, así que se firma
  // directamente un token de admin con el segundo factor ya superado (sin "sid", como los JWT antiguos).
  const uid = sqlite.prepare("SELECT id FROM users WHERE username = 'adm'").get().id;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const ahora = Math.floor(Date.now() / 1000);
  const datos = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ uid, username: "adm", nombre: "Admin Prueba", rol: "admin", tfa: true, iat: ahora, exp: ahora + 3600 })}`;
  // El worker codifica la firma como base64url del UTF-8 de la cadena binaria de bytes (no de los bytes crudos).
  const bytesFirma = new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(datos)));
  const firma = Buffer.from(String.fromCharCode(...bytesFirma), "utf8").toString("base64url");
  const t = `${datos}.${firma}`;
  const c = await api(t, "POST", "/api/users", { username: "nuevo.red", nombre: "pedro gómez  sánchez", rol: "redactor" });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(nombreEnBD("nuevo.red"), "Pedro Gómez Sánchez");
  const id = sqlite.prepare("SELECT id FROM users WHERE username = 'nuevo.red'").get().id;
  const e = await api(t, "PUT", "/api/users/" + id, { nombre: "lucía fernández" });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(nombreEnBD("nuevo.red"), "Lucía Fernández");
  // Un nombre en blanco no borra el que ya tenía.
  const v = await api(t, "PUT", "/api/users/" + id, { nombre: "   " });
  assert.equal(v.status, 200);
  assert.equal(nombreEnBD("nuevo.red"), "Lucía Fernández");
});

async function postAcred(nombre) {
  const res = await worker.fetch(new Request("https://api.test/api/acreditaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre, email: "solicitante@x.es", dni: "12345678Z", equipo: "CD Tudelano",
      tipo_evento: "Partido de fútbol", tipo_acreditacion: "Prensa / Pupitre",
      funciones: "Crónica", jornada_partido: "J1 Tudelano - Burgos", confirmo: true, web: "",
    }),
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test("acreditaciones: un nombre de una sola palabra se rechaza con el mensaje de nombre completo", async () => {
  for (const malo of ["Carlos", "  Carlos  ", ""]) {
    const r = await postAcred(malo);
    assert.equal(r.status, 400, `«${malo}»`);
    assert.match(r.data.error, /nombre completo/i);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM acreditaciones").get().n, 0);
});

test("acreditaciones: con nombre y apellidos se guarda (espacios normalizados)", async () => {
  const r = await postAcred("  Carlos   Ruiz ");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sqlite.prepare("SELECT nombre FROM acreditaciones").get().nombre, "Carlos Ruiz");
});
