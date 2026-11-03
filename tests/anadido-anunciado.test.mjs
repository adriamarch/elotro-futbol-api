// Tiempo añadido anunciado en directo: cron (descanso 45+N / final 90+N) y
// relojes (panel y web pública) con tope en el final del añadido.
import fs from "fs"; import vm from "vm";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };

const src = fs.readFileSync(root + "worker/src/index.js", "utf8");
const cortar = (desde, hasta) => { const a = src.indexOf(desde), b = src.indexOf(hasta, a); if (a < 0 || b < 0) throw new Error("no encuentro " + desde); return src.slice(a, b); };
const codigo = cortar("const MINUTO_DESCANSO_AUTOMATICO", "// Minutos que dura el descanso automático")
  + cortar("function minutoEnVivoServidor", "// ---------- Avisos de partidos sin cubrir")
  + cortar("async function cerrarPartidoAlTerminarAnadido", "// ---------- MINUTO A MINUTO: aviso de partido \"desatendido\"");

// Base de datos de mentira: apunta cada escritura (SQL + parámetros).
function entorno() {
  const log = [];
  const env = { DB: { prepare: (sql) => { let args = [];
    const q = { bind: (...x) => { args = x; return q; }, all: async () => ({ results: [] }), first: async () => null,
      run: async () => { log.push({ sql, args }); return {}; } }; return q; } } };
  return { env, log };
}
const ctxVm = () => vm.createContext({ console, Date, Number, Math, parseInt, String, Promise,
  invalidarCacheArticuloPartido: async () => {}, notificarPushPartido: async () => {} });
// Un partido "corriendo" cuyo reloj marca justo `minuto` (+30 s de margen).
const enMinuto = (minuto, extra = {}) => ({ id: 7, inicio_cronometro_at: new Date(Date.now() - (minuto * 60 + 30) * 1000).toISOString().slice(0, 19).replace("T", " "),
  cronometro_pausado_en: null, ajuste_cronometro_minutos: 0, anadido_minutos: null, anadido_parte: null, ...extra });

const c = ctxVm();
vm.runInContext(codigo + "\nthis.descanso = crearDescansoAutomaticoAlMinuto45; this.cierre = cerrarPartidoAlTerminarAnadido; this.anad = anadidoAnunciado;", c);

// anadidoAnunciado
t("anadidoAnunciado: parte correcta", c.anad({ anadido_minutos: 3, anadido_parte: 1 }, 1) === 3);
t("anadidoAnunciado: otra parte => 0", c.anad({ anadido_minutos: 3, anadido_parte: 1 }, 2) === 0);
t("anadidoAnunciado: nada => 0", c.anad({ anadido_minutos: null, anadido_parte: null }, 1) === 0);
t("anadidoAnunciado: fuera de rango => 0", c.anad({ anadido_minutos: 40, anadido_parte: 1 }, 1) === 0);

// --- descanso automatico
let { env, log } = entorno();
await c.descanso(env, [enMinuto(45)]);
const upd = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
const ev = log.find((l) => l.sql.includes("INSERT INTO match_events"));
t("sin añadido: descanso normal en el 45", upd && upd.args[0] === 45 && ev && ev.args[1] === 45 && ev.args[2] === null, JSON.stringify(log));

({ env, log } = entorno());
await c.descanso(env, [enMinuto(47, { anadido_minutos: 3, anadido_parte: 1 })]);
t("con +3 anunciado: no para en el 47", log.length === 0, JSON.stringify(log));

({ env, log } = entorno());
await c.descanso(env, [enMinuto(49, { anadido_minutos: 3, anadido_parte: 1 })]);
const upd2 = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
const ev2 = log.find((l) => l.sql.includes("INSERT INTO match_events"));
t("con +3 anunciado: tras el margen de 1 min pone el descanso y para el reloj en el 48 (45+3)", upd2 && upd2.args[0] === 48, JSON.stringify(log));
t("con +3 anunciado: evento descanso 45' + 3", ev2 && ev2.args[1] === 45 && ev2.args[2] === 3, JSON.stringify(log));

({ env, log } = entorno());
await c.descanso(env, [enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 })]);
t("con +3 anunciado: en el 45+3 NO cierra todavía (margen de 1 min para la cuenta atrás)", log.length === 0, JSON.stringify(log));

