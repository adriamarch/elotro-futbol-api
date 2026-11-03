// Reconocimiento público del mes ("Redactor/a del mes" y "Foto del mes"): candidatos calculados contra el
// esquema real (SQLite), lectura/hidratación de lo confirmado y paridad entre worker y worker-secondary.
// Requiere Node 22+ (usa node:sqlite).  Ejecutar:  node worker/tests/reconocimiento-mes.test.mjs
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };
const leer = (p) => fs.readFileSync(root + p, "utf8");
const bloque = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("no encuentro " + a); return s.slice(i, j); };

const M_REC_INI = "// ---------- Reconocimiento público del mes";
const M_REC_FIN = "// ---------- Niveles de fotografía (F1–F2) ----------";
const M_RUT_INI = "// ---------- RECONOCIMIENTO PÚBLICO DEL MES (ver reconocimientoCandidatos) ----------";
const M_RUT_FIN = "// ---------- SETTINGS (redes sociales y otros ajustes del medio) ----------";
const M_RES_INI = "// ---------- Resumen mensual de colaboradores ----------";
const M_RES_FIN = "// ---------- Reconocimiento público del mes";

const prim = leer("worker/src/index.js"), sec = leer("worker-secondary/src/index.js");
t("worker y worker-secondary llevan el mismo código de reconocimiento (helpers)", bloque(prim, M_REC_INI, M_REC_FIN) === bloque(sec, M_REC_INI, M_REC_FIN));
t("worker y worker-secondary llevan las mismas rutas de reconocimiento", bloque(prim, M_RUT_INI, M_RUT_FIN) === bloque(sec, M_RUT_INI, M_RUT_FIN));

const rutas = bloque(prim, M_RUT_INI, M_RUT_FIN);
t("la gestión exige sesión y rol admin (GET y PUT)", (rutas.match(/payload\.rol !== "admin"/g) || []).length === 2);
t("el GET público no pide sesión", !/path === "\/api\/reconocimientos" && method === "GET"\) \{\s*const payload = await requireAuth/.test(rutas));
t("no se puede reconocer un mes aún sin cerrar", /mes > estado\.ultimo_mes_disponible/.test(rutas));

const ayudas = bloque(prim, "function esErrorColumnaFaltante", "// ---------- Notificaciones por correo ----------");
globalThis.ENVIADOS = []; globalThis.ENVIO_OK = true;
const stubs = `const SITIO_URL = "https://x"; const EMAIL_NOTIFICACIONES = "n@x";
function emailLectorEntregable(e) { return /^[^@\\s]+@[^@\\s]+$/.test(String(e || "")); }
function escapeHtmlEmail(t) { return String(t); }
function plantillaEmail(x) { return "HTML:" + x.titulo; }
async function enviarEmailNotificacion(env, m, o) { if (!globalThis.ENVIO_OK) return false; globalThis.ENVIADOS.push({ ...m, para: o.destinatario }); return true; }\n`;
const L = new Function(
  stubs + ayudas + "\n" + bloque(prim, M_RES_INI, M_RES_FIN) + "\n" + bloque(prim, M_REC_INI, M_REC_FIN) +
  "\nreturn { reconocimientoAsegurarAuto, reconocimientoAutoGenerar, reconocimientoCandidatos, reconocimientoLeer, reconocimientoHidratar, reconocimientoClave, reconocimientoAvisar, enviarCorreoReconocimientoMes };"
)();

const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=OFF");
db.exec(leer("worker/schema.sql"));
const env = { DB: { prepare(sql) { const st = db.prepare(sql); return { _b: [], bind(...a) { this._b = a; return this; },
  async all() { return { results: st.all(...this._b) }; }, async first() { return st.get(...this._b) || null; }, async run() { return st.run(...this._b); } }; } } };
