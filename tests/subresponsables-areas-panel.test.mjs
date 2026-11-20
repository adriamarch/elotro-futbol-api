// Panel (Información > Sub-Responsables de áreas): simula public/admin/js/subresponsables-areas.js con un DOM falso
// contra el worker real. Uso: node --no-warnings --test tests/subresponsables-areas-panel.test.mjs
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


import { readFileSync as leer } from "node:fs";
const angel = crear("angel", "Ángel Soto", "redactor");
const otro = crear("otro", "Otro Redactor", "redactor");
const foto = crear("foto", "Foto Grafo", "fotografo");

// ---- DOM falso mínimo ----
const oyentes = {};
const cont = { innerHTML: "", contains: () => true };
const seccion = { hidden: false };
globalThis.window = globalThis;
globalThis.document = {
  addEventListener: (t, f) => { (oyentes[t] ||= []).push(f); },
  getElementById: (id) => (id === "areasSubResponsables" ? cont : id === "infoAreasSub" ? seccion : null),
};
let sesion = { uid: adminId, rol: "admin" };
globalThis.USER = { id: adminId, rol: "admin" };
globalThis.USUARIOS_LISTA = [];
globalThis.renderTablaUsuarios = () => { globalThis.__repintado = (globalThis.__repintado || 0) + 1; };
const avisos = [];
globalThis.EOF = { toast: (m, t) => avisos.push([t, m]), confirmar: async () => true };
globalThis.apiFetch = async (ruta, op = {}) => {
  const r = await pedir(ruta, op.method || "GET", sesion.uid, sesion.rol, op.body ? JSON.parse(op.body) : undefined);
  if (r.status >= 400) { const e = new Error(r.data.error || "Error"); e.status = r.status; throw e; }
  return r.data;
};
const modulo = leer(new URL("../../public/admin/js/subresponsables-areas.js", import.meta.url), "utf8");
(0, eval)(modulo);
const disparar = (tipo, objetivo) => oyentes[tipo].forEach((f) => f({ target: objetivo, preventDefault() {} }));
const pausa = () => new Promise((r) => setTimeout(r, 60));
const objetivo = (atributo, dataset, extra = {}) => ({ dataset, ...extra, closest: (sel) => (sel.includes(atributo) ? objetivo(atributo, dataset, extra) : null) });

test("Responsable: pinta el área de acreditaciones con selector y permiso", async () => {
  globalThis.USUARIOS_LISTA = (await pedir("/api/users", "GET", adminId, "admin")).data.users;
  await window.EOFAreasSub.cargar();
  assert.match(cont.innerHTML, /Sub-Responsable de las acreditaciones/);
  assert.match(cont.innerHTML, /Gestiona las solicitudes de acreditación/);
  assert.match(cont.innerHTML, /data-sa-anadir="acreditaciones"/);
  assert.match(cont.innerHTML, /Ángel Soto/);          // candidato en el desplegable
  assert.doesNotMatch(cont.innerHTML, /Foto Grafo/);   // fotógrafo no es candidato
  assert.doesNotMatch(cont.innerHTML, /Eliminar área/); // el área fija no se borra
  assert.equal(seccion.hidden, false);
});

test("elegir a Ángel en el desplegable lo nombra y refresca Usuarios en memoria", async () => {
  disparar("change", objetivo("data-sa-anadir", { saAnadir: "acreditaciones" }, { value: String(angel) }));
  await pausa();
  assert.match(cont.innerHTML, /sa-yo|Ángel Soto/);
  assert.match(cont.innerHTML, /data-sa-quitar="acreditaciones"/);
  assert.ok(avisos.some(([, m]) => /Ángel Soto es ahora Sub-Responsable de las acreditaciones/.test(m)));
  const u = USUARIOS_LISTA.find((x) => x.id === angel);
  assert.equal(u.sub_responsable_areas[0].titulo, "Sub-Responsable de las acreditaciones");
  assert.ok(globalThis.__repintado >= 1);
  assert.equal((await pedir("/api/acreditaciones", "GET", angel, "redactor")).status, 200);
});

test("crear un área nueva y borrarla desde el formulario/botón", async () => {
  const input = { value: "  el   Diseño " };
  oyentes.submit.forEach((f) => f({ target: { closest: (s) => (s.includes("data-sa='nueva'") ? { querySelector: () => input } : null) }, preventDefault() {} }));
  await pausa();
  assert.match(cont.innerHTML, /<h5 class="gt-nombre">Sub-Responsable del Diseño<\/h5>/);
  assert.match(cont.innerHTML, /Solo cargo/);
  assert.match(cont.innerHTML, /data-sa-borrar/);
  const dis = (await pedir("/api/subresponsables", "GET", adminId, "admin")).data.areas.find((a) => a.nombre === "el Diseño");
  disparar("click", objetivo("data-sa-borrar", { saBorrar: dis.id }));
  await pausa();
  assert.doesNotMatch(cont.innerHTML, /<h5 class="gt-nombre">Sub-Responsable del Diseño<\/h5>/);
  assert.doesNotMatch(cont.innerHTML, /data-sa-borrar/);
});

test("quitar a Ángel con la ✕ le retira el cargo y el permiso", async () => {
  disparar("click", objetivo("data-sa-quitar", { saQuitar: "acreditaciones", saUser: String(angel) }));
  await pausa();
  assert.doesNotMatch(cont.innerHTML, /data-sa-quitar/);
  assert.equal((await pedir("/api/acreditaciones", "GET", angel, "redactor")).status, 403);
  assert.equal(USUARIOS_LISTA.find((x) => x.id === angel).sub_responsable_areas.length, 0);
});

test("redactor: ve las áreas pero sin controles de gestión; fotógrafo: sección oculta", async () => {
  await pedir("/api/subresponsables/asignar", "PUT", adminId, "admin", { area_id: "acreditaciones", user_id: angel });
  sesion = { uid: angel, rol: "redactor" }; globalThis.USER = { id: angel, rol: "redactor" };
  await window.EOFAreasSub.cargar();
  assert.match(cont.innerHTML, /Ángel Soto/);
  assert.match(cont.innerHTML, /\(tú\)/);
  assert.doesNotMatch(cont.innerHTML, /data-sa-anadir|data-sa-quitar|Nueva área/);
  sesion = { uid: foto, rol: "fotografo" }; globalThis.USER = { id: foto, rol: "fotografo" };
  cont.innerHTML = "";
  await window.EOFAreasSub.cargar();
  assert.equal(seccion.hidden, true);
  assert.equal(cont.innerHTML, "");
});
