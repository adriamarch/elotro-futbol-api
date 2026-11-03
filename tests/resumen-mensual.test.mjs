// Resumen mensual de colaboradores: disponibilidad a final de mes (hora de Madrid), rangos del mes en UTC,
// cálculo del resumen contra el esquema real (SQLite) y paridad entre worker y worker-secondary.
// Requiere Node 22+ (usa node:sqlite).  Ejecutar:  node worker/tests/resumen-mensual.test.mjs
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };

const MARCA_INI = "// ---------- Resumen mensual de colaboradores ----------";
const MARCA_FIN = "// Construye el objeto de progreso completo de un usuario: nivel";
const MARCA_RUTAS = "// ---------- RESUMEN MENSUAL DE COLABORADORES (ver construirResumenMensual) ----------";
const MARCA_RUTAS_FIN = "// ---------- SETTINGS (redes sociales y otros ajustes del medio) ----------";
const leer = (p) => fs.readFileSync(root + p, "utf8");
const bloque = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("no encuentro " + a); return s.slice(i, j); };

const prim = leer("worker/src/index.js"), sec = leer("worker-secondary/src/index.js");
t("worker y worker-secondary llevan el mismo código de resumen (helpers)", bloque(prim, MARCA_INI, MARCA_FIN) === bloque(sec, MARCA_INI, MARCA_FIN));
t("worker y worker-secondary llevan las mismas rutas", bloque(prim, MARCA_RUTAS, MARCA_RUTAS_FIN) === bloque(sec, MARCA_RUTAS, MARCA_RUTAS_FIN));
const rutas = bloque(prim, MARCA_RUTAS, MARCA_RUTAS_FIN);
t("el resumen devuelve disponible:false (sin datos) antes del último día del mes", /estado\.hoy < disponibleDesde[\s\S]{0,200}disponible: false/.test(rutas));

const L = new Function(bloque(prim, MARCA_INI, MARCA_FIN) + "\nreturn { resumenMesEstado, resumenMesInicioUtc, resumenMesLista, resumenMesUltimoDia, resumenMesValido, construirResumenMensual, resumenMesLeerPrefs, resumenMesGuardarPrefs };")();

// --- disponibilidad ---
t("29-oct: octubre aún cerrado, último disponible = septiembre", (() => { const e = L.resumenMesEstado("2026-10-29"); return !e.mes_actual_disponible && e.ultimo_mes_disponible === "2026-09" && e.mes_actual_disponible_desde === "2026-10-31"; })());
t("31-oct: octubre ya disponible", (() => { const e = L.resumenMesEstado("2026-10-31"); return e.mes_actual_disponible && e.ultimo_mes_disponible === "2026-10"; })());
t("2-ene: diciembre es el último disponible (cambio de año)", L.resumenMesEstado("2027-01-02").ultimo_mes_disponible === "2026-12");
t("febrero bisiesto acaba el 29", L.resumenMesUltimoDia("2028-02") === "2028-02-29");
t("mes no válido se rechaza", !L.resumenMesValido("2026-13") && !L.resumenMesValido("26-10") && L.resumenMesValido("2026-10"));
t("lista de meses respeta el mes de alta", L.resumenMesLista("2026-10", "2026-08").join() === "2026-10,2026-09,2026-08");
t("lista de meses se limita a 12", L.resumenMesLista("2026-10", "").length === 12);

// --- límites del mes en UTC (Madrid) ---
t("1-oct 00:00 Madrid (CEST) = 30-sep 22:00 UTC", L.resumenMesInicioUtc("2026-10-01") === "2026-09-30 22:00:00");
t("1-nov 00:00 Madrid (CET) = 31-oct 23:00 UTC", L.resumenMesInicioUtc("2026-11-01") === "2026-10-31 23:00:00");
t("1-abr 00:00 Madrid (CEST) = 31-mar 22:00 UTC", L.resumenMesInicioUtc("2026-04-01") === "2026-03-31 22:00:00");

// --- cálculo contra el esquema real ---
const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=OFF");
db.exec(leer("worker/schema.sql"));
const env = { DB: { prepare(sql) { const st = db.prepare(sql); return { _b: [], bind(...a) { this._b = a; return this; },
  async all() { return { results: st.all(...this._b) }; }, async first() { return st.get(...this._b) || null; }, async run() { return st.run(...this._b); } }; } } };
