// Grupos de trabajo: etiqueta interna para organizar al equipo (no da permisos).
//   GET/PUT /api/grupos-trabajo, PUT /api/grupos-trabajo/asignar y grupo_trabajo en GET /api/users.
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/grupos-trabajo.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/grupos-trabajo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.exec(readFileSync(join(aqui, "../schema.sql"), "utf8"));

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
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const crear = (username, nombre, rol, activo = 1) => Number(sqlite.prepare(
  "INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email, activo) VALUES (?, 'x', 'x', ?, ?, 1, ?, ?)"
).run(username, nombre, rol, username + "@x.es", activo).lastInsertRowid);

const adminId = crear("admin", "Admin", "admin");
const ana = crear("ana", "Ana Pérez", "redactor");
const luis = crear("luis", "Luis Gómez", "fotografo");
const marta = crear("marta", "Marta Ruiz", "redactor");
const baja = crear("baja", "Eva Baja", "redactor", 0);
const hdr = async (uid, rol) => ({ Authorization: `Bearer ${await jwt({ uid, rol, nombre: "x", tfa: true })}`, "Content-Type": "application/json" });
const pedir = async (ruta, metodo, uid, rol, cuerpo) => {
  const res = await worker.fetch(new Request(`https://api.test${ruta}`, {
    method: metodo, headers: await hdr(uid, rol), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const admin = (r, m, c) => pedir(r, m, adminId, "admin", c);

test("sin sesión no se puede consultar", async () => {
  const res = await worker.fetch(new Request("https://api.test/api/grupos-trabajo"), env, ctx);
  assert.equal(res.status, 401);
});

test("al principio no hay grupos", async () => {
  const r = await admin("/api/grupos-trabajo", "GET");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { grupos: [], mio: null });
});

test("solo un admin crea grupos", async () => {
  const r = await pedir("/api/grupos-trabajo", "PUT", ana, "redactor", { grupos: [{ nombre: "Previas" }] });
  assert.equal(r.status, 403);
});

test("validación: nombre obligatorio, sin duplicados y máximo", async () => {
  assert.equal((await admin("/api/grupos-trabajo", "PUT", { grupos: [{ nombre: "  " }] })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo", "PUT", { grupos: [{ nombre: "Redes" }, { nombre: "redes" }] })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo", "PUT", { grupos: Array.from({ length: 31 }, (_, i) => ({ nombre: "G" + i })) })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo", "PUT", {})).status, 400);
});

let previas, redes;
test("crear grupos: genera id y color, recorta y limpia", async () => {
  const r = await admin("/api/grupos-trabajo", "PUT", { grupos: [
    { nombre: "  Previas   y crónicas ", descripcion: "Quienes escriben antes y después", color: "#1D6FD1" },
    { nombre: "Redes", color: "no-es-un-color" },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.data.grupos.length, 2);
  [previas, redes] = r.data.grupos;
  assert.equal(previas.nombre, "Previas y crónicas");
  assert.equal(previas.color, "#1d6fd1");
  assert.match(previas.id, /^g[a-z0-9]{8}$/);
  assert.match(redes.color, /^#[0-9a-f]{6}$/);
  assert.notEqual(previas.id, redes.id);
});

test("asignar: solo admin, el grupo debe existir y la persona también", async () => {
  assert.equal((await pedir("/api/grupos-trabajo/asignar", "PUT", ana, "redactor", { user_id: ana, grupo_id: previas.id })).status, 403);
  assert.equal((await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: ana, grupo_id: "inventado" })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: 9999, grupo_id: previas.id })).status, 404);
  assert.equal((await admin("/api/grupos-trabajo/asignar", "PUT", { grupo_id: previas.id })).status, 400);
});

test("asignar: cada persona tiene un solo grupo; los miembros solo cuentan activos", async () => {
  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_ids: [ana, baja], grupo_id: previas.id });
  assert.equal(r.status, 200);
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: redes.id });
  assert.equal(r.status, 200);
  // Ana cambia de grupo: deja de estar en Previas
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: ana, grupo_id: redes.id });
  const g = Object.fromEntries(r.data.grupos.map((x) => [x.nombre, x.miembros.map((m) => m.nombre).sort()]));
  assert.deepEqual(g["Redes"], ["Ana Pérez", "Marta Ruiz"]);
  assert.deepEqual(g["Previas y crónicas"], []); // Eva está de baja: no aparece
});

