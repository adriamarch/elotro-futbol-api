// Fase 2 · Sub-Responsables de ÁREAS que no son grupos de trabajo (p. ej. "Sub-Responsable de las acreditaciones").
//   GET /api/subresponsables, GET /api/mis-cargos, PUT /api/subresponsables/areas, PUT /api/subresponsables/asignar
//   y el permiso de gestionar SOLO las solicitudes de acreditación (no PIN, acceso, config, importar ni borrar).
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/subresponsables-areas.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/subresponsables-areas.test.mjs
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
const hdr = async (uid, rol) => ({ Authorization: `Bearer ${await jwt({ uid, rol, nombre: "x", tfa: true })}`, "Content-Type": "application/json" });
const pedir = async (ruta, metodo, uid, rol, cuerpo) => {
  const res = await worker.fetch(new Request(`https://api.test${ruta}`, {
    method: metodo, headers: await hdr(uid, rol), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const admin = (r, m, c) => pedir(r, m, adminId, "admin", c);

const angel = crear("angel", "Ángel Soto", "redactor");
const otro = crear("otro", "Otro Redactor", "redactor");
const foto = crear("foto", "Foto Grafo", "fotografo");
const baja = crear("baja", "Baja Redactor", "redactor", 0);
const acred = Number(sqlite.prepare(
  "INSERT INTO acreditaciones (nombre, email, dni, equipo, tipo_evento, tipo_acreditacion, funciones, jornada_partido) VALUES ('Pepe', 'pepe@x.es', '1X', 'Celta', 'Partido', 'Prensa', 'Cronista', 'J1')"
).run().lastInsertRowid);
const como = (uid, rol) => (r, m, c) => pedir(r, m, uid, rol, c);
const adm = como(adminId, "admin"), ang = como(angel, "redactor"), otr = como(otro, "redactor");

test("al principio solo existe el área fija de acreditaciones y nadie es Sub-Responsable", async () => {
  const r = await ang("/api/subresponsables", "GET");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.areas.map((a) => a.id), ["acreditaciones"]);
  assert.equal(r.data.areas[0].titulo, "Sub-Responsable de las acreditaciones");
  assert.equal(r.data.areas[0].permiso, "acreditaciones");
  assert.equal(r.data.areas[0].fija, true);
  assert.deepEqual(r.data.areas[0].miembros, []);
});

test("sin ser Sub-Responsable, un redactor NO puede tocar las solicitudes de acreditación", async () => {
  for (const [m, ruta, c] of [
    ["GET", "/api/acreditaciones"], ["GET", "/api/acreditaciones/huella"], ["GET", `/api/acreditaciones/${acred}/historial`],
    ["PATCH", "/api/acreditaciones/lote", { ids: [acred], estado: "aprobada" }],
    ["PATCH", `/api/acreditaciones/${acred}`, { estado: "aprobada" }],
  ]) assert.equal((await otr(ruta, m, c)).status, 403, `${m} ${ruta}`);
  assert.equal((await ang("/api/mis-cargos", "GET")).data.puede_gestionar_acreditaciones, false);
});

test("nombrar: solo un Responsable; solo redactores activos", async () => {
  assert.equal((await ang("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel })).status, 403);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "nope", user_id: angel })).status, 400);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: foto })).status, 400);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: adminId })).status, 400);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: baja })).status, 400);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: 99999 })).status, 404);
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones" })).status, 400);
});

test("al nombrar a Ángel, su cargo sale en /api/users y /api/mis-cargos", async () => {
  const r = await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.areas[0].miembros.map((m) => m.id), [angel]);
  const u = (await adm("/api/users", "GET")).data.users.find((x) => x.id === angel);
  assert.equal(u.cargo, "Sub-Responsable de las acreditaciones");
  assert.deepEqual(u.sub_responsable_areas.map((a) => a.id), ["acreditaciones"]);
  const m = (await ang("/api/mis-cargos", "GET")).data;
  assert.equal(m.puede_gestionar_acreditaciones, true);
  assert.equal(m.sub_responsable_de[0].titulo, "Sub-Responsable de las acreditaciones");
  assert.equal((await otr("/api/mis-cargos", "GET")).data.puede_gestionar_acreditaciones, false);
});

test("Ángel gestiona las solicitudes: ver, historial, cambiar estado y lote", async () => {
  assert.equal((await ang("/api/acreditaciones/huella", "GET")).status, 200);
  const lista = await ang("/api/acreditaciones", "GET");
  assert.equal(lista.status, 200);
  assert.equal(lista.data.acreditaciones.length, 1);
  assert.equal((await ang(`/api/acreditaciones/${acred}/historial`, "GET")).status, 200);
  const p = await ang(`/api/acreditaciones/${acred}`, "PATCH", { estado: "aprobada" });
  assert.equal(p.status, 200);
  assert.equal(sqlite.prepare("SELECT estado, revisado_por FROM acreditaciones WHERE id = ?").get(acred).estado, "aprobada");
  const l = await ang("/api/acreditaciones/lote", "PATCH", { ids: [acred], estado: "pendiente" });
  assert.equal(l.status, 200);
  assert.equal(l.data.cambiadas, 1);
});

test("pero NO el PIN, el acceso, la configuración, importar ni borrar", async () => {
  for (const [m, ruta, c] of [
    ["GET", "/api/acreditaciones/pin"], ["PUT", "/api/acreditaciones/pin", { pin: "1234" }],
    ["GET", "/api/acreditaciones/acceso"], ["PUT", "/api/acreditaciones/acceso", { acceso: "pin" }],
    ["PUT", "/api/acreditaciones/config", { instrucciones_aprobada: "x" }],
    ["POST", "/api/acreditaciones/importar", { filas: [] }],
    ["DELETE", `/api/acreditaciones/${acred}`],
    ["GET", "/api/formularios"],
  ]) assert.equal((await ang(ruta, m, c)).status, 403, `${m} ${ruta}`);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM acreditaciones").get().n, 1);
});

test("el permiso solo vale mientras siga siendo redactor activo", async () => {
  sqlite.prepare("UPDATE users SET rol = 'fotografo' WHERE id = ?").run(angel);
  assert.equal((await pedir("/api/acreditaciones", "GET", angel, "fotografo")).status, 403);
  sqlite.prepare("UPDATE users SET rol = 'redactor' WHERE id = ?").run(angel);
  assert.equal((await ang("/api/acreditaciones", "GET")).status, 200);
});

test("quitarle el cargo le quita el permiso; vuelve a nombrarse y no se duplica", async () => {
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel, quitar: true })).status, 200);
  assert.equal((await ang("/api/acreditaciones", "GET")).status, 403);
  assert.equal((await adm("/api/users", "GET")).data.users.find((x) => x.id === angel).cargo, null);
  await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel });
  const r = await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel });
  assert.deepEqual(r.data.areas[0].miembros.map((m) => m.id), [angel]);
});