const U = (id, nombre, rol, activo = 1) => db.prepare("INSERT INTO users (id,username,password_hash,salt,nombre,rol,activo) VALUES (?,?,?,?,?,?,?)").run(id, "u" + id, "x", "y", nombre, rol, activo);
U(1, "Admin", "admin"); U(7, "Ana", "redactor"); U(8, "Beto", "redactor"); U(9, "Carla", "redactor"); U(10, "Baja", "redactor", 0); U(11, "Fran", "fotografo");
const art = (slug, fecha, autor, co = null, pub = 1) => db.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,coautor_id,publicado,fecha_publicacion) VALUES (?,?,?,?,?,?,?,?)").run(slug, slug, "c", "noticia", autor, co, pub, fecha);
art("a1", "2026-10-05 10:00:00", 7); art("a2", "2026-10-06 10:00:00", 7); art("a3", "2026-10-07 10:00:00", 7);
art("b1", "2026-10-08 10:00:00", 8); art("b2", "2026-10-09 10:00:00", 8, 9);           // Carla: 1 como coautora
art("adm", "2026-10-10 10:00:00", 1);                                                  // admin: no cuenta como redactor
art("baja", "2026-10-11 10:00:00", 10);                                                // inactivo: no cuenta
art("borr", "2026-10-12 10:00:00", 9, null, 0);                                        // borrador: no cuenta
art("sep", "2026-09-30 21:59:00", 9);                                                  // 30-sep 23:59 Madrid: fuera
art("nov", "2026-10-31 23:30:00", 9);                                                  // 1-nov 00:30 Madrid: fuera
const v = db.prepare("INSERT INTO article_views (article_id,visitante_hash,created_at) VALUES (?,?,?)");
for (let i = 0; i < 3; i++) v.run(1, "h" + i, "2026-10-06 10:00:00");                   // a1: 3 visitas en octubre
for (let i = 0; i < 9; i++) v.run(4, "k" + i, "2026-10-12 10:00:00");                   // b1: 9 visitas
v.run(4, "fuera", "2026-11-03 10:00:00");                                              // fuera del mes

const c = await L.reconocimientoCandidatos(env, "2026-10");
const ids = (x) => x.redactores.map((r) => r.id).join();
t("solo redactores activos con publicaciones ese mes (ni admin, ni baja, ni sin publicar)", [...c.redactores.map((r) => r.id)].sort().join() === "7,8,9", ids(c));
const por = (x, id) => x.redactores.find((r) => r.id === id);
t("cifras por persona: publicaciones (Ana 3, Beto 2, Carla 1)", por(c, 7).publicaciones === 3 && por(c, 8).publicaciones === 2 && por(c, 9).publicaciones === 1);
t("visitas del mes por persona (Ana 3, Beto 9; la visita de noviembre no cuenta)", por(c, 7).visitas === 3 && por(c, 8).visitas === 9, JSON.stringify(c.redactores));
t("la coautoría cuenta para la coautora y su visita también", por(c, 9).publicaciones === 1 && por(c, 9).visitas === 0);