test("los administradores también pueden estar en un grupo", async () => {
  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: adminId, grupo_id: previas.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.mio, previas.id);
  assert.deepEqual(r.data.grupos.find((x) => x.id === previas.id).miembros.map((m) => m.nombre), ["Admin"]);
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: adminId, grupo_id: null });
  assert.equal(r.status, 200);
});

test("un fotógrafo no puede estar en ningún grupo de trabajo", async () => {
  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: luis, grupo_id: redes.id });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /solo para redactores y Responsables/);
  // También se rechaza si viene en una asignación masiva, y no se guarda nada de esa tanda
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_ids: [ana, luis], grupo_id: previas.id });
  assert.equal(r.status, 400);
  const users = (await admin("/api/users", "GET")).data.users;
  assert.equal(users.find((u) => u.username === "ana").grupo_trabajo, redes.id);
  assert.equal(users.find((u) => u.username === "luis").grupo_trabajo, null);
  // Quitar el grupo a un fotógrafo sí se permite (no hace nada)
  assert.equal((await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: luis, grupo_id: null })).status, 200);
});

test("cada persona ve su propio grupo en GET (y un fotógrafo no tiene ninguno)", async () => {
  const r = await pedir("/api/grupos-trabajo", "GET", marta, "redactor");
  assert.equal(r.status, 200);
  assert.equal(r.data.mio, redes.id);
  assert.equal((await pedir("/api/grupos-trabajo", "GET", luis, "fotografo")).data.mio, null);
  const sin = await pedir("/api/grupos-trabajo", "GET", adminId, "admin");
  assert.equal(sin.data.mio, null);
});

test("GET /api/users incluye grupo_trabajo", async () => {
  const r = await admin("/api/users", "GET");
  assert.equal(r.status, 200);
  const por = Object.fromEntries(r.data.users.map((u) => [u.username, u.grupo_trabajo]));
  assert.equal(por.ana, redes.id);
  assert.equal(por.marta, redes.id);
  assert.equal(por.luis, null);
  assert.equal(por.baja, previas.id);
  assert.equal(por.admin, null);
});

test("no cambia permisos: el rol y el nivel siguen igual", async () => {
  const u = sqlite.prepare("SELECT rol, nivel FROM users WHERE id = ?").get(ana);
  assert.equal(u.rol, "redactor");
  assert.equal(u.nivel, 1);
});

test("quitar a alguien del grupo", async () => {
  const r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: ana, grupo_id: null });
  assert.equal(r.status, 200);
  const users = (await admin("/api/users", "GET")).data.users;
  assert.equal(users.find((u) => u.username === "ana").grupo_trabajo, null);
});

