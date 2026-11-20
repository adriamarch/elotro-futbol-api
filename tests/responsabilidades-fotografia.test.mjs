// Responsabilidades > Fotografía: fotógrafos con la acreditación aprobada y estado de la galería de su partido.
//   GET /api/responsabilidades/fotografia  (solo Responsables, solo lectura)
//   POST /api/responsabilidades/fotografia/recordar  (recordatorio manual; solo el Worker principal envía)
// Worker real + SQLite real con el esquema completo. Uso:
//   node --no-warnings --test tests/responsabilidades-fotografia.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/responsabilidades-fotografia.test.mjs
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
const pedir = async (uid, rol) => {
  const res = await worker.fetch(new Request("https://api.test/api/responsabilidades/fotografia", {
    headers: { Authorization: `Bearer ${await jwt({ uid, rol, nombre: "x", tfa: true })}` },
  }), env, ctx);
  return { status: res.status, cuerpo: await res.json() };
};

const DIA = 86400000;
const dia = (offset) => new Date(Date.now() + offset * DIA).toISOString().slice(0, 10);
let seq = 0;
const partido = ({ local, visitante, jornada, offset, estado = "finalizado", slug = null }) => Number(sqlite.prepare(
  `INSERT INTO results (competicion, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, estado, fecha_partido, slug)
   VALUES ('primera_federacion', ?, ?, ?, 2, 1, ?, ?, ?)`
).run(jornada, local, visitante, estado, dia(offset), slug).lastInsertRowid);
const acred = ({ nombre, email, equipo, tipo = "Fotógrafo (césped)", estado = "aprobada", jornada = "", fecha = null }) => Number(sqlite.prepare(
  `INSERT INTO acreditaciones (nombre, email, dni, equipo, tipo_evento, tipo_acreditacion, funciones, jornada_partido, estado, fecha_partido)
   VALUES (?, ?, '12345678Z', ?, 'Partido', ?, 'Fotos', ?, ?, ?)`
).run(nombre, email, equipo, tipo, jornada, estado, fecha).lastInsertRowid);
const foto = ({ autor, visibilidad = "publico", tipo = "foto" }) => { seq++; return Number(sqlite.prepare(
  `INSERT INTO media (cloudinary_public_id, cloudinary_resource_type, cloudinary_url, titulo, tipo, nombre_archivo, content_type, tamano_bytes, autor_id, visibilidad)
   VALUES (?, 'image', ?, 'f', ?, 'f.jpg', 'image/jpeg', 10, ?, ?)`
).run("pub" + seq, "https://img.test/" + seq + ".jpg", tipo, autor, visibilidad).lastInsertRowid); };
const enGaleria = (resultId, mediaId, autor) => sqlite.prepare("INSERT INTO match_gallery (result_id, media_id, vinculado_por_id) VALUES (?, ?, ?)").run(resultId, mediaId, autor);

const admin = crearUsuario("admin", "Admin", "admin");
const luis = crearUsuario("luis", "Luis Foto", "fotografo", "luis@x.es");
const redactor = crearUsuario("ana", "Ana", "redactor");

// Partidos (hace 3 días, hace 10, mañana, y uno cualquiera de otra jornada)
const pPublicado = partido({ local: "CD Alfa", visitante: "UD Beta", jornada: 10, offset: -3, slug: "alfa-beta-j10" });
const pPrivado = partido({ local: "CD Gamma", visitante: "UD Delta", jornada: 10, offset: -3, slug: "gamma-delta-j10" });
const pVacio = partido({ local: "CD Epsilon", visitante: "UD Zeta", jornada: 9, offset: -10 });
const pFuturo = partido({ local: "CD Eta", visitante: "UD Theta", jornada: 11, offset: 1, estado: "programado" });

// Galería publicada (2 fotos de Luis, 1 de otra persona) + galería con todo en privado
const fp1 = foto({ autor: luis }), fp2 = foto({ autor: luis }), fp3 = foto({ autor: 999 });
[fp1, fp2, fp3].forEach((m) => enGaleria(pPublicado, m, luis));
const fq = foto({ autor: luis, visibilidad: "privado" });
enGaleria(pPrivado, fq, luis);

acred({ nombre: "Luis Foto", email: "luis@x.es", equipo: "CD Alfa", fecha: dia(-3) });
acred({ nombre: "Sin Cuenta", email: "nadie@x.es", equipo: "CD Gamma", jornada: "Jornada 10" });
acred({ nombre: "Paula Vacía", email: "paula@x.es", equipo: "CD Epsilon", jornada: "Jornada 9" });
acred({ nombre: "Futuro Fran", email: "fran@x.es", equipo: "CD Eta", fecha: dia(1) });
acred({ nombre: "Perdida Pilar", email: "pilar@x.es", equipo: "Club Inventado", jornada: "Jornada 3" });
// No deben salir: no aprobada, no es fotógrafo, y rechazada
acred({ nombre: "Pendiente", email: "pen@x.es", equipo: "CD Alfa", estado: "pendiente", fecha: dia(-3) });
acred({ nombre: "Redactor Rubén", email: "rub@x.es", equipo: "CD Alfa", tipo: "Redactor", fecha: dia(-3) });
acred({ nombre: "Rechazado", email: "rec@x.es", equipo: "CD Alfa", estado: "rechazada", fecha: dia(-3) });