// --- Porcentajes y "quién es el mejor" (60 % publicaciones + 40 % visitas, sobre el total del equipo) ---
t("orden por puntuación: Beto (50), Ana (40), Carla (10)", ids(c) === "8,7,9", ids(c));
t("equipo: 3 redactores, 6 publicaciones y 12 visitas en total", c.equipo.redactores === 3 && c.equipo.publicaciones === 6 && c.equipo.visitas === 12, JSON.stringify(c.equipo));
t("% de publicaciones del equipo (Ana 50, Beto 33,3, Carla 16,7)", por(c, 7).pct_publicaciones === 50 && por(c, 8).pct_publicaciones === 33.3 && por(c, 9).pct_publicaciones === 16.7);
t("% de visitas del equipo (Ana 25, Beto 75, Carla 0)", por(c, 7).pct_visitas === 25 && por(c, 8).pct_visitas === 75 && por(c, 9).pct_visitas === 0);
t("puntuación global (Beto 50, Ana 40, Carla 10) y las puntuaciones suman 100", por(c, 8).puntuacion === 50 && por(c, 7).puntuacion === 40 && por(c, 9).puntuacion === 10 && c.redactores.reduce((s, r) => s + r.puntuacion, 0) === 100);
t("solo el primero es \"el mejor\" y lleva posición 1", c.redactores.filter((r) => r.es_mejor).map((r) => r.id).join() === "8" && c.redactores.map((r) => r.posicion).join() === "1,2,3");
t("% respecto al mejor (Beto 100, Ana 80, Carla 20)", por(c, 8).pct_del_mejor === 100 && por(c, 7).pct_del_mejor === 80 && por(c, 9).pct_del_mejor === 20);
t("sin empate en cabeza", c.redactores.every((r) => r.empate_en_cabeza === false));
const c1 = await L.reconocimientoCandidatos(env, "2026-10", 1);
t("el límite de candidatos se respeta (y las cuotas siguen siendo del total del equipo)", c1.redactores.length === 1 && c1.redactores[0].id === 8 && c1.redactores[0].pct_publicaciones === 33.3 && c1.equipo.redactores === 3, JSON.stringify(c1.redactores));
const cs = await L.reconocimientoCandidatos(env, "2026-10", 1000, { fotos: false });
t("con { fotos: false } no se consultan las fotos pero los redactores salen igual", cs.fotos.length === 0 && ids(cs) === "8,7,9");

// Empate en cabeza: dos personas con exactamente lo mismo
{
  const dbE = new DatabaseSync(":memory:"); dbE.exec("PRAGMA foreign_keys=OFF"); dbE.exec(leer("worker/schema.sql"));
  const envE = { DB: { prepare(sql) { const st = dbE.prepare(sql); return { _b: [], bind(...a) { this._b = a; return this; },
    async all() { return { results: st.all(...this._b) }; }, async first() { return st.get(...this._b) || null; }, async run() { return st.run(...this._b); } }; } } };
  const UE = (id, n) => dbE.prepare("INSERT INTO users (id,username,password_hash,salt,nombre,rol) VALUES (?,?,?,?,?,'redactor')").run(id, "u" + id, "x", "y", n);
  UE(1, "Zoe"); UE(2, "Álex"); UE(3, "Mía");
  const aE = (slug, autor) => dbE.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,publicado,fecha_publicacion) VALUES (?,?,?,?,?,1,'2026-10-10 10:00:00')").run(slug, slug, "c", "noticia", autor);
  aE("z1", 1); aE("a1", 2); aE("m1", 3); aE("m2", 3);
  const ce = await L.reconocimientoCandidatos(envE, "2026-10");
  t("sin ninguna visita registrada todo el peso va a las publicaciones (Mía 50 %, Zoe y Álex 25 %)", ce.equipo.visitas === 0 && ce.equipo.peso_publicaciones === 1 && por(ce, 3).puntuacion === 50 && por(ce, 1).puntuacion === 25 && ce.redactores.every((r) => r.pct_visitas === 0));
  t("sin empate: Mía es la mejor", ce.redactores[0].id === 3 && ce.redactores[0].es_mejor && !ce.redactores[0].empate_en_cabeza);
  aE("z2", 1); // Zoe 2 y Mía 2: empate exacto
  const ce2 = await L.reconocimientoCandidatos(envE, "2026-10");
  t("empate exacto: las dos aparecen con empate_en_cabeza y desempata el orden alfabético (Mía antes que Zoe)", ce2.redactores[0].empate_en_cabeza && ce2.redactores[1].empate_en_cabeza && !ce2.redactores[2].empate_en_cabeza && ce2.redactores.map((r) => r.id).join() === "3,1,2", JSON.stringify(ce2.redactores.map((r) => [r.id, r.puntuacion, r.empate_en_cabeza])));
  const vacio = await L.reconocimientoCandidatos(envE, "2025-01");
  t("un mes sin publicaciones no rompe nada (sin divisiones por cero)", vacio.redactores.length === 0 && vacio.equipo.publicaciones === 0);
}

