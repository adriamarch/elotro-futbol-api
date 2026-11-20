// Responsabilidades > Redacción / Fotografía: control de niveles (fase 1).
//   GET  /api/responsabilidades/niveles?area=redaccion|fotografia   (solo Responsables)
//   POST /api/responsabilidades/niveles/decision                     (subir | aplazar)
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/responsabilidades-niveles.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/responsabilidades-niveles.test.mjs
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
const env = { DB, JWT_SECRET, TURNSTILE_DESACTIVADO: "1" };
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

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
const pedir = async (uid, rol, area) => {
  const res = await worker.fetch(new Request(`https://api.test/api/responsabilidades/niveles${area ? "?area=" + area : ""}`, { headers: await cabecera(uid, rol) }), env, ctx);
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

const admin = crearUsuario("admin", "Admin", "admin");
const redactor = crearUsuario("ana", "Ana Cerca", "redactor");          // N1, casi cumple N2
const listo = crearUsuario("lola", "Lola Lista", "redactor");           // N1, cumple N2 (6 noticias, 3 crónicas, 1 opinión)
const lejos = crearUsuario("leo", "Leo Lejos", "redactor");             // N1, 1 noticia
const maximo = crearUsuario("max", "Max Experto", "redactor");
sqlite.prepare("UPDATE users SET nivel = 4 WHERE id = ?").run(maximo);
const fotoListo = crearUsuario("fer", "Fer Foto", "fotografo");         // F1, cumple F2 (5 partidos, 100 fotos)
const fotoCerca = crearUsuario("fia", "Fia Foto", "fotografo");         // F1, 3 partidos, 40 fotos
const fotoMax = crearUsuario("fax", "Fax Foto", "fotografo");
sqlite.prepare("UPDATE users SET nivel = 2 WHERE id = ?").run(fotoMax);
const inactivo = crearUsuario("ino", "Inactivo", "redactor");
sqlite.prepare("UPDATE users SET activo = 0 WHERE id = ?").run(inactivo);

articulo(redactor, "noticia", 5); articulo(redactor, "cronica", 3); articulo(redactor, "opinion", 0);
articulo(listo, "noticia", 6); articulo(listo, "cronica", 3); articulo(listo, "opinion", 1);
articulo(lejos, "noticia", 1);

let partidoN = 0;
const partidosDe = (autor, partidos, fotos) => {
  for (let p = 0; p < partidos; p++) {
    partidoN++;
    const r = Number(sqlite.prepare("INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, estado, fecha_partido) VALUES ('primera_federacion', ?, 'A' || ?, 'B' || ?, 1, 0, 'finalizado', '2026-10-01')").run(partidoN, partidoN, partidoN).lastInsertRowid);
    const porPartido = Math.floor(fotos / partidos) + (p === 0 ? fotos % partidos : 0);
    for (let k = 0; k < porPartido; k++) enGaleria(r, foto({ autor }), autor);
  }
};
partidosDe(fotoListo, 5, 100);
partidosDe(fotoCerca, 3, 40);

const porNombre = (c, n) => c.personas.find((p) => p.nombre === n);

test("solo un Responsable puede verlo y el área debe ser válida", async () => {
  assert.equal((await pedir(redactor, "redactor", "redaccion")).status, 403);
  assert.equal((await pedir(fotoListo, "fotografo", "fotografia")).status, 403);
  assert.equal((await pedir(admin, "admin", "otra")).status, 400);
  assert.equal((await pedir(admin, "admin", "redaccion")).status, 200);
});

test("redacción: progreso, porcentaje y quién cumple N2; fuera máximos e inactivos", async () => {
  const { cuerpo } = await pedir(admin, "admin", "redaccion");
  assert.deepEqual(cuerpo.personas.map((p) => p.nombre), ["Lola Lista", "Ana Cerca", "Leo Lejos"]);
  const l = porNombre(cuerpo, "Lola Lista");
  assert.equal(l.cumple, true); assert.equal(l.porcentaje, 100); assert.equal(l.siguiente.etiqueta, "N2"); assert.equal(l.actual.etiqueta, "N1");
  const a = porNombre(cuerpo, "Ana Cerca");
  assert.equal(a.cumple, false); assert.equal(a.faltan, 2); // 1 noticia + 1 opinión
  assert.ok(a.porcentaje > 50 && a.porcentaje < 100);
  assert.deepEqual(cuerpo.en_maximo.map((m) => m.nombre), ["Max Experto"]);
  assert.deepEqual(cuerpo.cercanos, [redactor, lejos]);
  assert.equal(cuerpo.resumen.listos, 1);
});

test("fotografía: usa partidos y fotos con galería; F2 es el máximo", async () => {
  const { cuerpo } = await pedir(admin, "admin", "fotografia");
  assert.deepEqual(cuerpo.personas.map((p) => p.nombre), ["Fer Foto", "Fia Foto"]);
  const f = porNombre(cuerpo, "Fer Foto");
  assert.equal(f.cumple, true); assert.equal(f.siguiente.etiqueta, "F2");
  const c = porNombre(cuerpo, "Fia Foto");
  assert.equal(c.cumple, false); assert.equal(c.requisitos.find((r) => r.tipo === "fotos").actual, 40);
  assert.deepEqual(cuerpo.en_maximo.map((m) => m.nombre), ["Fax Foto"]);
});

test("decisión: validaciones", async () => {
  assert.equal((await decidir(redactor, "redactor", { usuario_id: listo, decision: "subir" })).status, 403);
  assert.equal((await decidir(admin, "admin", { usuario_id: listo, decision: "quizas" })).status, 400);
  assert.equal((await decidir(admin, "admin", { usuario_id: admin, decision: "subir" })).status, 400);
  assert.equal((await decidir(admin, "admin", { usuario_id: maximo, decision: "subir" })).status, 400);
  assert.equal((await decidir(admin, "admin", { usuario_id: redactor, decision: "subir" })).status, 409); // aún no cumple
});

test("«Ahora no»: queda registrado, no cambia el nivel y se ve en la tarjeta", async () => {
  const r = await decidir(admin, "admin", { usuario_id: listo, decision: "aplazar", nota: "Esperar a fin de mes" });
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare("SELECT nivel FROM users WHERE id = ?").get(listo).nivel, 1);
  const { cuerpo } = await pedir(admin, "admin", "redaccion");
  const l = porNombre(cuerpo, "Lola Lista");
  assert.equal(l.valoracion.decision, "aplazado"); assert.equal(l.valoracion.nota, "Esperar a fin de mes"); assert.equal(l.valoracion.por, "Resp");
});