db.exec("INSERT INTO users (id,username,password_hash,salt,nombre,rol) VALUES (7,'ana','x','y','Ana Pérez','redactor')");
const art = (slug, titulo, tipo, fecha, autor, co) => db.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,coautor_id,publicado,fecha_publicacion) VALUES (?,?,?,?,?,?,1,?)").run(slug, titulo, "c", tipo, autor, co, fecha);
art("a", "Noticia A", "noticia", "2026-10-05 10:00:00", 7, null);
art("b", "Crónica B", "cronica", "2026-10-31 21:30:00", 7, null);   // 31-oct 22:30 Madrid: dentro
art("c", "Fuera nov", "noticia", "2026-10-31 23:30:00", 7, null);   // 1-nov 00:30 Madrid: fuera
art("d", "Fuera sep", "noticia", "2026-09-30 21:59:00", 7, null);   // 30-sep 23:59 Madrid: fuera
art("e", "Coautoría", "opinion", "2026-10-15 09:00:00", 2, 7);
art("f", "Ajena", "noticia", "2026-10-10 09:00:00", 2, null);
db.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,publicado,fecha_publicacion) VALUES ('g','Borrador','c','noticia',7,0,'2026-10-12 09:00:00')").run();
const v = db.prepare("INSERT INTO article_views (article_id,visitante_hash,created_at) VALUES (?,?,?)");
for (let i = 0; i < 5; i++) v.run(1, "h" + i, "2026-10-06 10:00:00"); v.run(2, "x", "2026-10-20 10:00:00"); v.run(1, "z", "2026-11-02 10:00:00");
db.exec("INSERT INTO media (cloudinary_public_id,cloudinary_resource_type,cloudinary_url,titulo,tipo,nombre_archivo,content_type,tamano_bytes,autor_id,created_at) VALUES ('p1','image','u','t','foto','a.jpg','image/jpeg',1000,7,'2026-10-03 10:00:00'),('p2','video','u','t','video','b.mp4','video/mp4',5000,7,'2026-10-04 10:00:00'),('p3','image','u','t','foto','c.jpg','image/jpeg',700,8,'2026-10-04 10:00:00')");
db.exec("INSERT INTO activity_log (usuario_id,usuario_nombre,usuario_rol,accion,descripcion,created_at) VALUES (7,'Ana','redactor','login','x','2026-10-03 10:00:00'),(7,'Ana','redactor','crear_noticia','x','2026-10-03 11:00:00'),(7,'Ana','redactor','login','x','2026-10-09 11:00:00')");
const r = await L.construirResumenMensual(env, { id: 7, nombre: "Ana Pérez", rol: "redactor" }, "2026-10");
t("publicaciones del mes: 3 (autora + coautora, sin borradores ni otros meses/autores)", r.publicaciones.total === 3, JSON.stringify(r.publicaciones));
t("por tipo: 1 noticia, 1 crónica, 1 opinión", r.publicaciones.por_tipo.noticia === 1 && r.publicaciones.por_tipo.cronica === 1 && r.publicaciones.por_tipo.opinion === 1);
t("como coautora: 1", r.publicaciones.como_coautor === 1);
t("visitas del mes: 6 (no cuenta las de noviembre)", r.visitas.total === 6 && r.visitas.top[0].titulo === "Noticia A" && r.visitas.top[0].visitas === 5, JSON.stringify(r.visitas));
t("contenido: 1 foto, 1 vídeo, 6000 bytes (solo el suyo)", r.contenido.fotos === 1 && r.contenido.videos === 1 && r.contenido.bytes === 6000, JSON.stringify(r.contenido));
t("actividad: 3 acciones en 2 días", r.actividad.acciones === 3 && r.actividad.dias_activos === 2, JSON.stringify(r.actividad));
t("hay_actividad", r.hay_actividad === true);
const vacio = await L.construirResumenMensual(env, { id: 99, nombre: "Nadie", rol: "fotografo" }, "2026-10");
t("sin actividad -> hay_actividad false y ceros", vacio.hay_actividad === false && vacio.publicaciones.total === 0 && vacio.contenido.fotos === 0);

// --- preferencias (tabla settings) ---
t("prefs por defecto: aviso activado, nada visto", JSON.stringify(await L.resumenMesLeerPrefs(env, 7)) === '{"aviso":true,"visto":""}');
await L.resumenMesGuardarPrefs(env, 7, { aviso: false, visto: "2026-09" });
await L.resumenMesGuardarPrefs(env, 7, { aviso: false, visto: "2026-10" });
t("prefs guardadas (y se pueden sobrescribir)", JSON.stringify(await L.resumenMesLeerPrefs(env, 7)) === '{"aviso":false,"visto":"2026-10"}');
t("las prefs son por persona", (await L.resumenMesLeerPrefs(env, 8)).aviso === true);

console.log(`\n${ok} OK, ${fail} FALLO`);
process.exit(fail ? 1 : 0);