({ env, log } = entorno());
await c.descanso(env, [enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 })], { sinGracia: true });
t("con +3 anunciado y 'Pitar ya' (sinGracia): cierra en el 45+3 sin esperar", log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en") && l.args[0] === 48), JSON.stringify(log));

({ env, log } = entorno());
await c.descanso(env, [enMinuto(46, { anadido_minutos: 4, anadido_parte: 2 })]);
const upd3 = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
t("añadido de la 2ª parte no afecta al descanso (sigue en el 45)", upd3 && upd3.args[0] === 45, JSON.stringify(log));

// --- final al terminar el añadido de la 2ª parte
({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(93, { anadido_minutos: 4, anadido_parte: 2 })]);
t("final: a 90+3 con +4 no cierra", log.length === 0, JSON.stringify(log));

({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(94, { anadido_minutos: 4, anadido_parte: 2 })]);
t("final: en el 90+4 con +4 NO cierra todavía (margen de 1 min para la cuenta atrás)", log.length === 0, JSON.stringify(log));

({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(94, { anadido_minutos: 4, anadido_parte: 2 })], { sinGracia: true });
t("final: con 'Pitar ya' (sinGracia) cierra en el 90+4 sin esperar", log.some((l) => l.sql.includes("INSERT INTO match_events") && l.args[1] === 4), JSON.stringify(log));

({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(95, { anadido_minutos: 4, anadido_parte: 2 })]);
const fin = log.find((l) => l.sql.includes("INSERT INTO match_events"));
const cierra = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
t("final: pasado el margen cierra con evento 90+4", fin && fin.args[0] === 7 && fin.args[1] === 4, JSON.stringify(log));
t("final: queda finalizado, reloj registrado en 94 (90+4, no 95) y sin 'no cubierto'", cierra && cierra.args[0] === 94 && /estado = 'finalizado'/.test(cierra.sql) && /finalizado_no_cubierto = 0/.test(cierra.sql), JSON.stringify(log));

({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(100)]);
t("final: sin añadido anunciado no hace nada (sigue manual)", log.length === 0, JSON.stringify(log));

({ env, log } = entorno());
await c.cierre(env, null, [enMinuto(94, { anadido_minutos: 3, anadido_parte: 1 })]);
t("final: añadido de la 1ª parte no cierra el partido", log.length === 0, JSON.stringify(log));

// --- relojes: publico
const pub = fs.readFileSync(root + "public/js/partidos.js", "utf8");
const cp = vm.createContext({ Date, Number, Math, String });
vm.runInContext(cortar2(pub, "function minutoEnVivoPublico", "// Refresca cada 20s") + "\nthis.min = minutoEnVivoPublico; this.txt = minutoEnVivoTexto;", cp);
function cortar2(s, d, h) { const a = s.indexOf(d), b = s.indexOf(h, a); return s.slice(a, b); }
t("público: 1ª parte con +3, reloj en 47 => '45+2' (+3)", cp.txt(enMinuto(47, { anadido_minutos: 3, anadido_parte: 1 })) === "· 45+2' (+3)", cp.txt(enMinuto(47, { anadido_minutos: 3, anadido_parte: 1 })));
t("público: tope en 45+3 aunque el reloj vaya por el 52", cp.min(enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 })) === 48);
t("público: 2ª parte con +4, reloj en 93 => 90+3' (+4)", cp.txt(enMinuto(93, { anadido_minutos: 4, anadido_parte: 2 })) === "· 90+3' (+4)", cp.txt(enMinuto(93, { anadido_minutos: 4, anadido_parte: 2 })));
t("público: tope en 90+4 aunque el reloj vaya por el 99", cp.min(enMinuto(99, { anadido_minutos: 4, anadido_parte: 2 })) === 94);
t("público: sin añadido todo igual (47 => 47')", cp.txt(enMinuto(47)) === "· 47'");
t("público: sin añadido, 93 => 90+3'", cp.txt(enMinuto(93)) === "· 90+3'");
t("público: en el descanso queda 45+3' sin el (+N)", cp.txt({ ...enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 }), cronometro_pausado_en: 48 }) === "· 45+3'", cp.txt({ ...enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 }), cronometro_pausado_en: 48 }));

// --- relojes: panel
const mam = fs.readFileSync(root + "public/admin/js/minuto-a-minuto.js", "utf8");
const adm = fs.readFileSync(root + "public/admin/js/admin.js", "utf8");
const cm = vm.createContext({ Date, Number, Math, String, console, MAM_EVENTOS: [], MAM_RESULTADO: null, parseInt });
vm.runInContext(cortar2(mam, "// ---------- Tiempo añadido anunciado", "// Los navegadores limitan") + cortar2(mam, "function mamEnSegundaParte", "function actualizarRelojEnPantalla")
  + cortar2(adm, "function dividirMinutoConAñadido", "// Calcula el minuto en vivo de un resultado cualquiera")
  + "\nthis.min = minutoEnVivo; this.txt = mamTextoMinutoReloj;", cm);
cm.MAM_RESULTADO = enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 });
t("panel: tope en 45+3 en la 1ª parte", cm.min() === 48, String(cm.min()));
cm.MAM_RESULTADO = enMinuto(47, { anadido_minutos: 3, anadido_parte: 1 });
t("panel: texto '45+2' (+3)'", cm.txt(cm.min()) === "45+2' (+3)", cm.txt(cm.min()));
cm.MAM_EVENTOS = [{ tipo: "descanso" }, { tipo: "fin_descanso" }];
cm.MAM_RESULTADO = enMinuto(99, { anadido_minutos: 4, anadido_parte: 2 });
t("panel: tope en 90+4 en la 2ª parte", cm.min() === 94, String(cm.min()));
cm.MAM_RESULTADO = enMinuto(93, { anadido_minutos: 4, anadido_parte: 2 });
t("panel: texto 90+3' (+4)", cm.txt(cm.min()) === "90+3' (+4)", cm.txt(cm.min()));
cm.MAM_RESULTADO = enMinuto(60, { anadido_minutos: 3, anadido_parte: 1 }); // dato viejo de la 1ª parte ya en 2ª parte
t("panel: añadido de la 1ª parte no afecta a la 2ª", cm.min() === 60, String(cm.min()));