// Fotos
db.exec(`INSERT INTO media (id,cloudinary_public_id,cloudinary_resource_type,cloudinary_url,titulo,tipo,nombre_archivo,content_type,tamano_bytes,autor_id,autor_nombre,visibilidad) VALUES
 (1,'f1','image','https://x/f1.jpg','Gol','foto','a.jpg','image/jpeg',10,11,'Fran','publico'),
 (2,'f2','image','https://x/f2.jpg','Privada','foto','b.jpg','image/jpeg',10,11,'Fran','privado'),
 (3,'f3','video','https://x/f3.mp4','Vídeo','video','c.mp4','video/mp4',10,11,'Fran','publico'),
 (4,'f4','image','https://x/f4.jpg','De septiembre','foto','d.jpg','image/jpeg',10,11,'Fran','publico')`);
const mg = (id, media, fecha) => db.prepare("INSERT INTO match_gallery (result_id,media_id,vinculado_por_id,created_at) VALUES (?,?,11,?)").run(id, media, fecha);
mg(1, 1, "2026-10-10 10:00:00"); mg(1, 2, "2026-10-10 10:01:00"); mg(1, 3, "2026-10-10 10:02:00"); mg(1, 4, "2026-09-20 10:00:00");
const cf = await L.reconocimientoCandidatos(env, "2026-10");
t("fotos candidatas: solo públicas, de tipo foto y vinculadas en el mes", cf.fotos.length === 1 && cf.fotos[0].media_id === 1 && cf.fotos[0].autor_nombre === "Fran", JSON.stringify(cf.fotos));

// Guardado / lectura / hidratación
const guardar = (mes, valor) => db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(L.reconocimientoClave(mes), JSON.stringify(valor));
t("sin nada guardado: lectura nula", (await L.reconocimientoLeer(env, "2026-10")) === null);
guardar("2026-10", { redactor: { id: 7, publicaciones: 3, visitas: 3 }, foto: { media_id: 1 }, confirmado_por: 1, confirmado_at: "2026-11-01T08:00:00Z" });
const g = await L.reconocimientoLeer(env, "2026-10");
t("lectura normaliza lo guardado", g.redactor.id === 7 && g.foto.media_id === 1 && g.confirmado_por === 1);
const h = await L.reconocimientoHidratar(env, g);
t("hidratación: redactor con nombre y cifras de cuando se confirmó", h.redactor.nombre === "Ana" && h.redactor.publicaciones === 3 && h.redactor.visitas === 3);
t("hidratación: foto con url, título y autor", h.foto.url === "https://x/f1.jpg" && h.foto.titulo === "Gol" && h.foto.autor_nombre === "Fran");
t("la hidratación no expone usuario, correo ni rol", !("username" in h.redactor) && !("email" in h.redactor) && !("rol" in h.redactor));
db.exec("UPDATE users SET activo = 0 WHERE id = 7"); db.exec("UPDATE media SET visibilidad = 'privado' WHERE id = 1");
const h2 = await L.reconocimientoHidratar(env, g);
t("si la persona se da de baja o la foto pasa a privada, deja de salir", h2.redactor === null && h2.foto === null);
t("hidratar sin datos devuelve vacío", (await L.reconocimientoHidratar(env, null)).redactor === null);
db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(L.reconocimientoClave("2026-09"), "{no es json");
t("un valor corrupto en settings no rompe la lectura", (await L.reconocimientoLeer(env, "2026-09")) === null);

