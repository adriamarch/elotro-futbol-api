// Estadísticas personales de la cuenta: totales, evolución mensual, nivel, racha e insignias contra el
// esquema real (SQLite), y paridad entre worker y worker-secondary.
// Requiere Node 22+ (usa node:sqlite).  Ejecutar:  node worker/tests/estadisticas-cuenta.test.mjs
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };
const leer = (p) => fs.readFileSync(root + p, "utf8");
const bloque = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("no encuentro " + a); return s.slice(i, j); };

const MARCA_INI = "async function contarPublicacionesPorTipo(";
const MARCA_FIN = "// Construye el objeto de progreso completo de un usuario: nivel";
const MARCA_EST_INI = "// ---------- Estadísticas personales de la cuenta (con su evolución) ----------";
const MARCA_EST_FIN = "// ---------- Reconocimiento público del mes";
const MARCA_RUTA = "// ---------- ESTADÍSTICAS PERSONALES DE LA CUENTA (ver construirEstadisticasCuenta) ----------";
const MARCA_RUTA_FIN = "// ---------- RUTA DE BIENVENIDA (14 días): ver calcularRutaBienvenida ----------";
const MARCA_ADM = "// ---------- ESTADÍSTICAS DE UN COLABORADOR (solo Responsables) ----------";
const MARCA_ADM_FIN = "// ---------- EXCEPCIONALIDADES DE ACTIVIDAD (solo Responsables) ----------";

