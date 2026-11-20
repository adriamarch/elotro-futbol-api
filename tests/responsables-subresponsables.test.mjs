// Responsables (antes "administradores") con funciones y Sub-Responsables de grupos de trabajo.
//   PUT /api/grupos-trabajo/lider, GET /api/responsables, PUT /api/responsables/funciones
//   y los campos cargo / funciones / sub_responsable_de de GET /api/users.
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/responsables-subresponsables.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/responsables-subresponsables.test.mjs
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


const previas = (await admin("/api/grupos-trabajo", "PUT", { grupos: [{ nombre: "Previas" }, { nombre: "Las Crónicas" }, { nombre: "Vacío" }] })).data.grupos;
const gPrevias = previas.find((g) => g.nombre === "Previas").id;
const gCronicas = previas.find((g) => g.nombre === "Las Crónicas").id;
const gVacio = previas.find((g) => g.nombre === "Vacío").id;
await admin("/api/grupos-trabajo/asignar", "PUT", { user_ids: [ana, marta], grupo_id: gPrevias });
await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: baja, grupo_id: gCronicas });

const grupo = async (id) => (await admin("/api/grupos-trabajo", "GET")).data.grupos.find((g) => g.id === id);
const usuario = async (id) => (await admin("/api/users", "GET")).data.users.find((u) => u.id === id);

// ---------- Sub-Responsable de grupo ----------
test("al principio ningún grupo tiene Sub-Responsable y el título sale bien", async () => {
  const g = await grupo(gPrevias);
  assert.equal(g.lider, null);
  assert.equal(g.titulo_lider, "Sub-Responsable de Previas");
  assert.equal((await grupo(gCronicas)).titulo_lider, "Sub-Responsable de Las Crónicas");
});

test("solo un Responsable nombra Sub-Responsables", async () => {
  const r = await pedir("/api/grupos-trabajo/lider", "PUT", ana, "redactor", { grupo_id: gPrevias, user_id: ana });
  assert.equal(r.status, 403);
  assert.equal((await grupo(gPrevias)).lider, null);
});

test("se nombra a un miembro del grupo y aparece en el grupo, en /api/users y como cargo", async () => {
  const r = await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: ana });
  assert.equal(r.status, 200);
  const g = r.data.grupos.find((x) => x.id === gPrevias);
  assert.equal(g.lider.id, ana);
  assert.equal(g.lider.nombre, "Ana Pérez");
  const u = await usuario(ana);
  assert.equal(u.sub_responsable_de, gPrevias);
  assert.equal(u.cargo, "Sub-Responsable de Previas");
  const otra = await usuario(marta);
  assert.equal(otra.sub_responsable_de, null);
  assert.equal(otra.cargo, null);
});

test("no se puede nombrar a quien no está en el grupo, a un fotógrafo, a una cuenta desactivada ni a un grupo inexistente", async () => {
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gVacio, user_id: marta })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: luis })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gCronicas, user_id: baja })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: "noexiste", user_id: ana })).status, 400);
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: 99999 })).status, 404);
  assert.equal((await grupo(gPrevias)).lider.id, ana, "un intento fallido no cambia al Sub-Responsable");
});

test("un grupo tiene un solo Sub-Responsable: nombrar a otro sustituye al anterior", async () => {
  await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: marta });
  assert.equal((await grupo(gPrevias)).lider.id, marta);
  assert.equal((await usuario(ana)).sub_responsable_de, null);
  assert.equal((await usuario(marta)).cargo, "Sub-Responsable de Previas");
});

test("quien cambia de grupo o se queda sin grupo deja de ser Sub-Responsable", async () => {
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: gVacio });
  assert.equal((await grupo(gPrevias)).lider, null);
  assert.equal((await usuario(marta)).cargo, null);
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: gPrevias });
  assert.equal((await grupo(gPrevias)).lider, null, "al volver no recupera el cargo solo");
  await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: marta });
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: marta, grupo_id: null });
  assert.equal((await grupo(gPrevias)).lider, null);
});