// --- Correo de enhorabuena ---
db.exec("UPDATE users SET activo = 1, email = 'ana@x.es' WHERE id = 7; UPDATE users SET email = 'fran@x.es' WHERE id = 11; UPDATE users SET email = NULL WHERE id = 8");
db.exec("UPDATE media SET visibilidad = 'publico' WHERE id = 1");
let hh = await L.reconocimientoHidratar(env, { redactor: { id: 7, publicaciones: 3, visitas: 3 }, foto: { media_id: 1 } });
let av = await L.reconocimientoAvisar(env, "2026-10", hh, []);
t("se avisa a la redactora y al autor de la foto (2 correos, a su dirección)", av.enviados === 2 && ENVIADOS.map((e) => e.para).sort().join() === "ana@x.es,fran@x.es", JSON.stringify(ENVIADOS.map((e) => e.para)));
t("el correo de la redactora habla de Redactor/a del mes y del mes", /Redactor\/a del mes de octubre de 2026/.test(ENVIADOS.find((e) => e.para === "ana@x.es").asunto));
t("el correo del fotógrafo habla de la Foto del mes y cita el título", /Foto del mes/.test(ENVIADOS.find((e) => e.para === "fran@x.es").asunto) && /Gol/.test(ENVIADOS.find((e) => e.para === "fran@x.es").texto));
t("quedan anotados como avisados (r:7, f:11)", av.avisados.includes("r:7") && av.avisados.includes("f:11"));
ENVIADOS.length = 0;
av = await L.reconocimientoAvisar(env, "2026-10", hh, av.avisados);
t("volver a guardar el mismo reconocimiento NO repite el correo", av.enviados === 0 && ENVIADOS.length === 0);
db.exec("UPDATE users SET email = 'ana@x.es' WHERE id = 8");
hh = await L.reconocimientoHidratar(env, { redactor: { id: 8, publicaciones: 2, visitas: 9 }, foto: null });
av = await L.reconocimientoAvisar(env, "2026-10", hh, ["r:7", "f:11"]);
t("si cambia la persona reconocida, solo se avisa a la nueva", av.enviados === 1 && ENVIADOS[0].para === "ana@x.es" && av.avisados.includes("r:8"));
ENVIADOS.length = 0;
db.exec("UPDATE users SET email = NULL WHERE id = 8");
av = await L.reconocimientoAvisar(env, "2026-10", hh, []);
t("sin correo entregable no se envía nada y no se marca como avisada", av.enviados === 0 && !av.avisados.includes("r:8"));
db.exec("UPDATE users SET email = 'beto@x.es' WHERE id = 8"); ENVIO_OK = false;
av = await L.reconocimientoAvisar(env, "2026-10", hh, []);
t("si el envío falla no se rompe y queda sin marcar (se reintentará al guardar de nuevo)", av.enviados === 0 && !av.avisados.includes("r:8"));
ENVIO_OK = true;
t("persona y foto de la misma cuenta: un solo correo con ambos motivos", await (async () => {
  ENVIADOS.length = 0; db.exec("UPDATE users SET email = 'ana@x.es' WHERE id = 7; UPDATE media SET autor_id = 7 WHERE id = 1");
  const h3 = await L.reconocimientoHidratar(env, { redactor: { id: 7, publicaciones: 3, visitas: 3 }, foto: { media_id: 1 } });
  const r = await L.reconocimientoAvisar(env, "2026-10", h3, []);
  return r.enviados === 1 && /Redactor\/a del mes y Foto del mes/.test(ENVIADOS[0].asunto);
})());
t("la ruta PUT avisa salvo avisar:false", /body\.avisar !== false/.test(rutas));
t("lectura conserva y sanea la lista de avisados", await (async () => {
  db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(L.reconocimientoClave("2026-08"), JSON.stringify({ redactor: { id: 7 }, avisados: ["r:7", "x", 5] }));
  return (await L.reconocimientoLeer(env, "2026-08")).avisados.join() === "r:7";
})());