test("renombrar conserva a los miembros; borrar un grupo suelta a sus miembros", async () => {
  let r = await admin("/api/grupos-trabajo", "PUT", { grupos: [{ id: redes.id, nombre: "Redes y directos" }, { id: previas.id, nombre: "Previas y crónicas" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.grupos.find((g) => g.id === redes.id).miembros.map((m) => m.nombre), ["Marta Ruiz"]);
  r = await admin("/api/grupos-trabajo", "PUT", { grupos: [{ id: previas.id, nombre: "Previas y crónicas" }] });
  assert.equal(r.status, 200);
  const users = (await admin("/api/users", "GET")).data.users;
  assert.equal(users.find((u) => u.username === "marta").grupo_trabajo, null);
});

test("si un redactor pasa a fotógrafo se le suelta de su grupo (y no vuelve solo)", async () => {
  const pepe = crear("pepe", "Pepe Lara", "redactor");
  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: pepe, grupo_id: previas.id });
  assert.equal(r.status, 200);
  r = await admin(`/api/users/${pepe}`, "PUT", { rol: "fotografo" });
  assert.equal(r.status, 200);
  assert.equal((await admin("/api/users", "GET")).data.users.find((u) => u.username === "pepe").grupo_trabajo, null);
  assert.deepEqual((await admin("/api/grupos-trabajo", "GET")).data.grupos.find((g) => g.id === previas.id).miembros, []);
  r = await admin(`/api/users/${pepe}`, "PUT", { rol: "redactor" });
  assert.equal(r.status, 200);
  assert.equal((await admin("/api/users", "GET")).data.users.find((u) => u.username === "pepe").grupo_trabajo, null);
});

test("un valor corrupto en settings no rompe nada", async () => {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('grupos_trabajo', '{no es json') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  assert.deepEqual((await admin("/api/grupos-trabajo", "GET")).data, { grupos: [], mio: null });
  assert.equal((await admin("/api/users", "GET")).status, 200);
});

test("grupo «Redacción nivel 4»: el redactor pasa a nivel 4 automáticamente", async () => {
  const r0 = await admin("/api/grupos-trabajo", "PUT", { grupos: [
    ...(await admin("/api/grupos-trabajo", "GET")).data.grupos,
    { nombre: "Redacción nivel 4" }, { nombre: "Redaccion Nivel 2" }, { nombre: "Redacción nivel 9" },
  ] });
  assert.equal(r0.status, 200);
  const g = Object.fromEntries(r0.data.grupos.map((x) => [x.nombre, x.id]));
  const nivelDe = (id) => sqlite.prepare("SELECT nivel FROM users WHERE id = ?").get(id).nivel;

  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_ids: [ana, adminId], grupo_id: g["Redacción nivel 4"] });
  assert.equal(r.status, 200);
  assert.equal(nivelDe(ana), 4);
  assert.deepEqual(r.data.niveles_cambiados, [{ id: ana, nivel: 4 }]); // el Responsable no se toca
  const h = sqlite.prepare("SELECT nivel_anterior, nivel_nuevo, motivo FROM nivel_historial WHERE usuario_id = ?").all(ana);
  assert.equal(h.length, 1);
  assert.equal(h[0].nivel_nuevo, 4);
  assert.match(h[0].motivo, /Redacción nivel 4/);

  // Repetir no genera otro cambio ni otra fila de historial
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: ana, grupo_id: g["Redacción nivel 4"] });
  assert.deepEqual(r.data.niveles_cambiados, []);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM nivel_historial WHERE usuario_id = ?").get(ana).n, 1);

  // Variantes de escritura (sin tilde / mayúsculas) valen; un nivel fuera de 1-4 no hace nada
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: g["Redaccion Nivel 2"] });
  assert.equal(nivelDe(marta), 2);
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: g["Redacción nivel 9"] });
  assert.equal(nivelDe(marta), 1); // «nivel 9» no es de nivel: al salir de «nivel 2» vuelve al que tenía

  // Un grupo cualquiera sigue siendo solo una etiqueta
  r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: ana, grupo_id: redes.id });
  assert.equal(nivelDe(ana), 4);
});

test("al salir de «Redacción nivel N» vuelve al nivel anterior (salvo cambio manual)", async () => {
  const gs = (await admin("/api/grupos-trabajo", "GET")).data.grupos;
  const n3 = gs.find((x) => x.nombre === "Redacción nivel 4").id;
  const n2 = gs.find((x) => x.nombre === "Redaccion Nivel 2").id;
  const nivelDe = (id) => sqlite.prepare("SELECT nivel FROM users WHERE id = ?").get(id).nivel;
  const pon = (id, n) => sqlite.prepare("UPDATE users SET nivel = ? WHERE id = ?").run(n, id);
  const nuevo = crear("nivelprevio", "Pepe Ríos", "redactor");
  pon(nuevo, 2);
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: n3 });
  assert.equal(nivelDe(nuevo), 4);
  // pasar a otro grupo de nivel conserva el nivel original guardado
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: n2 });
  assert.equal(nivelDe(nuevo), 2);
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: n3 });
  let r = await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: null });
  assert.equal(nivelDe(nuevo), 2);
  assert.deepEqual(r.data.niveles_cambiados, [{ id: nuevo, nivel: 2 }]);
  // si un Responsable le cambió el nivel a mano estando en el grupo, no se pisa
  pon(nuevo, 1);
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: n3 });
  pon(nuevo, 3);
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: nuevo, grupo_id: redes.id });
  assert.equal(nivelDe(nuevo), 3);
});