const porNombre = (cuerpo, nombre) => cuerpo.fotografos.find((f) => f.nombre === nombre);

test("solo un Responsable puede verlo", async () => {
  assert.equal((await pedir(luis, "fotografo")).status, 403);
  assert.equal((await pedir(redactor, "redactor")).status, 403);
  assert.equal((await pedir(admin, "admin")).status, 200);
});

test("solo salen las acreditaciones APROBADAS de fotógrafo", async () => {
  const { cuerpo } = await pedir(admin, "admin");
  const nombres = cuerpo.fotografos.map((f) => f.nombre).sort();
  assert.deepEqual(nombres, ["Futuro Fran", "Luis Foto", "Paula Vacía", "Perdida Pilar", "Sin Cuenta"]);
});

test("galería PUBLICADA: cuenta total, públicas y las fotos propias; da el enlace público", async () => {
  const { cuerpo } = await pedir(admin, "admin");
  const l = porNombre(cuerpo, "Luis Foto");
  assert.equal(l.partido.id, pPublicado);
  assert.equal(l.galeria.estado, "publicada");
  assert.equal(l.galeria.total, 3);
  assert.equal(l.galeria.publicas, 3);
  assert.equal(l.galeria.mias, 2);
  assert.equal(l.galeria.mias_publicas, 2);
  assert.equal(l.galeria.url, "https://elotrofutbol.media/galeria/alfa-beta-j10");
  assert.equal(l.cuenta.id, luis);
});

test("la cuenta trae la foto de perfil (si la tiene) para pintarla en la tarjeta", async () => {
  sqlite.prepare("UPDATE users SET avatar_url = ?, avatar_foco = ? WHERE id = ?").run("https://img.test/luis.jpg", "30% 20%", luis);
  const { cuerpo } = await pedir(admin, "admin");
  const l = porNombre(cuerpo, "Luis Foto");
  assert.equal(l.cuenta.avatar_url, "https://img.test/luis.jpg");
  assert.equal(l.cuenta.avatar_foco, "30% 20%");
  sqlite.prepare("UPDATE users SET avatar_url = NULL, avatar_foco = NULL WHERE id = ?").run(luis);
  const sin = porNombre((await pedir(admin, "admin")).cuerpo, "Luis Foto");
  assert.equal(sin.cuenta.avatar_url, null);
});

test("contenido subido pero TODO privado = sin publicar (y sin enlace)", async () => {
  const { cuerpo } = await pedir(admin, "admin");
  const s = porNombre(cuerpo, "Sin Cuenta");
  assert.equal(s.partido.id, pPrivado);
  assert.equal(s.galeria.estado, "sin_publicar");
  assert.equal(s.galeria.total, 1);
  assert.equal(s.galeria.publicas, 0);
  assert.equal(s.galeria.url, null);
  assert.equal(s.cuenta, null);
  assert.equal(s.galeria.mias, null); // sin cuenta no se pueden contar sus fotos
});

test("partido jugado sin nada = no subida; partido futuro = pendiente; sin partido identificable = sin_partido", async () => {
  const { cuerpo } = await pedir(admin, "admin");
  assert.equal(porNombre(cuerpo, "Paula Vacía").galeria.estado, "no_subida");
  assert.equal(porNombre(cuerpo, "Futuro Fran").galeria.estado, "pendiente");
  const perdida = porNombre(cuerpo, "Perdida Pilar");
  assert.equal(perdida.galeria.estado, "sin_partido");
  assert.equal(perdida.partido, null);
});

test("el resumen cuadra y no se filtran datos sensibles (DNI)", async () => {
  const { cuerpo } = await pedir(admin, "admin");
  assert.deepEqual(cuerpo.resumen, { total: 5, publicada: 1, sin_publicar: 1, no_subida: 1, pendiente: 1, sin_partido: 1 });
  assert.ok(!JSON.stringify(cuerpo).includes("12345678Z"));
});

test("es de solo lectura: no toca acreditaciones ni galerías", async () => {
  const antes = JSON.stringify([sqlite.prepare("SELECT * FROM acreditaciones").all(), sqlite.prepare("SELECT * FROM match_gallery").all()]);
  await pedir(admin, "admin");
  const despues = JSON.stringify([sqlite.prepare("SELECT * FROM acreditaciones").all(), sqlite.prepare("SELECT * FROM match_gallery").all()]);
  assert.equal(antes, despues);
});

// ---------- Fase 2: estado del recordatorio automático de galería ----------
// La tabla recordatorios_galeria solo existe donde corre el recordatorio (Worker principal). Si no existe,
// el campo es null y el panel no enseña nada; si existe, distingue «tramitado» (con fecha) de «aún no».
test("recordatorio: sin tabla de recordatorios el campo es null (no rompe nada)", async () => {
  sqlite.exec("DROP TABLE IF EXISTS recordatorios_galeria");
  const { status, cuerpo } = await pedir(admin, "admin");
  assert.equal(status, 200);
  for (const f of cuerpo.fotografos) assert.equal(f.recordatorio, null);
});