const prim = leer("worker/src/index.js"), sec = leer("worker-secondary/src/index.js");
t("worker y worker-secondary llevan el mismo cálculo", bloque(prim, MARCA_EST_INI, MARCA_EST_FIN) === bloque(sec, MARCA_EST_INI, MARCA_EST_FIN));
t("worker y worker-secondary llevan la misma ruta /api/me/estadisticas", bloque(prim, MARCA_RUTA, MARCA_RUTA_FIN) === bloque(sec, MARCA_RUTA, MARCA_RUTA_FIN));
t("worker y worker-secondary llevan la misma ruta de Responsables", bloque(prim, MARCA_ADM, MARCA_ADM_FIN) === bloque(sec, MARCA_ADM, MARCA_ADM_FIN));
const rutaAdmin = bloque(prim, MARCA_ADM, MARCA_ADM_FIN);
t("la ruta de otra cuenta exige Responsable (403)", /payload\.rol !== "admin"\) return json\(\{ error: "Solo un Responsable[^}]*\}, 403\)/.test(rutaAdmin));
t("la ruta propia usa SIEMPRE el id del token (no admite :id)", /\.bind\(payload\.uid\)/.test(bloque(prim, MARCA_RUTA, MARCA_RUTA_FIN)));

const L = new Function(bloque(prim, MARCA_INI, MARCA_FIN) + "\nreturn { construirEstadisticasCuenta, estadisticasListaMeses };")();

t("meses: 12 como máximo, el más antiguo primero", L.estadisticasListaMeses("2026-11", "").join() === "2025-12,2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11");
t("meses: no antes del mes de alta", L.estadisticasListaMeses("2026-11", "2026-09").join() === "2026-09,2026-10,2026-11");

const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=OFF");
db.exec(leer("worker/schema.sql"));
const env = { DB: { prepare(sql) { const st = db.prepare(sql); return { _b: [], bind(...a) { this._b = a; return this; },
  async all() { return { results: st.all(...this._b) }; }, async first() { return st.get(...this._b) || null; }, async run() { return st.run(...this._b); } }; } } };
db.exec("INSERT INTO users (id,username,password_hash,salt,nombre,rol,nivel,created_at) VALUES (7,'ana','x','y','Ana Pérez','redactor',3,'2026-08-15 10:00:00')");
const art = (slug, tipo, fecha, autor, co, pub = 1) => db.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,coautor_id,publicado,fecha_publicacion) VALUES (?,?,?,?,?,?,?,?)").run(slug, slug, "c", tipo, autor, co, pub, fecha);
art("a", "noticia", "2026-08-20 10:00:00", 7, null);
art("b", "cronica", "2026-10-05 10:00:00", 7, null);
art("c", "noticia", "2026-10-06 10:00:00", 7, null);
art("d", "opinion", "2026-10-15 09:00:00", 2, 7);   // coautoría
art("e", "noticia", "2026-10-10 09:00:00", 2, null); // ajena
art("f", "noticia", "2026-10-12 09:00:00", 7, null, 0); // borrador
const v = db.prepare("INSERT INTO article_views (article_id,visitante_hash,created_at) VALUES (?,?,?)");
for (let i = 0; i < 4; i++) v.run(1, "h" + i, "2026-08-21 10:00:00");
for (let i = 0; i < 3; i++) v.run(2, "k" + i, "2026-10-07 10:00:00");
v.run(4, "q", "2026-10-16 10:00:00");
v.run(5, "ajena", "2026-10-11 10:00:00");
db.exec("INSERT INTO media (cloudinary_public_id,cloudinary_resource_type,cloudinary_url,titulo,tipo,nombre_archivo,content_type,tamano_bytes,autor_id,created_at) VALUES ('p1','image','u','t','foto','a.jpg','image/jpeg',1000,7,'2026-10-03 10:00:00'),('p2','image','u','t','foto','b.jpg','image/jpeg',2000,7,'2026-09-03 10:00:00'),('v1','video','u','t','video','c.mp4','video/mp4',5000,7,'2026-10-04 10:00:00'),('p3','image','u','t','foto','d.jpg','image/jpeg',9999,2,'2026-10-03 10:00:00')");
db.exec("INSERT INTO activity_log (usuario_id,usuario_nombre,usuario_rol,accion,descripcion,created_at) VALUES (7,'Ana','redactor','login','x','2026-10-03 10:00:00'),(7,'Ana','redactor','crear_noticia','x','2026-10-03 11:00:00'),(7,'Ana','redactor','login','x','2026-10-09 10:00:00'),(2,'Otro','admin','login','x','2026-10-09 10:00:00')");
db.exec("INSERT INTO nivel_historial (usuario_id,usuario_nombre,nivel_anterior,nivel_nuevo,cambiado_por_nombre,created_at) VALUES (7,'Ana',1,2,'Resp','2026-09-01 10:00:00'),(7,'Ana',2,3,'Resp','2026-10-20 10:00:00')");
db.exec("INSERT INTO settings (key,value) VALUES ('insignias_hitos:7','{\"primera_cronica\":\"2026-10-05 12:00:00\"}')");

const usuario = { id: 7, nombre: "Ana Pérez", rol: "redactor", nivel: 3, created_at: "2026-08-15 10:00:00" };
const e = await L.construirEstadisticasCuenta(env, usuario);
t("meses desde el alta (ago–hoy), no más de 12", e.meses[0] === "2026-08" && e.meses.length <= 12 && e.meses.length >= 3, e.meses.join());
t("totales: 4 publicaciones (3 propias publicadas + 1 coautoría; sin borrador ni ajenas)", e.totales.publicaciones === 4, JSON.stringify(e.totales.por_tipo));
t("por tipo: 2 noticias, 1 crónica, 1 opinión", e.totales.por_tipo.noticia === 2 && e.totales.por_tipo.cronica === 1 && e.totales.por_tipo.opinion === 1);
t("visitas totales: 8 (solo de lo suyo)", e.totales.visitas === 8, String(e.totales.visitas));
t("visitas por publicación: 2", e.totales.visitas_por_publicacion === 2, String(e.totales.visitas_por_publicacion));
t("contenido: 2 fotos, 1 vídeo, 8000 bytes (solo el suyo)", e.totales.contenido.fotos === 2 && e.totales.contenido.videos === 1 && e.totales.contenido.bytes === 8000, JSON.stringify(e.totales.contenido));
t("actividad: 3 acciones en 2 días", e.totales.acciones === 3 && e.totales.dias_activos === 2, JSON.stringify([e.totales.acciones, e.totales.dias_activos]));
t("primera y última publicación", e.totales.primera_publicacion === "2026-08-20" && e.totales.ultima_publicacion === "2026-10-15", JSON.stringify([e.totales.primera_publicacion, e.totales.ultima_publicacion]));
const m = (mes) => e.evolucion.find((x) => x.mes === mes);
t("evolución ago: 1 publicación y 4 visitas", m("2026-08").publicaciones === 1 && m("2026-08").visitas === 4, JSON.stringify(m("2026-08")));
t("evolución sep: 1 foto, 0 publicaciones", m("2026-09").fotos === 1 && m("2026-09").publicaciones === 0);
t("evolución oct: 3 publicaciones, 4 visitas, 1 foto, 1 vídeo, 3 acciones en 2 días", m("2026-10").publicaciones === 3 && m("2026-10").visitas === 4 && m("2026-10").fotos === 1 && m("2026-10").videos === 1 && m("2026-10").acciones === 3 && m("2026-10").dias_activos === 2, JSON.stringify(m("2026-10")));
t("evolución oct por tipo: crónica 1, noticia 1, opinión 1", m("2026-10").por_tipo.cronica === 1 && m("2026-10").por_tipo.noticia === 1 && m("2026-10").por_tipo.opinion === 1);
t("mejor mes: octubre con 3", e.resumen_periodo.mejor_mes && e.resumen_periodo.mejor_mes.mes === "2026-10" && e.resumen_periodo.mejor_mes.publicaciones === 3, JSON.stringify(e.resumen_periodo));
t("cambios de nivel: 1→2 y 2→3", e.cambios_nivel.length === 2 && e.cambios_nivel[1].a === 3 && e.cambios_nivel[0].fecha === "2026-09-01", JSON.stringify(e.cambios_nivel));
t("racha presente para un redactor", e.racha && typeof e.racha.actual === "number" && Array.isArray(e.racha.semanas));
t("insignias: solo las guardadas cuentan como conseguidas (y no se escribe nada)", e.insignias.find((i) => i.id === "primera_cronica").conseguida === true && e.insignias.find((i) => i.id === "primer_directo").conseguida === false);
t("no toca la tabla de insignias", db.prepare("SELECT value FROM settings WHERE key='insignias_hitos:7'").get().value === '{"primera_cronica":"2026-10-05 12:00:00"}');

const vacio = await L.construirEstadisticasCuenta(env, { id: 99, nombre: "Nadie", rol: "fotografo", nivel: 1, created_at: "2026-11-01 10:00:00" });
t("cuenta sin actividad: ceros y sin errores", vacio.totales.publicaciones === 0 && vacio.totales.visitas === 0 && vacio.resumen_periodo.mejor_mes === null && vacio.totales.primera_publicacion === null);
t("cuenta sin fecha de alta: 12 meses y no rompe", (await L.construirEstadisticasCuenta(env, { id: 99, nombre: "X", rol: "redactor", nivel: 1 })).meses.length === 12);
const admin = await L.construirEstadisticasCuenta(env, { id: 2, nombre: "Resp", rol: "admin", nivel: 5, created_at: "2026-01-01 10:00:00" });
t("admin: sin racha ni insignias (no aplican)", admin.racha === null && admin.insignias === null);
t("no expone datos sensibles (sin email, contraseña ni sal)", !/password|salt|email/i.test(JSON.stringify(e)));

console.log(`\n${ok} OK, ${fail} FALLO`);
process.exit(fail ? 1 : 0);