test("renombrar los grupos conserva al Sub-Responsable; borrar el grupo lo elimina", async () => {
  await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: ana });
  const ahora = (await admin("/api/grupos-trabajo", "GET")).data.grupos;
  const renombrados = ahora.map((g) => ({ id: g.id, nombre: g.id === gPrevias ? "Previas y análisis" : g.nombre, color: g.color }));
  const r = await admin("/api/grupos-trabajo", "PUT", { grupos: renombrados });
  const g = r.data.grupos.find((x) => x.id === gPrevias);
  assert.equal(g.lider.id, ana);
  assert.equal(g.titulo_lider, "Sub-Responsable de Previas y análisis");
  const sin = await admin("/api/grupos-trabajo", "PUT", { grupos: renombrados.filter((x) => x.id !== gPrevias) });
  assert.equal(sin.status, 200);
  assert.equal((await usuario(ana)).sub_responsable_de, null);
  assert.equal((await usuario(ana)).cargo, null);
  // se vuelve a crear con el mismo id para el resto de pruebas
  await admin("/api/grupos-trabajo", "PUT", { grupos: renombrados });
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_ids: [ana, marta], grupo_id: gPrevias });
});

test("quitar el Sub-Responsable con user_id null", async () => {
  await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: ana });
  const r = await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gPrevias, user_id: null });
  assert.equal(r.status, 200);
  assert.equal(r.data.grupos.find((x) => x.id === gPrevias).lider, null);
});

test("un Responsable (admin) también puede ser Sub-Responsable de un grupo y conserva su cargo de Responsable", async () => {
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: adminId, grupo_id: gVacio });
  assert.equal((await admin("/api/grupos-trabajo/lider", "PUT", { grupo_id: gVacio, user_id: adminId })).status, 200);
  const u = await usuario(adminId);
  assert.equal(u.sub_responsable_de, gVacio);
  assert.equal(u.cargo, "Responsable");
  await admin("/api/grupos-trabajo/asignar", "PUT", { user_id: adminId, grupo_id: null });
});

test("un valor de líderes corrupto en settings no rompe nada", async () => {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('grupos_trabajo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ grupos: [{ id: "g1", nombre: "A", color: "#d1132e" }], asignaciones: { [ana]: "g1" }, lideres: { g1: "pepe", zz: 5 } }));
  const r = await admin("/api/grupos-trabajo", "GET");
  assert.equal(r.status, 200);
  assert.equal(r.data.grupos[0].lider, null);
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('grupos_trabajo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ grupos: [{ id: "g1", nombre: "A", color: "#d1132e" }], asignaciones: { [ana]: "g1" }, lideres: { g1: marta } }));
  assert.equal((await admin("/api/grupos-trabajo", "GET")).data.grupos[0].lider, null, "un líder que no está en el grupo no cuenta");
});

// ---------- Responsables y sus funciones ----------
const otroAdmin = crear("adria", "Adrià March", "admin");
const joaquin = crear("joaquin", "Joaquín Vidal", "admin");
const miguel = crear("miguel", "Miguel Mora", "admin");

test("sin funciones, un Responsable se llama solo «Responsable»", async () => {
  const r = await admin("/api/responsables", "GET");
  assert.equal(r.status, 200);
  const a = r.data.responsables.find((x) => x.id === otroAdmin);
  assert.deepEqual(a.funciones, []);
  assert.equal(a.cargo, "Responsable");
});

test("GET /api/responsables pide sesión, y lo puede ver un redactor", async () => {
  const sin = await worker.fetch(new Request("https://api.test/api/responsables"), env, ctx);
  assert.equal(sin.status, 401);
  assert.equal((await pedir("/api/responsables", "GET", ana, "redactor")).status, 200);
});

test("solo un Responsable cambia las funciones", async () => {
  const r = await pedir("/api/responsables/funciones", "PUT", ana, "redactor", { user_id: otroAdmin, funciones: ["el Sitio Web"] });
  assert.equal(r.status, 403);
});

test("los cargos se componen como en los ejemplos: del Sitio Web y los Recursos Humanos", async () => {
  const a = await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: ["el Sitio Web", "los Recursos Humanos"] });
  assert.equal(a.status, 200);
  assert.equal(a.data.cargo, "Responsable del Sitio Web y los Recursos Humanos");
  const j = await admin("/api/responsables/funciones", "PUT", { user_id: joaquin, funciones: ["las acreditaciones"] });
  assert.equal(j.data.cargo, "Responsable de las acreditaciones");
  const m = await admin("/api/responsables/funciones", "PUT", { user_id: miguel, funciones: ["el Diseño", "las Redes Sociales"] });
  assert.equal(m.data.cargo, "Responsable del Diseño y las Redes Sociales");
  const lista = (await admin("/api/responsables", "GET")).data.responsables;
  assert.equal(lista.find((x) => x.id === joaquin).cargo, "Responsable de las acreditaciones");
  const u = await usuario(miguel);
  assert.deepEqual(u.funciones, ["el Diseño", "las Redes Sociales"]);
  assert.equal(u.cargo, "Responsable del Diseño y las Redes Sociales");
});