test("máximo 5 Sub-Responsables por área", async () => {
  const extra = [1, 2, 3, 4].map((i) => crear("x" + i, "Extra " + i, "redactor"));
  for (const id of extra) assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: id })).status, 200);
  const sexto = crear("x5", "Extra 5", "redactor");
  assert.equal((await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: sexto })).status, 400);
  for (const id of extra) await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: id, quitar: true });
});

test("áreas: solo un Responsable las gestiona; la de acreditaciones no se puede quitar ni renombrar", async () => {
  assert.equal((await ang("/api/subresponsables/areas", "PUT", { areas: [] })).status, 403);
  assert.equal((await adm("/api/subresponsables/areas", "PUT", {})).status, 400);
  assert.equal((await adm("/api/subresponsables/areas", "PUT", { areas: [{ nombre: "" }] })).status, 400);
  assert.equal((await adm("/api/subresponsables/areas", "PUT", { areas: [{ nombre: "el Diseño" }, { nombre: "EL diseño" }] })).status, 400);
  const r = await adm("/api/subresponsables/areas", "PUT", { areas: [{ id: "acreditaciones", nombre: "otra cosa" }, { nombre: "el Diseño" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.areas.map((a) => a.nombre), ["las acreditaciones", "el Diseño"]);
  const diseno = r.data.areas[1];
  assert.equal(diseno.titulo, "Sub-Responsable del Diseño");
  assert.equal(diseno.permiso, null);
});

test("un área sin permiso es solo cargo: se ve en /api/users pero no da acceso a acreditaciones", async () => {
  const areas = (await adm("/api/subresponsables", "GET")).data.areas;
  const dis = areas.find((a) => a.nombre === "el Diseño");
  await adm("/api/subresponsables/asignar", "PUT", { area_id: dis.id, user_id: otro });
  const u = (await adm("/api/users", "GET")).data.users.find((x) => x.id === otro);
  assert.equal(u.cargo, "Sub-Responsable del Diseño");
  assert.equal((await otr("/api/acreditaciones", "GET")).status, 403);
  assert.equal((await otr("/api/mis-cargos", "GET")).data.puede_gestionar_acreditaciones, false);
});

test("quien es Sub-Responsable de un grupo Y de un área ve los dos cargos", async () => {
  const g = (await adm("/api/grupos-trabajo", "PUT", { grupos: [{ nombre: "Previas" }] })).data.grupos[0];
  await adm("/api/grupos-trabajo/asignar", "PUT", { user_id: angel, grupo_id: g.id });
  await adm("/api/grupos-trabajo/lider", "PUT", { grupo_id: g.id, user_id: angel });
  await adm("/api/subresponsables/asignar", "PUT", { area_id: "acreditaciones", user_id: angel });
  const u = (await adm("/api/users", "GET")).data.users.find((x) => x.id === angel);
  assert.equal(u.cargo, "Sub-Responsable de Previas · Sub-Responsable de las acreditaciones");
});

test("borrar un área quita a su gente; un Responsable no se ve afectado y todo es visible sin sesión de Responsable", async () => {
  const antes = (await adm("/api/subresponsables", "GET")).data.areas.find((a) => a.nombre === "el Diseño");
  await adm("/api/subresponsables/areas", "PUT", { areas: [] });
  const despues = (await adm("/api/subresponsables", "GET")).data.areas;
  assert.deepEqual(despues.map((a) => a.id), ["acreditaciones"]);
  assert.equal((await adm("/api/users", "GET")).data.users.find((x) => x.id === otro).cargo, null);
  assert.ok(antes.id);
  const sinSesion = await worker.fetch(new Request("https://api.test/api/subresponsables"), env, ctx);
  assert.equal(sinSesion.status, 401);
  assert.equal((await adm("/api/acreditaciones", "GET")).status, 200);
});

test("un valor roto en settings no tumba nada", async () => {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('subresponsables_areas', '{no json') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const r = await adm("/api/subresponsables", "GET");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.areas.map((a) => a.id), ["acreditaciones"]);
  assert.equal((await ang("/api/acreditaciones", "GET")).status, 403);
});