// --- endpoint POST /api/results/:id/cronometro  { accion: "anadido" }
{
  const a = src.indexOf('} else if (body.accion === "anadido") {'), b = src.indexOf('} else {\n          return json({ error: "Acción no válida', a);
  if (a < 0 || b < 0) throw new Error("no encuentro el endpoint anadido");
  const ce = vm.createContext({ Number, Math, Date, String, parseInt, console, invalidarCacheArticuloPartido: async () => {}, notificarPushPartido: async () => {},
    json: (body, status = 200) => ({ status, body }) });
  vm.runInContext(cortar("function minutoEnVivoServidor", "// ---------- Avisos de partidos sin cubrir")
    + cortar("async function anadidoSeguirActivo", "// Revisa cada minuto (mismo cron que ya revisa partidos programados y")
    + "\nthis.f = async function (body, resultadoId, env, ctx) { if (false) {" + src.slice(a, b) + "} return { status: 200 }; };", ce);
  // escenario: reloj en `minuto`, eventos presentes, estado
  const escenario = ({ minuto, pausadoEn = null, eventos = [], estado = "en_juego" }) => {
    const log = [];
    const base = enMinuto(minuto);
    const fila = { estado, inicio_cronometro_at: base.inicio_cronometro_at, cronometro_pausado_en: pausadoEn, ajuste_cronometro_minutos: 0 };
    const env = { DB: { prepare: (sql) => { let args = [];
      const q = { bind: (...x) => { args = x; return q; },
        first: async () => {
          if (sql.includes("FROM results")) return fila;
          if (sql.includes("tipo = 'fin_descanso'")) return eventos.find((e) => e.tipo === "fin_descanso") || null;
          if (sql.includes("tipo = 'descanso'")) return [...eventos].reverse().find((e) => e.tipo === "descanso") || null;
          return null; },
        run: async () => { log.push({ sql, args }); return {}; } }; return q; } } };
    return { env, log, ctx: { waitUntil: () => {} } };
  };
  const llama = (esc, body) => ce.f({ accion: "anadido", ...body }, 7, esc.env, esc.ctx);
  const guarda = (log) => log.find((l) => l.sql.includes("SET anadido_minutos"));

  let e = escenario({ minuto: 44 });
  let r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: guarda +3 de la 1ª parte", r.status === 200 && guarda(e.log).args[0] === 3 && guarda(e.log).args[1] === 1, JSON.stringify(e.log));

  e = escenario({ minuto: 46, pausadoEn: 45, eventos: [{ id: 99, tipo: "descanso", var_motivo: "automatico" }] });
  r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: descanso automático recién puesto => se retira y el reloj sigue",
    r.status === 200 && e.log.some((l) => l.sql.includes("DELETE FROM match_events") && l.args[0] === 99)
    && e.log.some((l) => l.sql.includes("cronometro_pausado_en = NULL")) && guarda(e.log).args[0] === 3, JSON.stringify({ r, log: e.log }));

  e = escenario({ minuto: 50, pausadoEn: 45, eventos: [{ id: 99, tipo: "descanso", var_motivo: "automatico" }] });
  r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: descanso automático de hace mucho (reloj ya pasado) => rechaza y no toca nada", r.status === 400 && e.log.length === 0, JSON.stringify({ r, log: e.log }));

  e = escenario({ minuto: 46, pausadoEn: 46, eventos: [{ id: 99, tipo: "descanso", var_motivo: null }] });
  r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: descanso pitado a mano => rechaza", r.status === 400 && e.log.length === 0, JSON.stringify(r));

  e = escenario({ minuto: 50, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: añadido de la 1ª parte con la 2ª ya empezada => rechaza", r.status === 400, JSON.stringify(r));

  e = escenario({ minuto: 88 });
  r = await llama(e, { parte: 2, minutos: 4 });
  t("endpoint: 2ª parte sin haber empezado => rechaza", r.status === 400, JSON.stringify(r));

  e = escenario({ minuto: 88, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  r = await llama(e, { parte: 2, minutos: 4 });
  t("endpoint: guarda +4 de la 2ª parte", r.status === 200 && guarda(e.log).args[0] === 4 && guarda(e.log).args[1] === 2, JSON.stringify({ r, log: e.log }));

  e = escenario({ minuto: 93, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  r = await llama(e, { parte: 2, minutos: 2 });
  t("endpoint: añadido ya agotado por el reloj (93' con +2) => rechaza", r.status === 400 && e.log.length === 0, JSON.stringify(r));

  e = escenario({ minuto: 91, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  r = await llama(e, { parte: 2, minutos: 0 });
  t("endpoint: 0 quita el añadido", r.status === 200 && guarda(e.log).args[0] === null && guarda(e.log).args[1] === null, JSON.stringify({ r, log: e.log }));

  // evento visible "Tiempo añadido +N'" en el timeline
  e = escenario({ minuto: 44 });
  await llama(e, { parte: 1, minutos: 3 });
  const evA = e.log.find((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'anadido'"));
  t("endpoint: crea el evento 'anadido' 45' con +3 en jugador", evA && evA.args[0] === 7 && evA.args[1] === "3" && evA.args[2] === 45, JSON.stringify(e.log));
  e = escenario({ minuto: 88, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  await llama(e, { parte: 2, minutos: 4 });
  const evB = e.log.find((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'anadido'"));
  t("endpoint: añadido de la 2ª parte => evento en el 90'", evB && evB.args[1] === "4" && evB.args[2] === 90, JSON.stringify(e.log));
  e = escenario({ minuto: 91, eventos: [{ id: 1, tipo: "descanso" }, { id: 2, tipo: "fin_descanso" }] });
  await llama(e, { parte: 2, minutos: 0 });
  t("endpoint: 0 borra el evento y no crea otro",
    e.log.some((l) => l.sql.includes("DELETE FROM match_events") && l.sql.includes("'anadido'")) && !e.log.some((l) => l.sql.includes("INSERT INTO match_events")), JSON.stringify(e.log));

  e = escenario({ minuto: 44 });
  t("endpoint: valores no válidos => 400",
    (await llama(e, { parte: 3, minutos: 2 })).status === 400 && (await llama(e, { parte: 1, minutos: 99 })).status === 400 && (await llama(e, { parte: 1, minutos: 2.5 })).status === 400);

  e = escenario({ minuto: 44, estado: "finalizado" });
  r = await llama(e, { parte: 1, minutos: 3 });
  t("endpoint: partido no en juego => rechaza", r.status === 400, JSON.stringify(r));
}

// --- fin automático inmediato: acción "cerrar_anadido" (el panel avisa en cuanto su reloj llega al límite)
{
  const ini = src.indexOf('} else if (body.accion === "cerrar_anadido") {');
  const fin = src.indexOf('} else {\n          return json({ error: "Acción no válida', ini);
  if (ini < 0 || fin < 0) throw new Error("no encuentro la acción cerrar_anadido");
  const cx = ctxVm();
  vm.runInContext(codigo + "\nthis.f = async function (body, resultadoId, env, ctx) { if (false) {" + src.slice(ini, fin) + "} return { status: 200 }; };", cx);
  const escCierre = (minuto, extra = {}, estado = "en_juego") => {
    const log = []; const fila = { ...enMinuto(minuto, extra), estado };
    const env = { DB: { prepare: (sql) => { let args = [];
      const q = { bind: (...x) => { args = x; return q; },
        first: async () => (sql.includes("FROM results") ? fila : null),
        run: async () => { log.push({ sql, args }); return {}; } }; return q; } } };
    return { env, log };
  };
  cx.json = (body, status = 200) => ({ status, body });
  const cierra = async (e, extra = {}) => cx.f({ accion: "cerrar_anadido", ...extra }, 7, e.env, { waitUntil: () => {} });

  let e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e);
  t("cerrar_anadido: en 45+3 todavía no cierra (margen de 1 min con cuenta atrás)", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e, { forzar: true });
  t("cerrar_anadido forzar (Pitar ya): en 45+3 cierra sin esperar el margen",
    e.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en") && l.args[0] === 48), JSON.stringify(e.log));
  e = escCierre(47, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e, { forzar: true });
  t("cerrar_anadido forzar: antes de agotarse el añadido tampoco cierra (se valida el reloj real)", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(49, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e);
  t("cerrar_anadido: 1ª parte pasado el margen => pone el descanso (pausa en 48)",
    e.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en") && l.args[0] === 48)
    && e.log.some((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'descanso'")), JSON.stringify(e.log));
  e = escCierre(47, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e);
  t("cerrar_anadido: antes de agotarse el añadido no toca nada", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(95, { anadido_minutos: 4, anadido_parte: 2 }); await cierra(e);
  t("cerrar_anadido: 2ª parte pasado el margen => finaliza el partido",
    e.log.some((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'fin_partido'"))
    && e.log.some((l) => /estado = 'finalizado'/.test(l.sql)), JSON.stringify(e.log));
  e = escCierre(100, {}); await cierra(e);
  t("cerrar_anadido: sin añadido anunciado nunca para el reloj", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1, cronometro_pausado_en: 48 }); await cierra(e);
  t("cerrar_anadido: reloj ya parado => idempotente", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(94, { anadido_minutos: 4, anadido_parte: 2 }, "finalizado"); await cierra(e);
  t("cerrar_anadido: partido ya finalizado => idempotente", e.log.length === 0, JSON.stringify(e.log));

  // --- "Seguir jugando": acción prolongar_anadido (el reloj sigue y el añadido anunciado NO cambia)
  const prolonga = async (e) => cx.f({ accion: "prolongar_anadido" }, 7, e.env, { waitUntil: () => {} });
  const guardaSeguir = (log) => log.find((l) => l.sql.includes("SET anadido_seguir = 1"));

  e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1 }); let rp = await prolonga(e);
  t("prolongar: 1ª parte en 45+3 => marca anadido_seguir y el reloj sigue", rp.status === 200 && !!guardaSeguir(e.log) && guardaSeguir(e.log).args[0] === 7, JSON.stringify({ rp, log: e.log }));
  t("prolongar: NO cambia el añadido anunciado (sigue en +3) ni su evento del timeline",
    !e.log.some((l) => l.sql.includes("SET anadido_minutos") || l.sql.includes("UPDATE match_events")), JSON.stringify(e.log));
  t("prolongar: no para el reloj ni cierra nada", !e.log.some((l) => /cronometro_pausado_en|fin_partido|descanso/.test(l.sql)), JSON.stringify(e.log));
  e = escCierre(94, { anadido_minutos: 4, anadido_parte: 2 }); rp = await prolonga(e);
  t("prolongar: 2ª parte en 90+4 => marca anadido_seguir y deja el +4", rp.status === 200 && !!guardaSeguir(e.log) && !e.log.some((l) => l.sql.includes("SET anadido_minutos")), JSON.stringify({ rp, log: e.log }));
  e = escCierre(49, { anadido_minutos: 3, anadido_parte: 1 }); rp = await prolonga(e);
  t("prolongar: pasado el margen de 1 min => 409 y no toca nada", rp.status === 409 && e.log.length === 0, JSON.stringify({ rp, log: e.log }));
  e = escCierre(44, { anadido_minutos: 3, anadido_parte: 1 }); rp = await prolonga(e);
  t("prolongar: aún dentro del tiempo normal => lo acepta igualmente (el reloj del navegador puede ir por delante)", rp.status === 200 && !!guardaSeguir(e.log), JSON.stringify({ rp, log: e.log }));
  e = escCierre(60, {}); rp = await prolonga(e);
  t("prolongar: sin añadido anunciado => 400", rp.status === 400 && e.log.length === 0, JSON.stringify(rp));
  e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1, cronometro_pausado_en: 48 }); rp = await prolonga(e);
  t("prolongar: reloj ya parado (descanso puesto) => 409", rp.status === 409 && e.log.length === 0, JSON.stringify(rp));
  e = escCierre(94, { anadido_minutos: 4, anadido_parte: 2 }, "finalizado"); rp = await prolonga(e);
  t("prolongar: partido ya finalizado => 409", rp.status === 409 && e.log.length === 0, JSON.stringify(rp));
  e = escCierre(105, { anadido_minutos: 15, anadido_parte: 2 }); rp = await prolonga(e);
  t("prolongar: con +15 también vale (ya no se amplía la cifra, no hay tope que pasar)", rp.status === 200 && !!guardaSeguir(e.log), JSON.stringify({ rp, log: e.log }));

  // Con "Seguir jugando" puesto, el servidor ya NO cierra solo ni con "cerrar_anadido" ni (más abajo) con el cron
  e = escCierre(49, { anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 1 }); await cierra(e);
  t("cerrar_anadido con Seguir jugando: 1ª parte pasado el margen => NO pone el descanso", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(95, { anadido_minutos: 4, anadido_parte: 2, anadido_seguir: 1 }); await cierra(e, { forzar: true });
  t("cerrar_anadido con Seguir jugando: 2ª parte => NO finaliza el partido (ni forzado)", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(49, { anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 0 }); await cierra(e);
  t("cerrar_anadido con anadido_seguir = 0 se comporta como siempre", e.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en")), JSON.stringify(e.log));

  // Los dos workers (D1 y Railway) deben llevar la misma lógica
  const sec = fs.readFileSync(root + "worker-secondary/src/index.js", "utf8");
  t("worker-secondary lleva también cerrar_anadido", sec.includes('body.accion === "cerrar_anadido"') && sec.includes("cerrarPartidoAlTerminarAnadido(env, ctx, [filaCierre], opcionesCierre)"));
  t("worker-secondary lleva también prolongar_anadido y el margen", sec.includes('body.accion === "prolongar_anadido"') && sec.includes("const MINUTOS_GRACIA_FIN_ANADIDO = 1;"));
}

// --- panel: detecta el añadido agotado con el reloj SIN tope y avisa al servidor
{
  cm.MAM_EVENTOS = [];
  cm.MAM_RESULTADO = { ...enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 }), estado: "en_juego" };
  t("panel: en 45+3 el añadido está agotado", vm.runInContext("mamAnadidoAgotado()", cm) === true);
  cm.MAM_RESULTADO = { ...enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 }), estado: "en_juego" };
  t("panel: el reloj se queda en 48 pero el bruto sigue (52) y sigue agotado", cm.min() === 48 && vm.runInContext("mamMinutoBruto()", cm) === 52 && vm.runInContext("mamAnadidoAgotado()", cm) === true);
  cm.MAM_RESULTADO = { ...enMinuto(47, { anadido_minutos: 3, anadido_parte: 1 }), estado: "en_juego" };
  t("panel: en 45+2 con +3 todavía no está agotado", vm.runInContext("mamAnadidoAgotado()", cm) === false);
  cm.MAM_RESULTADO = { ...enMinuto(60), estado: "en_juego" };
  t("panel: sin añadido anunciado nunca se agota", vm.runInContext("mamAnadidoAgotado()", cm) === false);
  cm.MAM_RESULTADO = { ...enMinuto(48, { anadido_minutos: 3, anadido_parte: 1, cronometro_pausado_en: 48 }), estado: "en_juego" };
  t("panel: con el reloj ya parado no vuelve a avisar", vm.runInContext("mamAnadidoAgotado()", cm) === false);
  t("panel: el reloj en pantalla gestiona el aviso con cuenta atrás (ya no cierra al instante)", /mamGestionarFinAnadido\(agotado\);/.test(mam) && !/if \(agotado\) mamComprobarFinAnadido\(\);/.test(mam));
  t("panel: el modal de fin de añadido existe y sus botones llaman a las funciones", mam.includes('id="mamModalFinAnadido"') && mam.includes('onclick="mamProlongarAnadido()"') && mam.includes('onclick="mamCerrarAnadidoAhora()"'));
  t("panel: 'Pitar ya' envía forzar al servidor", /forzar \? \{ accion: "cerrar_anadido", forzar: true \}/.test(mam));

  // Cuenta atrás: sale del reloj real (1 min desde que se agota el añadido)
  const msCierre = (minuto, extra, segundosDeMas = 0) => { cm.MAM_RESULTADO = { ...enMinuto(minuto, extra), estado: "en_juego" };
    cm.MAM_RESULTADO.inicio_cronometro_at = new Date(Date.now() - (minuto * 60 + segundosDeMas) * 1000).toISOString().slice(0, 19).replace("T", " ");
    return vm.runInContext("mamMsParaCierreAnadido()", cm); };
  const m0 = msCierre(48, { anadido_minutos: 3, anadido_parte: 1 }, 0);
  t("cuenta atrás: recién agotado el añadido (45+3:00) quedan ~60 s", m0 > 58000 && m0 <= 60000, String(m0));
  const m1 = msCierre(48, { anadido_minutos: 3, anadido_parte: 1 }, 45);
  t("cuenta atrás: a los 45 s quedan ~15 s", m1 > 13000 && m1 <= 15000, String(m1));
  const m2 = msCierre(49, { anadido_minutos: 3, anadido_parte: 1 }, 1);
  t("cuenta atrás: pasado el margen sale <= 0 (se cierra)", m2 <= 0, String(m2));
  cm.MAM_RESULTADO = { ...enMinuto(60), estado: "en_juego" };
  t("cuenta atrás: sin añadido anunciado => null", vm.runInContext("mamMsParaCierreAnadido()", cm) === null);
  cm.MAM_EVENTOS = [{ tipo: "descanso" }, { tipo: "fin_descanso" }];
  const m3 = msCierre(94, { anadido_minutos: 4, anadido_parte: 2 }, 10);
  t("cuenta atrás: 2ª parte en 90+4:10 quedan ~50 s", m3 > 48000 && m3 <= 50000, String(m3));
  cm.MAM_EVENTOS = [];
  t("panel: descanso y final usan el selector nuevo (sin EOF.preguntar)", mam.includes('mamPedirAnadido(1, "descanso")') && mam.includes('mamPedirAnadido(2, "final")') && !mam.includes("Minutos de tiempo añadido en la"));
  // --- El modal con DOM simulado: se abre, cuenta atrás, cierra solo, Pitar ya y Seguir jugando
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: "", innerHTML: "", dataset: {}, style: {}, disabled: false, _c: new Set(),
    classList: { add: (c) => els[id]._c.add(c), remove: (c) => els[id]._c.delete(c), contains: (c) => els[id]._c.has(c),
      toggle: (c, on) => (on ? els[id]._c.add(c) : els[id]._c.delete(c)) }, focus() {} });
  const llamadas = []; const toasts = []; let respuesta = null; let recargas = 0;
  cm.document = { getElementById: (id) => el(id), activeElement: null };
  cm.setTimeout = () => 0;
  cm.apiFetch = async (url, op) => { llamadas.push({ url, body: JSON.parse(op.body) }); return respuesta || { resultado: null }; };
  cm.EOF = { toast: (m, tipo) => toasts.push({ m, tipo }) };
  cm.recargarResultadoYEventos = async () => { recargas++; };
  cm.renderBotoneraMinutoAMinuto = () => {}; cm.renderTimelineMinutoAMinuto = () => {}; cm.actualizarRelojEnPantalla = () => {};
  const asentar = () => new Promise((r) => setImmediate(r)); // deja acabar lo que quedara en vuelo
  const reset = async () => { await asentar(); llamadas.length = 0; toasts.length = 0; recargas = 0; respuesta = null; Object.values(els).forEach((x) => x._c.clear());
    vm.runInContext("MAM_CIERRE_ANADIDO_ULTIMO = 0; MAM_CIERRE_ANADIDO_EN_CURSO = false; MAM_FIN_ANADIDO_FORZADO = false; MAM_FIN_ANADIDO_PROLONGANDO = false;", cm); };
  // Partido en 45+3 (1ª parte, +3) con `seg` segundos ya jugados del minuto 48.
  const enAnadido = (seg, extra = {}) => { cm.MAM_RESULTADO = { id: 7, estado: "en_juego", cronometro_pausado_en: null, ajuste_cronometro_minutos: 0, anadido_minutos: 3, anadido_parte: 1,
    inicio_cronometro_at: new Date(Date.now() - (48 * 60 + seg) * 1000).toISOString().slice(0, 19).replace("T", " "), ...extra }; };
  const gestiona = (agotado) => vm.runInContext(`mamGestionarFinAnadido(${agotado})`, cm);

  await reset(); enAnadido(20); gestiona(true);
  t("modal: al agotarse el añadido se abre con la cuenta atrás (~0:40)", els.mamModalFinAnadido._c.has("mam-abierto") && /^0:(39|40)$/.test(els.mamFinCuenta.textContent), els.mamFinCuenta.textContent);
  t("modal: no cierra nada mientras queda margen", llamadas.length === 0, JSON.stringify(llamadas));
  t("modal: textos de la 1ª parte (45+3', descanso)", /45\+3/.test(els.mamFinSub.textContent) && /descanso/.test(els.mamFinCerrar.textContent) && /45\+3/.test(els.mamFinInfo.innerHTML), els.mamFinSub.textContent);
  await reset(); enAnadido(52); gestiona(true);
  t("modal: en los últimos 10 s la cuenta se marca como urgente", els.mamFinCuenta._c.has("mam-fin-urgente"));

  await reset(); enAnadido(61); els.mamModalFinAnadido._c.add("mam-abierto"); gestiona(true);
  t("modal: al acabar la cuenta atrás se esconde y se cierra solo (cerrar_anadido sin forzar)",
    !els.mamModalFinAnadido._c.has("mam-abierto") && llamadas.length === 1 && llamadas[0].body.accion === "cerrar_anadido" && !llamadas[0].body.forzar, JSON.stringify(llamadas));

  await reset(); enAnadido(20); gestiona(true); vm.runInContext("mamCerrarAnadidoAhora()", cm);
  t("Pitar ya: esconde el modal y pide cerrar_anadido con forzar", !els.mamModalFinAnadido._c.has("mam-abierto") && llamadas.length === 1 && llamadas[0].body.forzar === true, JSON.stringify(llamadas));
  await asentar(); llamadas.length = 0; vm.runInContext("MAM_CIERRE_ANADIDO_ULTIMO = 0", cm); gestiona(true);
  t("Pitar ya: si el servidor aún no cierra, no reabre el modal y sigue reintentando forzado", !els.mamModalFinAnadido._c.has("mam-abierto") && llamadas.length === 1 && llamadas[0].body.forzar === true, JSON.stringify(llamadas));

  await reset(); enAnadido(20); gestiona(true);
  respuesta = { resultado: { id: 7, estado: "en_juego", cronometro_pausado_en: null, ajuste_cronometro_minutos: 0, anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 1, inicio_cronometro_at: cm.MAM_RESULTADO.inicio_cronometro_at } };
  await vm.runInContext("mamProlongarAnadido()", cm);
  t("Seguir jugando: envía prolongar_anadido", llamadas.length === 1 && llamadas[0].url === "/api/results/7/cronometro" && llamadas[0].body.accion === "prolongar_anadido", JSON.stringify(llamadas));
  t("Seguir jugando: esconde el modal, recarga el panel y avisa de que el añadido se queda en +3'", !els.mamModalFinAnadido._c.has("mam-abierto") && recargas === 1 && toasts.length === 1 && /se queda en \+3'/.test(toasts[0].m), JSON.stringify({ toasts, recargas }));
  t("Seguir jugando: el añadido anunciado sigue siendo +3 y el reloj ya no está agotado ni tiene límite",
    vm.runInContext("mamAnadidoAnunciado(1)", cm) === 3 && vm.runInContext("mamLimiteAnadido()", cm) === null && vm.runInContext("mamAnadidoAgotado()", cm) === false && (gestiona(false), !els.mamModalFinAnadido._c.has("mam-abierto")));
  t("Seguir jugando: el reloj corre pasado el 45+3 (49' => 45+4') sin tope", (() => { enAnadido(0, { anadido_seguir: 1 }); cm.MAM_RESULTADO.inicio_cronometro_at = new Date(Date.now() - 49.5 * 60 * 1000).toISOString().slice(0, 19).replace("T", " "); return cm.min() === 49 && cm.txt(cm.min()) === "45+4' (+3)"; })());
  t("Seguir jugando: no hay cuenta atrás de cierre (mamMsParaCierreAnadido => null) y la 2ª parte tampoco se frena", (() => {
    enAnadido(0, { anadido_seguir: 1 }); const a = vm.runInContext("mamMsParaCierreAnadido()", cm) === null;
    cm.MAM_EVENTOS = [{ tipo: "descanso" }, { tipo: "fin_descanso" }]; cm.MAM_RESULTADO = enMinuto(97, { anadido_minutos: 4, anadido_parte: 2, anadido_seguir: 1 }); cm.MAM_RESULTADO.estado = "en_juego";
    const b = cm.min() === 97 && cm.txt(97) === "90+7' (+4)" && vm.runInContext("mamAnadidoAgotado()", cm) === false; cm.MAM_EVENTOS = []; return a && b; })());
  t("Seguir jugando: un anadido_seguir suelto sin añadido anunciado no hace nada", (() => { cm.MAM_RESULTADO = enMinuto(60, { anadido_seguir: 1 }); return cm.min() === 60 && vm.runInContext("mamLimiteAnadido()", cm) === null; })());
  t("Seguir jugando: los botones y textos ya no hablan de +1'", !mam.includes("Seguir jugando (+1')") && !mam.includes("añadido ampliado"));

  await reset(); enAnadido(20); gestiona(true); gestiona(false);
  t("modal: si el añadido deja de estar agotado (otro panel lo cerró o lo cambió) se esconde solo", !els.mamModalFinAnadido._c.has("mam-abierto"));

  await reset(); enAnadido(20); gestiona(true);
  cm.apiFetch = async () => { throw new Error("El reloj ya no corre: el añadido ya se ha cerrado."); };
  await vm.runInContext("mamProlongarAnadido()", cm);
  t("Seguir jugando con error (409): esconde el modal, avisa y recarga el estado real", !els.mamModalFinAnadido._c.has("mam-abierto") && toasts.some((x) => x.tipo === "error" && /ya se ha cerrado/.test(x.m)) && recargas === 1, JSON.stringify({ toasts, recargas }));
}

// --- "Seguir jugando": web pública sin tope y cron sin cierre automático
{
  t("público con Seguir jugando: sin tope (52 con +3 en la 1ª parte => 52)", cp.min(enMinuto(52, { anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 1 })) === 52);
  t("público con Seguir jugando: 1ª parte en 49 => '45+4' (+3)'", cp.txt(enMinuto(49, { anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 1 })) === "· 45+4' (+3 · final)", cp.txt(enMinuto(49, { anadido_minutos: 3, anadido_parte: 1, anadido_seguir: 1 })));
  t("público con Seguir jugando: 2ª parte en 99 => 90+9' (+4 · final), no se queda en 90+4", cp.txt(enMinuto(99, { anadido_minutos: 4, anadido_parte: 2, anadido_seguir: 1 })) === "· 90+9' (+4 · final)", cp.txt(enMinuto(99, { anadido_minutos: 4, anadido_parte: 2, anadido_seguir: 1 })));
  t("público sin Seguir jugando: sigue el tope de siempre", cp.min(enMinuto(99, { anadido_minutos: 4, anadido_parte: 2, anadido_seguir: null })) === 94);

  // cron: con el indicador puesto no pone el descanso ni cierra el partido, aunque el reloj haya pasado el margen
  const envSeguir = (valor) => { const log = [];
    const env = { DB: { prepare: (sql) => { let args = [];
      const q = { bind: (...x) => { args = x; return q; }, all: async () => ({ results: [] }),
        first: async () => (sql.includes("SELECT anadido_seguir") ? { anadido_seguir: valor } : null),
        run: async () => { log.push({ sql, args }); return {}; } }; return q; } } };
    return { env, log }; };
  let x = envSeguir(1);
  await c.descanso(x.env, [enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 })]);
  t("cron con Seguir jugando: 1ª parte pasado el margen NO pone el descanso", x.log.length === 0, JSON.stringify(x.log));
  x = envSeguir(1);
  await c.cierre(x.env, { waitUntil: () => {} }, [enMinuto(99, { anadido_minutos: 4, anadido_parte: 2 })]);
  t("cron con Seguir jugando: 2ª parte pasado el margen NO finaliza el partido", x.log.length === 0, JSON.stringify(x.log));
  x = envSeguir(null);
  await c.descanso(x.env, [enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 })]);
  t("cron sin Seguir jugando: sigue poniendo el descanso", x.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en")), JSON.stringify(x.log));
  // migración sin aplicar: la consulta de anadido_seguir falla => se comporta como siempre (no rompe el cron)
  x = envSeguir(null);
  const prepararOriginal = x.env.DB.prepare;
  x.env.DB.prepare = (sql) => { if (sql.includes("anadido_seguir")) throw new Error("no such column: anadido_seguir"); return prepararOriginal(sql); };
  await c.descanso(x.env, [enMinuto(52, { anadido_minutos: 3, anadido_parte: 1 })]);
  t("cron con la migración sin aplicar: no rompe y cierra como antes", x.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en")), JSON.stringify(x.log));

  // los dos workers y el esquema llevan lo mismo
  const sec2 = fs.readFileSync(root + "worker-secondary/src/index.js", "utf8");
  t("worker-secondary lleva también el indicador anadido_seguir", sec2.includes("async function anadidoSeguirActivo") && sec2.includes("SET anadido_seguir = 1") && !sec2.includes("actualProp"));
  t("esquema y migración de anadido_seguir presentes", fs.readFileSync(root + "worker/schema.sql", "utf8").includes("anadido_seguir") && fs.existsSync(root + "worker/migracion_anadido_seguir.sql"));
}

console.log(`\n${ok} ok, ${fail} fallos`); process.exit(fail ? 1 : 0);