test("una función sin artículo también queda bien", async () => {
  const r = await admin("/api/responsables/funciones", "PUT", { user_id: joaquin, funciones: ["Acreditaciones"] });
  assert.equal(r.data.cargo, "Responsable de Acreditaciones");
  await admin("/api/responsables/funciones", "PUT", { user_id: joaquin, funciones: ["las acreditaciones"] });
});

test("máximo dos funciones, longitud limitada, sin duplicados ni vacías", async () => {
  const tres = await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: ["a", "b", "c"] });
  assert.equal(tres.status, 400);
  assert.match(tres.data.error, /máximo 2 funciones/);
  assert.equal((await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: ["x".repeat(41)] })).status, 400);
  assert.equal((await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: "el Sitio Web" })).status, 400);
  assert.equal((await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: [5] })).status, 400);
  const ok = await admin("/api/responsables/funciones", "PUT", { user_id: otroAdmin, funciones: ["  el Sitio Web ", "EL SITIO WEB", "", "los Recursos Humanos"] });
  assert.deepEqual(ok.data.funciones, ["el Sitio Web", "los Recursos Humanos"]);
  // las rechazadas no tocan lo guardado
  assert.deepEqual((await usuario(otroAdmin)).funciones, ["el Sitio Web", "los Recursos Humanos"]);
});

test("las funciones son solo para Responsables y los usuarios inexistentes dan 404", async () => {
  assert.equal((await admin("/api/responsables/funciones", "PUT", { user_id: ana, funciones: ["el Sitio Web"] })).status, 400);
  assert.equal((await admin("/api/responsables/funciones", "PUT", { user_id: 99999, funciones: ["el Sitio Web"] })).status, 404);
  assert.equal((await admin("/api/responsables/funciones", "PUT", { funciones: [] })).status, 400);
});

test("dejar la lista vacía quita las funciones", async () => {
  await admin("/api/responsables/funciones", "PUT", { user_id: miguel, funciones: [] });
  assert.equal((await usuario(miguel)).cargo, "Responsable");
  assert.deepEqual((await usuario(miguel)).funciones, []);
});

test("si alguien deja de ser Responsable, sus funciones no aparecen ni en el listado ni en su cargo", async () => {
  sqlite.prepare("UPDATE users SET rol = 'redactor' WHERE id = ?").run(joaquin);
  assert.equal((await admin("/api/responsables", "GET")).data.responsables.some((x) => x.id === joaquin), false);
  const u = await usuario(joaquin);
  assert.deepEqual(u.funciones, []);
  assert.equal(u.cargo, null);
  sqlite.prepare("UPDATE users SET rol = 'admin' WHERE id = ?").run(joaquin);
  assert.equal((await usuario(joaquin)).cargo, "Responsable de las acreditaciones", "al volver recupera lo guardado");
});

test("un valor corrupto de funciones no rompe /api/users ni /api/responsables", async () => {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('responsables_funciones', '{no es json') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  assert.equal((await admin("/api/users", "GET")).status, 200);
  assert.equal((await admin("/api/responsables", "GET")).data.responsables.find((x) => x.id === otroAdmin).cargo, "Responsable");
});