test("recordatorio: con tabla distingue tramitado (con fecha) de aún no, y null si no hay partido", async () => {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS recordatorios_galeria (
    acreditacion_id INTEGER NOT NULL, result_id INTEGER NOT NULL, email TEXT,
    enviado_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (acreditacion_id, result_id))`);
  const { cuerpo: previo } = await pedir(admin, "admin");
  const paula = porNombre(previo, "Paula Vacía");
  sqlite.prepare("INSERT INTO recordatorios_galeria (acreditacion_id, result_id, email, enviado_at) VALUES (?, ?, ?, ?)")
    .run(paula.id, paula.partido.id, paula.email, "2026-11-10 09:15:00");
  const { cuerpo } = await pedir(admin, "admin");
  assert.equal(porNombre(cuerpo, "Paula Vacía").recordatorio.enviado_at, "2026-11-10 09:15:00");
  assert.equal(porNombre(cuerpo, "Sin Cuenta").recordatorio.enviado_at, null);
  assert.equal(porNombre(cuerpo, "Perdida Pilar").recordatorio, null);
});

test("recordatorio: el campo nuevo sigue siendo de solo lectura y no filtra el DNI", async () => {
  const antes = JSON.stringify(sqlite.prepare("SELECT * FROM recordatorios_galeria").all());
  const { cuerpo } = await pedir(admin, "admin");
  assert.equal(antes, JSON.stringify(sqlite.prepare("SELECT * FROM recordatorios_galeria").all()));
  assert.ok(!JSON.stringify(cuerpo).includes("12345678Z"));
});

// ---------- Recordatorio manual (POST /api/responsabilidades/fotografia/recordar) ----------
const esSecundario = !!process.env.WORKER_ENTRY && /secondary/.test(process.env.WORKER_ENTRY);
const recordar = async (uid, rol, cuerpo) => {
  const res = await worker.fetch(new Request("https://api.test/api/responsabilidades/fotografia/recordar", {
    method: "POST",
    headers: { Authorization: `Bearer ${await jwt({ uid, rol, nombre: "x", tfa: true })}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  }), env, ctx);
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
};
const idDe = async (nombre) => porNombre((await pedir(admin, "admin")).cuerpo, nombre).id;

test("recordatorio manual: solo un Responsable puede enviarlo", async () => {
  assert.equal((await recordar(luis, "fotografo", { ids: [1] })).status, 403);
  assert.equal((await recordar(redactor, "redactor", { ids: [1] })).status, 403);
});

test("recordatorio manual: el Worker secundario no envía nada (503) y el principal pide un id válido", async () => {
  if (esSecundario) {
    assert.equal((await recordar(admin, "admin", { ids: [1] })).status, 503);
  } else {
    assert.equal((await recordar(admin, "admin", {})).status, 400);
    assert.equal((await recordar(admin, "admin", { ids: ["x", -2, 0] })).status, 400);
  }
});

test("recordatorio manual: no avisa a quien ya tiene galería publicada, partido por jugar o sin partido", { skip: esSecundario }, async () => {
  const ids = [await idDe("Luis Foto"), await idDe("Futuro Fran"), await idDe("Perdida Pilar"), 987654];
  const { status, cuerpo } = await recordar(admin, "admin", { ids });
  assert.equal(status, 200);
  assert.equal(cuerpo.enviados, 0);
  const estados = Object.fromEntries(cuerpo.resultados.map((r) => [r.id, r.estado]));
  assert.equal(estados[ids[0]], "ya_publicada");
  assert.equal(estados[ids[1]], "pendiente");
  assert.equal(estados[ids[2]], "sin_partido");
  assert.equal(estados[987654], "no_encontrada");
});

test("recordatorio manual: a quien no ha publicado se le intenta avisar y no se duplica (antirrebote de 12 h)", { skip: esSecundario }, async () => {
  const id = await idDe("Paula Vacía");
  const leer = () => sqlite.prepare("SELECT enviado_at FROM recordatorios_galeria WHERE acreditacion_id = ?").get(id);
  const antes = leer(); // otro test ya dejó un aviso antiguo (10-nov): no cuenta como reciente
  const r1 = (await recordar(admin, "admin", { id })).cuerpo.resultados[0];
  assert.ok(["enviado", "fallo"].includes(r1.estado), `estado inesperado: ${r1.estado}`);
  if (r1.estado === "enviado") {
    assert.notEqual(leer().enviado_at, antes && antes.enviado_at, "se anota el aviso con la fecha de ahora");
    assert.equal((await recordar(admin, "admin", { id })).cuerpo.resultados[0].estado, "reciente");
  } else {
    // Sin clave de correo (entorno de pruebas) el envío falla: no se anota como enviado.
    assert.deepEqual(leer(), antes, "si el correo falla no se toca el registro");
  }
});
