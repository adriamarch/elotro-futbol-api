// Resumen de INICIO del panel (GET /api/me/resumen-inicio): cálculo por rol contra el esquema real (SQLite)
// y paridad entre worker y worker-secondary.
// Requiere Node 22+ (usa node:sqlite).  Ejecutar:  node worker/tests/resumen-inicio.test.mjs
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };
const leer = (p) => fs.readFileSync(root + p, "utf8");
const bloque = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("no encuentro " + a); return s.slice(i, j); };

const M_INI = "// ---------- Resumen de INICIO del panel (GET /api/me/resumen-inicio) ----------";
const M_FIN = "// ---------- Resumen de estadísticas de TODAS las cuentas (tabla de Usuarios, solo Responsables) ----------";
const M_RUTA = "// ---------- RESUMEN DE INICIO DEL PANEL (ver construirResumenInicio) ----------";
const M_RUTA_FIN = "// ---------- RESUMEN DE ESTADÍSTICAS DE TODAS LAS CUENTAS";
const M_FECHAS_INI = "function resumenMesFechaMadrid(";
const M_FECHAS_FIN = "function resumenMesEstado(";

const prim = leer("worker/src/index.js"), sec = leer("worker-secondary/src/index.js");
t("worker y worker-secondary llevan el mismo cálculo", bloque(prim, M_INI, M_FIN) === bloque(sec, M_INI, M_FIN));
t("worker y worker-secondary llevan las mismas rutas", bloque(prim, M_RUTA, M_RUTA_FIN) === bloque(sec, M_RUTA, M_RUTA_FIN));
const ruta = bloque(prim, M_RUTA, M_RUTA_FIN);
t("el resumen usa SIEMPRE el id del token", /\.bind\(payload\.uid\)/.test(ruta.split("/api/inicio/anuncio")[0]));
t("el anuncio exige Responsable (403)", /payload\.rol !== "admin"\) return json\(\{ error: "Solo un Responsable[^}]*\}, 403\)/.test(ruta));

// Dependencias mínimas (en el worker real son más pesadas): nombres de club comparados sin tildes ni mayúsculas.
const L = new Function(
  "const NIVEL_MAXIMO = 4;" +
  "const parsearEquipos = (v) => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };" +
  "const mismoEquipoGaleria = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();" +
  "const construirProgresoNivel = async (env, u) => u.rol === 'fotografo' ? ({ nivel_actual: u.nivel, nivel_info: { nombre: 'Fotógrafo colaborador', emoji: '📷' }, nivel_maximo: false, siguiente_nivel: 2, siguiente_nivel_info: { nombre: 'Fotógrafo avanzado' }, progreso: null }) : ({ nivel_actual: u.nivel, nivel_info: { nombre: 'Aprendiz', emoji: '🔵' }, nivel_maximo: false, siguiente_nivel: u.nivel + 1, siguiente_nivel_info: { nombre: 'Maestro' }, progreso: { cumple_requisitos: false, detalle: [{ tipo: 'noticia', actual: 3, necesarios: 6, cumple: false }, { tipo: 'cronica', actual: 3, necesarios: 3, cumple: true }] } });" +
  bloque(prim, M_FECHAS_INI, M_FECHAS_FIN) + "\n" + bloque(prim, M_INI, M_FIN) +
  "\nreturn { construirResumenInicio, leerAnuncioInicio, resumenMesFechaMadrid, resumenMesAnterior };")();

const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=OFF");
db.exec(leer("worker/schema.sql"));
const env = { DB: { prepare(sql) { const st = db.prepare(sql); return { _b: [], bind(...a) { this._b = a; return this; },
  async all() { return { results: st.all(...this._b) }; }, async first() { return st.get(...this._b) || null; }, async run() { return st.run(...this._b); } }; } } };

const hoy = L.resumenMesFechaMadrid();
const mes = hoy.slice(0, 7);
const prev = L.resumenMesAnterior(mes);
const dia = (n) => new Date(Date.parse(`${hoy}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ahoraBD = new Date().toISOString().slice(0, 19).replace("T", " ");
const enMes = `${mes}-01 12:00:00`;      // siempre dentro del mes actual (hora de Madrid) salvo el día 1 antes de las 2:00
const usr = db.prepare("INSERT INTO users (id,username,password_hash,salt,nombre,rol,nivel,equipo,activo,created_at) VALUES (?,?,'x','y',?,?,?,?,?,?)");
usr.run(1, "admin", "Admin", "admin", 4, null, 1, "2025-01-01 10:00:00");
usr.run(7, "ana", "Ana Pérez", "redactor", 2, '["Real Oviedo"]', 1, "2026-01-01 10:00:00");
usr.run(8, "bea", "Bea Ruiz", "redactor", 4, '["Sporting"]', 1, "2026-01-01 10:00:00");
usr.run(9, "foto", "Fran Foto", "fotografo", 1, '["Real Oviedo"]', 1, "2026-01-01 10:00:00");
usr.run(10, "baja", "Baja Antigua", "redactor", 1, null, 0, "2026-01-01 10:00:00");
usr.run(11, "nuevo", "Nuevo Colab", "redactor", 1, null, 1, ahoraBD);
const art = db.prepare("INSERT INTO articles (slug,titulo,contenido,tipo,autor_id,autor_nombre,coautor_id,publicado,estado_borrador,programado_para,fecha_publicacion,updated_at) VALUES (?,?,'c','noticia',?,?,?,?,?,?,?,?)");
art.run("a1", "Noticia A1", 7, "Ana Pérez", null, 1, null, null, enMes, enMes);
art.run("a2", "Noticia A2", 7, "Ana Pérez", null, 1, null, null, enMes, enMes);
art.run("a3", "Noticia A3", 7, "Ana Pérez", null, 1, null, null, enMes, enMes);
art.run("b1", "Noticia B1", 8, "Bea Ruiz", 7, 1, null, null, enMes, enMes);          // coautoría con Ana
art.run("x1", "Antigua de Ana", 7, "Ana Pérez", null, 1, null, null, `${prev}-10 10:00:00`, `${prev}-10 10:00:00`);
art.run("x2", "De la baja", 10, "Baja Antigua", null, 1, null, null, enMes, enMes);   // redactor de baja: no entra al ranking
art.run("r1", "En revisión vieja", 7, "Ana Pérez", null, 0, "terminado", null, enMes, "2026-01-05 10:00:00");
art.run("r2", "En revisión nueva", 8, "Bea Ruiz", null, 0, "terminado", null, enMes, "2026-02-05 10:00:00");
art.run("p1", "Programada", 7, "Ana Pérez", null, 0, "terminado", "2099-01-01 10:00:00", enMes, enMes);   // programada: no es «en revisión»
art.run("e1", "En proceso", 7, "Ana Pérez", null, 0, "en_proceso", null, enMes, enMes);
const v = db.prepare("INSERT INTO article_views (article_id,visitante_hash,created_at) VALUES (?,?,?)");
for (let i = 0; i < 5; i++) v.run(1, "h" + i, enMes);
for (let i = 0; i < 2; i++) v.run(2, "k" + i, `${prev}-11 10:00:00`);
const acr = db.prepare("INSERT INTO acreditaciones (nombre,email,dni,equipo,tipo_evento,tipo_acreditacion,funciones,jornada_partido,estado,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
acr.run("P1", "a@x.es", "1", "Real Oviedo", "liga", "prensa", "f", "J1", "pendiente", "2026-03-01 10:00:00");
acr.run("P2", "b@x.es", "2", "Sporting", "liga", "prensa", "f", "J2", "pendiente", "2026-04-01 10:00:00");
acr.run("P3", "c@x.es", "3", "Sporting", "liga", "prensa", "f", "J3", "aprobada", "2026-02-01 10:00:00");
db.exec("INSERT INTO edit_requests (tipo_entidad,entidad_id,solicitante_id,autor_id,estado) VALUES ('articulo',1,8,7,'pendiente'),('articulo',2,7,8,'pendiente')");
db.exec(`INSERT INTO activity_log (usuario_id,usuario_nombre,usuario_rol,accion,descripcion,created_at) VALUES (7,'Ana','redactor','login','x','${ahoraBD}'),(7,'Ana Pérez','redactor','crear','x','${ahoraBD}'),(8,'Bea','redactor','login','x','${ahoraBD}'),(9,'Fran','fotografo','login','x','2020-01-01 10:00:00')`);
const res = db.prepare("INSERT INTO results (id,competicion,jornada,equipo_local,equipo_visitante,fecha_partido,estado,autor_id,finalizado_no_cubierto) VALUES (?,?,?,?,?,?,?,?,?)");
res.run(1, "hypermotion", 12, "Real Oviedo", "Levante", `${dia(3)}T18:30`, "programado", null, 0);      // programado sin nadie
res.run(2, "hypermotion", 11, "Real Oviedo", "Eibar", `${dia(0)}T12:00`, "en_juego", null, 0);           // en juego sin responsable
res.run(3, "hypermotion", 10, "Racing", "Real Oviedo", `${dia(-3)}T12:00`, "finalizado", 7, 1);          // cerrado sin confirmar
res.run(4, "hypermotion", 12, "Sporting", "Albacete", `${dia(2)}T18:30`, "programado", null, 0);         // de otro club
res.run(5, "hypermotion", 9, "Real Oviedo", "Burgos", `${dia(-6)}T18:30`, "finalizado", 7, 0);           // sin fotos
res.run(6, "hypermotion", 8, "Real Oviedo", "Mirandés", `${dia(-9)}T18:30`, "finalizado", 7, 0);         // con fotos de Fran
res.run(7, "hypermotion", 8, "Sporting", "Tenerife", `${dia(-9)}T20:30`, "finalizado", 7, 0);            // sin fotos, de otro club
res.run(8, "hypermotion", 1, "Real Oviedo", "Lugo", `${dia(-90)}T20:30`, "finalizado", 7, 0);            // demasiado antiguo
res.run(9, "hypermotion", 7, "Real Oviedo", "Ibiza", `${dia(-12)}T20:30`, "finalizado", 7, 0);           // con fotos de otra persona
db.exec("INSERT INTO media (id,cloudinary_public_id,cloudinary_resource_type,cloudinary_url,titulo,tipo,nombre_archivo,content_type,tamano_bytes,autor_id) VALUES (1,'p1','image','u','t','foto','a.jpg','image/jpeg',10,9),(2,'p2','image','u','t','foto','b.jpg','image/jpeg',10,9),(3,'p3','image','u','t','foto','c.jpg','image/jpeg',10,1)");
db.exec("INSERT INTO match_gallery (result_id,media_id,vinculado_por_id) VALUES (6,1,9),(6,2,9),(9,3,1)");
for (let i = 0; i < 4; i++) db.prepare("INSERT INTO result_views (result_id,visitante_hash) VALUES (6,?)").run("v" + i);
db.exec("INSERT INTO result_views (result_id,visitante_hash) VALUES (9,'z')");

const u = (id) => db.prepare("SELECT id,nombre,rol,nivel,nivel_nota,equipo,created_at FROM users WHERE id=?").get(id);

// ----- Responsable -----
const A = await L.construirResumenInicio(env, u(1));
t("admin: el mes cuenta las publicadas de todo el equipo (5) y las del mes anterior (1)", A.equipo.mes.publicaciones === 5 && A.equipo.mes.publicaciones_previo === 1, JSON.stringify(A.equipo.mes));
t("admin: visitas del mes (5) y del anterior (2)", A.equipo.mes.visitas === 5 && A.equipo.mes.visitas_previo === 2);
t("admin: evolución de 6 meses, el último es el actual", A.equipo.evolucion.length === 6 && A.equipo.evolucion[5].mes === mes);
t("admin: activos en 30 días = 2 (cada persona una vez, aunque cambie de nombre)", A.equipo.activos_30d === 2, String(A.equipo.activos_30d));
t("admin: 5 colaboradores activos (sin la baja)", A.equipo.colaboradores_activos_total === 5, String(A.equipo.colaboradores_activos_total));
t("admin: un colaborador nuevo este mes", A.equipo.nuevos_mes === 1 && A.equipo.nuevos[0].nombre === "Nuevo Colab", JSON.stringify(A.equipo.nuevos));
t("admin: cola de revisión = 2 (sin programadas ni borradores en proceso), la más antigua primero", A.revision.total === 2 && A.revision.items[0].titulo === "En revisión vieja" && A.revision.mas_antigua.startsWith("2026-01-05"), JSON.stringify(A.revision));
t("admin: 2 acreditaciones pendientes y la más antigua es de marzo", A.acreditaciones.pendientes === 2 && A.acreditaciones.mas_antigua.startsWith("2026-03-01"));
t("admin: ve todas las solicitudes de edición pendientes que no ha hecho él (2)", A.solicitudes.ediciones === 2, JSON.stringify(A.solicitudes));
t("admin: no lleva bloques de redactor ni de fotógrafo", A.sin_cubrir === null && A.progreso_nivel === null && A.partidos_sin_fotos === null && A.fotos_top === null);
t("admin: ranking sin Responsables, bajas ni fotógrafos (Ana y Bea)", A.ranking.participantes === 2 && A.ranking.top.map((x) => x.nombre).join() === "Ana Pérez,Bea Ruiz", JSON.stringify(A.ranking));

// ----- Redactora de Nivel 2 -----
const R = await L.construirResumenInicio(env, u(7));
t("redactora: no ve la cola de revisión ni las acreditaciones", R.revision === null && R.acreditaciones === null && R.equipo === null && R.revisa === false);
t("redactora: ranking del mes, 1.ª con 4 (3 propias + 1 coautoría)", R.ranking.yo.pos === 1 && R.ranking.yo.publicaciones === 4 && R.ranking.top[0].yo === true, JSON.stringify(R.ranking));
t("redactora: solo las solicitudes dirigidas a ella (1)", R.solicitudes.ediciones === 1, JSON.stringify(R.solicitudes));
t("redactora: 3 partidos sin cubrir de su club, en vivo primero", R.sin_cubrir.total === 3 && R.sin_cubrir.items[0].motivo === "en_juego_sin_responsable" && R.sin_cubrir.items[1].motivo === "cerrado_sin_confirmar" && R.sin_cubrir.items[2].motivo === "programado_sin_cubrir", JSON.stringify(R.sin_cubrir.items.map((x) => x.motivo)));
t("redactora: no sale el partido de otro club", !R.sin_cubrir.items.some((x) => x.id === 4));
t("redactora: progreso hacia Maestro con 75 %", R.progreso_nivel.siguiente_nombre === "Maestro" && R.progreso_nivel.pct === 75, JSON.stringify(R.progreso_nivel));

// ----- Redactor de Nivel 4: ve la cola como un Responsable -----
const B = await L.construirResumenInicio(env, u(8));
t("redactor N4: ve cola de revisión y acreditaciones", B.revisa === true && B.revision.total === 2 && B.acreditaciones.pendientes === 2);
t("redactor N4: sus solicitudes pendientes son las de su autoría (1)", B.solicitudes.ediciones === 1);
t("redactor N4: sin partidos del Oviedo (su club es el Sporting): solo el programado del Sporting", B.sin_cubrir.items.length === 1 && B.sin_cubrir.items[0].id === 4);

// ----- Fotógrafo -----
const F = await L.construirResumenInicio(env, u(9));
t("fotógrafo: sin ranking, cola ni sin_cubrir", F.ranking === null && F.revision === null && F.sin_cubrir === null && F.solicitudes === null);
t("fotógrafo: faltan fotos en 2 partidos de su club (3 y 5, el más reciente primero); no el antiguo, el de otro club ni el que ya tiene galería", F.partidos_sin_fotos.total === 2 && F.partidos_sin_fotos.items.map((x) => x.id).join() === "3,5", JSON.stringify(F.partidos_sin_fotos));
t("fotógrafo: sus fotos más vistas = partido 6 con 2 fotos y 4 visitas (no el 9, que es de otra persona)", F.fotos_top.length === 1 && F.fotos_top[0].id === 6 && F.fotos_top[0].fotos === 2 && F.fotos_top[0].visitas === 4, JSON.stringify(F.fotos_top));
t("fotógrafo: progreso de nivel sin porcentaje (en fotografía no hay requisitos de publicaciones)", F.progreso_nivel && F.progreso_nivel.nivel === 1 && F.progreso_nivel.pct === null && F.progreso_nivel.requisitos.length === 0, JSON.stringify(F.progreso_nivel));

// ----- Fotógrafo sin club: ve los de toda la redacción -----
db.exec("UPDATE users SET equipo = NULL WHERE id = 9");
const F2 = await L.construirResumenInicio(env, u(9));
t("fotógrafo sin club: ve los sin fotos de toda la redacción (partidos 3, 5 y 7)", F2.partidos_sin_fotos.solo_club === false && F2.partidos_sin_fotos.items.map((x) => x.id).sort().join() === "3,5,7", JSON.stringify(F2.partidos_sin_fotos.items.map((x) => x.id)));

// ----- Redactor sin club -----
db.exec("UPDATE users SET equipo = NULL WHERE id = 7");
const R2 = await L.construirResumenInicio(env, u(7));
t("redactora sin club: sin_cubrir vacío pero presente", R2.sin_cubrir && R2.sin_cubrir.total === 0 && R2.sin_cubrir.equipos.length === 0);

// ----- Noticias recientes y anuncio -----
t("todos: noticias recientes (5 máx.), con visitas", A.noticias_recientes.length === 5 && A.noticias_recientes.every((n) => typeof n.visitas === "number"));
t("sin anuncio fijado: null", A.anuncio === null);
db.prepare("INSERT INTO settings (key,value) VALUES ('inicio_anuncio',?)").run(JSON.stringify({ titulo: "Reunión", texto: "El jueves a las 20:00.", autor: "Admin" }));
t("con anuncio: lo ven todos los roles", (await L.construirResumenInicio(env, u(9))).anuncio.texto === "El jueves a las 20:00.");
db.prepare("UPDATE settings SET value=? WHERE key='inicio_anuncio'").run(JSON.stringify({ titulo: "Viejo", texto: "Caducado", caduca: dia(-1) }));
t("un anuncio caducado no se muestra", (await L.construirResumenInicio(env, u(7))).anuncio === null);

// ----- Un bloque que falla no tumba el resto -----
db.exec("DROP TABLE acreditaciones");
const A2 = await L.construirResumenInicio(env, u(1));
t("si falla un bloque (sin tabla de acreditaciones) el resto sigue", A2.acreditaciones === null && A2.revision.total === 2 && A2.equipo.mes.publicaciones === 5);

console.log(`\n${ok} OK, ${fail} FALLO`);
process.exit(fail ? 1 : 0);
