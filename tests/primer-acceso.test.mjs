// Prueba de integración: el "primer acceso" ya no depende de que falte el correo.
// Ejecuta el handler REAL (src/index.js) contra SQLite en memoria que imita D1. Uso:
//   node --test tests/primer-acceso.test.mjs
//   WORKER_ENTRY=../worker-secondary/src/index.js node --test tests/primer-acceso.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";
const PW = "una-clave-larga-1";

// La tabla users se crea SIN primer_acceso_at a propósito: así se prueba también
// la migración automática (crear la columna y rellenarla desde sessions).
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, nombre TEXT, rol TEXT DEFAULT 'redactor', activo INTEGER DEFAULT 1, email TEXT, avatar_url TEXT, avatar_foco TEXT, categorias_fijas TEXT, nivel INTEGER DEFAULT 1,
  totp_secret TEXT, totp_activo INTEGER NOT NULL DEFAULT 0, totp_ultimo_paso INTEGER, totp_recovery TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, user_agent TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT);
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nombre TEXT, usuario_rol TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, descripcion TEXT, detalle TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
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
const env = { DB, JWT_SECRET };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

async function login(username) {
  const req = new Request("https://api.test/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "navegador-" + username },
    body: JSON.stringify({ username, password: PW }),
  });
  const res = await worker.fetch(req, env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function pbkdf2(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256));
  return [...bits].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Siempre con correo (como al crear la cuenta desde el panel o un formulario).
async function crearUsuario(username) {
  const salt = "00112233445566778899aabbccddeeff";
  sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, email) VALUES (?,?,?,?,?,?)")
    .run(username, await pbkdf2(PW, salt), salt, "Nombre " + username, "redactor", username + "@x.es");
  return sqlite.prepare("SELECT id FROM users WHERE username = ?").get(username).id;
}

test("primer acceso: cuenta con correo desde el alta, y migración desde sessions", async () => {
  const nuevo = await crearUsuario("nuevo");
  const antiguo = await crearUsuario("antiguo");
  // "antiguo" ya había iniciado sesión antes de existir la columna.
  sqlite.prepare("INSERT INTO sessions (id, user_id, user_agent, created_at) VALUES ('s-vieja', ?, 'otro', '2026-01-05 10:00:00')").run(antiguo);

  // 1) Primer login de una cuenta que YA tiene correo: cuenta como primer acceso.
  const l1 = await login("nuevo");
  assert.equal(l1.status, 200);
  assert.equal(l1.data.primer_acceso, true, "primer login = primer acceso aunque tenga correo");
  assert.equal(l1.data.user.email, "nuevo@x.es");

  // 2) Segundo login: ya no.
  const l2 = await login("nuevo");
  assert.equal(l2.status, 200);
  assert.equal(l2.data.primer_acceso, false);

  // 3) La fecha queda guardada y no se pisa.
  const fila = sqlite.prepare("SELECT primer_acceso_at FROM users WHERE id = ?").get(nuevo);
  assert.ok(fila.primer_acceso_at, "se guarda primer_acceso_at");
  await login("nuevo");
  assert.equal(sqlite.prepare("SELECT primer_acceso_at FROM users WHERE id = ?").get(nuevo).primer_acceso_at, fila.primer_acceso_at);

  // 4) Quien ya tenía sesiones antes de la migración NO sale como primer acceso.
  const l3 = await login("antiguo");
  assert.equal(l3.data.primer_acceso, false);
  assert.equal(sqlite.prepare("SELECT primer_acceso_at FROM users WHERE id = ?").get(antiguo).primer_acceso_at, "2026-01-05 10:00:00");
});

test("primer acceso: crear la cuenta o fallar la contraseña no lo marca", async () => {
  const id = await crearUsuario("sin-entrar");
  const mala = await worker.fetch(new Request("https://api.test/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "sin-entrar", password: "incorrecta-123" }),
  }), env, ctx);
  assert.equal(mala.status, 401);
  assert.equal(sqlite.prepare("SELECT primer_acceso_at FROM users WHERE id = ?").get(id).primer_acceso_at, null);
  const ok = await login("sin-entrar");
  assert.equal(ok.data.primer_acceso, true);
});
