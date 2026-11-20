// GET /api/me/resumen-inicio y PUT/DELETE /api/inicio/anuncio de extremo a extremo: Worker real + SQLite real.
//   node --no-warnings --test tests/resumen-inicio-endpoint.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/resumen-inicio-endpoint.test.mjs
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
      _sql: sql, _args: args,
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
};
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
const pedir = (ruta, init) => worker.fetch(new Request(`https://api.elotrofutbol.media${ruta}`, init), env, ctx);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const alta = (u, nombre, rol, nivel, equipo) => Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, equipo, email) VALUES (?, 'x', 'x', ?, ?, ?, ?, ?)").run(u, nombre, rol, nivel, equipo, `${u}@x.es`).lastInsertRowid);
const adminId = alta("admin", "Admin", "admin", 4, null);
const anaId = alta("ana", "Ana Pérez", "redactor", 2, '["Real Oviedo"]');
const fotoId = alta("foto", "Fran Foto", "fotografo", 1, '["Real Oviedo"]');
const cab = async (id, rol, nombre) => ({ Authorization: `Bearer ${await jwt({ uid: id, rol, nombre, tfa: true })}`, "Content-Type": "application/json" });
const hAdmin = await cab(adminId, "admin", "Admin"), hAna = await cab(anaId, "redactor", "Ana Pérez"), hFoto = await cab(fotoId, "fotografo", "Fran Foto");

sqlite.exec("INSERT INTO results (competicion,jornada,equipo_local,equipo_visitante,fecha_partido,estado) VALUES ('hypermotion',3,'Real Oviedo','Levante','2099-01-01T18:30','programado')");

test("sin sesión: 401", async () => {
  assert.equal((await pedir("/api/me/resumen-inicio")).status, 401);
});
test("Responsable: bloques de equipo y revisión", async () => {
  const r = await pedir("/api/me/resumen-inicio", { headers: hAdmin });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.rol, "admin");
  assert.ok(d.equipo && d.revision && d.acreditaciones && d.solicitudes);
  assert.equal(d.sin_cubrir, null);
});
test("Redactora: sin bloques de Responsable, con sus partidos y su progreso", async () => {
  const d = await (await pedir("/api/me/resumen-inicio", { headers: hAna })).json();
  assert.equal(d.rol, "redactor");
  assert.equal(d.equipo, null);
  assert.equal(d.revision, null);
  assert.ok(d.ranking && d.progreso_nivel && d.sin_cubrir);
  assert.equal(d.sin_cubrir.equipos[0], "Real Oviedo");
  assert.equal(d.sin_cubrir.total, 0, "el partido es de 2099: fuera de la ventana de 14 días");
});
test("Fotógrafo: sin ranking y con sus bloques", async () => {
  const d = await (await pedir("/api/me/resumen-inicio", { headers: hFoto })).json();
  assert.equal(d.ranking, null);
  assert.ok(d.partidos_sin_fotos && Array.isArray(d.fotos_top));
});
test("Anuncio: solo un Responsable lo fija; todos lo ven; se retira", async () => {
  const put = (h, body) => pedir("/api/inicio/anuncio", { method: "PUT", headers: h, body: JSON.stringify(body) });
  assert.equal((await put(hAna, { texto: "hola" })).status, 403);
  assert.equal((await put(hAdmin, { texto: "x".repeat(401) })).status, 400);
  assert.equal((await put(hAdmin, { texto: "hola", caduca: "mañana" })).status, 400);
  const ok = await put(hAdmin, { titulo: "Reunión", texto: "El jueves a las 20:00." });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).anuncio.autor, "Admin");
  const d = await (await pedir("/api/me/resumen-inicio", { headers: hFoto })).json();
  assert.equal(d.anuncio.texto, "El jueves a las 20:00.");
  assert.equal((await pedir("/api/inicio/anuncio", { method: "DELETE", headers: hAdmin })).status, 200);
  assert.equal((await (await pedir("/api/me/resumen-inicio", { headers: hFoto })).json()).anuncio, null);
});