// --- Selección automática del Redactor/a del mes ---
// Octubre 2026 (ya hay datos): el mejor es Beto (id 8, 50 puntos) y el sistema lo guarda solo.
db.prepare("DELETE FROM settings WHERE key = ?").run(L.reconocimientoClave("2026-10"));
const auto1 = await L.reconocimientoAsegurarAuto(env, "2026-10");
t("sin nada guardado, se elige solo al mejor redactor/a (Beto)", auto1 && auto1.redactor && auto1.redactor.id === 8 && auto1.auto === true, JSON.stringify(auto1));
t("lo automático no se atribuye a ningún admin ni avisa por correo", auto1.confirmado_por === null && auto1.avisados.length === 0 && auto1.foto === null);
t("queda guardado en settings (la segunda lectura ya no recalcula)", (await L.reconocimientoLeer(env, "2026-10")).redactor.id === 8);
// Lo confirmado a mano manda: no se pisa.
const reemplazar = (mes, valor) => db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(L.reconocimientoClave(mes), JSON.stringify(valor));
reemplazar("2026-10", { redactor: { id: 7, publicaciones: 3, visitas: 3 }, foto: null, confirmado_por: 1, confirmado_at: "2026-11-02T10:00:00Z", avisados: [] });
const manual = await L.reconocimientoAsegurarAuto(env, "2026-10");
t("una confirmación manual del admin nunca se pisa (sigue Ana)", manual.redactor.id === 7 && manual.auto === false);
// Un "quitar" explícito tampoco se recrea.
reemplazar("2026-10", { redactor: null, foto: null, suprimido: true, confirmado_por: 1, confirmado_at: "2026-11-02T10:00:00Z", avisados: [] });
const quitado = await L.reconocimientoAsegurarAuto(env, "2026-10");
t("un reconocimiento quitado a mano no se vuelve a elegir solo", quitado.suprimido === true && quitado.redactor === null);
// Mes sin publicaciones: no se guarda nada.
t("un mes sin publicaciones no genera nada", (await L.reconocimientoAsegurarAuto(env, "2026-03")) === null && (await L.reconocimientoLeer(env, "2026-03")) === null);
// Carrera entre dos lecturas a la vez: una sola fila, sin error.
db.prepare("DELETE FROM settings WHERE key = ?").run(L.reconocimientoClave("2026-10"));
const [ra, rb] = await Promise.all([L.reconocimientoAsegurarAuto(env, "2026-10"), L.reconocimientoAsegurarAuto(env, "2026-10")]);
t("dos peticiones a la vez dejan una sola fila y el mismo ganador", ra.redactor.id === 8 && rb.redactor.id === 8 && db.prepare("SELECT COUNT(*) n FROM settings WHERE key = ?").get(L.reconocimientoClave("2026-10")).n === 1);
// Cableado en las rutas.
t("el GET público asegura la selección automática del último mes cerrado", /reconocimientoAsegurarAuto\(env, estado\.ultimo_mes_disponible\)/.test(rutas));
t("la gestión también la asegura al abrir un mes", /reconocimientoAsegurarAuto\(env, mes\)/.test(rutas));
t("quitar deja una marca \"suprimido\" en vez de borrar (con la automática activa)", /suprimido: true/.test(rutas) && /RECONOCIMIENTO_AUTOMATICO/.test(rutas));

// --- Rendimiento en las rutas ---
t("el GET público usa caché corta y se invalida al guardar/quitar (y en ambos workers)", /memoCorta\(`reconocimientos:publico:/.test(rutas) && (rutas.match(/invalidarCacheCorta\("reconocimientos:"\)/g) || []).length === 2);
t("los candidatos de la gestión usan caché corta por mes", /memoCorta\(`reconocimientos:candidatos:\$\{mes\}`/.test(rutas));
t("el PUT valida a la persona sin cargar las fotos", /reconocimientoCandidatos\(env, mes, 1000, \{ fotos: false \}\)/.test(rutas));
t("el GET público ya no hace una consulta por mes (lee key y value de una vez)", /SELECT key, value FROM settings/.test(rutas) && /reconocimientoNormalizar\(f\.value\)/.test(rutas));

console.log(`\n${ok} OK, ${fail} FALLO`);
process.exit(fail ? 1 : 0);
