// Responsabilidades > Redacción / Fotografía: avisos de niveles (fase 2).
//   cron (avisarNivelesListosSiToca) -> correo a los Responsables cuando alguien cumple los requisitos
//   GET/PUT /api/responsabilidades/niveles/avisos                    (preferencia del correo)
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/niveles-avisos.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/niveles-avisos.test.mjs
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
sqlite.exec(readFileSync(join(aqui, "../migracion_acreditaciones_v2.sql"), "utf8"));

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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1", RESEND_API_KEY: "re_test" };
const pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

// Correos: se captura todo lo que iría a Resend (solo cuentan los avisos de niveles).
const correos = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opciones) => {
  if (String(url).includes("api.resend.com")) {
    const cuerpo = JSON.parse(opciones.body);
    if (/subir de nivel/.test(cuerpo.subject || "")) correos.push(cuerpo);
    return { ok: true, status: 200, text: async () => "" };
  }
  return fetchReal(url, opciones);
};
// Cada pasada del cron espera 10 min entre sí: se adelanta el reloj en vez de esperar.
const relojReal = Date.now;
let desfase = 0;
Date.now = () => relojReal() + desfase;
const pasada = async () => { desfase += 11 * 60 * 1000; await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" }, env, ctx); await Promise.allSettled(pendientes.splice(0)); };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}
const crearUsuario = (username, nombre, rol, email) => Number(sqlite.prepare(
  "INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email, activo) VALUES (?, 'x', 'x', ?, ?, 1, ?, 1)"
).run(username, nombre, rol, email || username + "@x.es").lastInsertRowid);
const cabecera = async (uid, rol) => ({ Authorization: `Bearer ${await jwt({ uid, rol, nombre: "Resp", tfa: true })}`, "Content-Type": "application/json" });
const avisos = async (uid, rol, metodo = "GET", cuerpo) => {
  const res = await worker.fetch(new Request("https://api.test/api/responsabilidades/niveles/avisos", { method: metodo, headers: await cabecera(uid, rol), body: cuerpo ? JSON.stringify(cuerpo) : undefined }), env, ctx);
  return { status: res.status, cuerpo: await res.json() };
};
const decidir = async (uid, rol, cuerpo) => {
  const res = await worker.fetch(new Request("https://api.test/api/responsabilidades/niveles/decision", { method: "POST", headers: await cabecera(uid, rol), body: JSON.stringify(cuerpo) }), env, ctx);
  return { status: res.status, cuerpo: await res.json() };
};

const DIA = 86400000;
const dia = (offset) => new Date(Date.now() + offset * DIA).toISOString().slice(0, 10);
let seq = 0;
const partido = ({ local, visitante, jornada, offset, estado = "finalizado", slug = null }) => Number(sqlite.prepare(
  `INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, estado, fecha_partido, slug)
   VALUES ('primera_federacion', ?, ?, ?, 2, 1, ?, ?, ?)`
).run(jornada, local, visitante, estado, dia(offset), slug).lastInsertRowid);
const foto = ({ autor, visibilidad = "publico", tipo = "foto" }) => { seq++; return Number(sqlite.prepare(
  `INSERT INTO media (cloudinary_public_id, cloudinary_resource_type, cloudinary_url, titulo, tipo, nombre_archivo, content_type, tamano_bytes, autor_id, visibilidad)
   VALUES (?, 'image', ?, 'f', ?, 'f.jpg', 'image/jpeg', 10, ?, ?)`
).run("pub" + seq, "https://img.test/" + seq + ".jpg", tipo, autor, visibilidad).lastInsertRowid); };
const enGaleria = (resultId, mediaId, autor) => sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (?, ?, ?)").run(resultId, mediaId, autor);

const articulo = (autor, tipo, n = 1) => { for (let i = 0; i < n; i++) { seq++; sqlite.prepare(
  "INSERT INTO articles (titulo, slug, contenido, categoria, tipo, autor_id, publicado) VALUES (?, ?, 'x', 'hypermotion', ?, ?, 1)"
).run("T" + seq, "t-" + seq, tipo, autor); } };
const cumpleN2 = (autor) => { articulo(autor, "noticia", 6); articulo(autor, "cronica", 3); articulo(autor, "opinion", 1); };
let partidoN = 0;
const cumpleF2 = (autor) => { for (let p = 0; p < 5; p++) { partidoN++;
  const r = Number(sqlite.prepare("INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, estado, fecha_partido) VALUES ('primera_federacion', ?, 'A' || ?, 'B' || ?, 1, 0, 'finalizado', '2026-10-01')").run(partidoN, partidoN, partidoN).lastInsertRowid);
  for (let k = 0; k < 20; k++) enGaleria(r, foto({ autor }), autor); } };

const admin = crearUsuario("admin", "Admin", "admin", "resp@x.es");
const otroAdmin = crearUsuario("admin2", "Admin Dos", "admin", "resp2@x.es");
const lola = crearUsuario("lola", "Lola Lista", "redactor");
const pepe = crearUsuario("pepe", "Pepe Pospuesto", "redactor");
const rita = crearUsuario("rita", "Rita Retraso", "redactor");
const fer = crearUsuario("fer", "Fer Foto", "fotografo");

test("preferencia de correo: solo Responsables; por defecto activada y se puede apagar", async () => {
  assert.equal((await avisos(lola, "redactor")).status, 403);
  assert.deepEqual((await avisos(admin, "admin")).cuerpo, { ok: true, email: true });
  assert.equal((await avisos(admin, "admin", "PUT", { email: "no" })).status, 400);
  assert.equal((await avisos(otroAdmin, "admin", "PUT", { email: false })).cuerpo.email, false);
  assert.equal((await avisos(admin, "admin")).cuerpo.email, true); // la de otro Responsable no afecta
  assert.equal((await avisos(otroAdmin, "admin", "PUT", { email: true })).cuerpo.email, true);
});

test("sin nadie que cumpla no hay aviso", async () => {
  await pasada();
  assert.equal(correos.length, 0);
});

test("alguien cumple: un correo a cada Responsable, una sola vez", async () => {
  cumpleN2(lola);
  await pasada();
  assert.deepEqual(correos.flatMap((c) => c.to).sort(), ["resp2@x.es", "resp@x.es"]);
  assert.match(correos[0].subject, /^1 persona cumple los requisitos para subir de nivel/);
  assert.match(correos[0].text, /Lola Lista \(N1 → N2\)/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM nivel_avisos WHERE usuario_id = ?").get(lola).n, 1);
  correos.length = 0;
  await pasada(); await pasada();
  assert.equal(correos.length, 0, "no se repite el aviso de la misma persona y nivel");
});

test("a quien ya se valoró con «Ahora no» no se le avisa", async () => {
  cumpleN2(pepe);
  assert.equal((await decidir(admin, "admin", { usuario_id: pepe, decision: "aplazar", nota: "Más adelante" })).status, 200);
  correos.length = 0;
  await pasada();
  assert.equal(correos.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM nivel_avisos WHERE usuario_id = ?").get(pepe).n, 0);
});

test("un fotógrafo que cumple F2 se avisa aparte y agrupa por área", async () => {
  cumpleF2(fer);
  await pasada();
  assert.equal(correos.length, 2);
  assert.match(correos[0].subject, /^1 persona cumple/);
  assert.match(correos[0].text, /Fotografía: Fer Foto \(F1 → F2\)/);
  assert.doesNotMatch(correos[0].text, /Lola/);
});

test("con el correo desactivado no sale nada y el aviso se reintenta cuando se reactiva", async () => {
  await avisos(admin, "admin", "PUT", { email: false });
  await avisos(otroAdmin, "admin", "PUT", { email: false });
  cumpleN2(rita);
  correos.length = 0;
  await pasada();
  assert.equal(correos.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM nivel_avisos WHERE usuario_id = ?").get(rita).n, 0, "se libera para reintentar");
  await avisos(admin, "admin", "PUT", { email: true });
  await pasada();
  assert.deepEqual(correos.flatMap((c) => c.to), ["resp@x.es"]);
  assert.match(correos[0].text, /Rita Retraso/);
});

test("la campanita ofrece «niveles» solo a los Responsables", async () => {
  const res = await worker.fetch(new Request("https://api.test/api/staff-push/estado", { headers: await cabecera(admin, "admin") }), env, ctx);
  assert.ok((await res.json()).categorias.some((c) => c.id === "niveles"));
  const n4 = crearUsuario("exp", "Experto", "redactor");
  sqlite.prepare("UPDATE users SET nivel = 4 WHERE id = ?").run(n4);
  const r4 = await worker.fetch(new Request("https://api.test/api/staff-push/estado", { headers: await cabecera(n4, "redactor") }), env, ctx);
  const c4 = (await r4.json()).categorias.map((c) => c.id);
  assert.ok(c4.includes("contenido") && !c4.includes("niveles"));
});