test("«Subir»: sube un nivel, deja historial y nota, y sale de la lista", async () => {
  const r = await decidir(admin, "admin", { usuario_id: listo, decision: "subir", nota: "Buen trabajo" });
  assert.equal(r.status, 200); assert.equal(r.cuerpo.nivel_nuevo, 2); assert.equal(r.cuerpo.etiqueta, "2");
  const u = sqlite.prepare("SELECT nivel, nivel_nota FROM users WHERE id = ?").get(listo);
  assert.equal(u.nivel, 2); assert.equal(u.nivel_nota, "Buen trabajo");
  const h = sqlite.prepare("SELECT nivel_anterior, nivel_nuevo, motivo FROM nivel_historial WHERE usuario_id = ?").all(listo);
  assert.deepEqual(h.map((x) => ({ ...x })), [{ nivel_anterior: 1, nivel_nuevo: 2, motivo: "Buen trabajo" }]);
  const { cuerpo } = await pedir(admin, "admin", "redaccion");
  const nueva = porNombre(cuerpo, "Lola Lista"); // ahora aspira a N3 y no cumple
  assert.equal(nueva.siguiente.etiqueta, "N3"); assert.equal(nueva.cumple, false);
});

test("fotógrafo: subir F1 -> F2 y ya no se puede subir más", async () => {
  const r = await decidir(admin, "admin", { usuario_id: fotoListo, decision: "subir" });
  assert.equal(r.status, 200); assert.equal(r.cuerpo.etiqueta, "F2");
  assert.equal((await decidir(admin, "admin", { usuario_id: fotoListo, decision: "subir" })).status, 400);
});
