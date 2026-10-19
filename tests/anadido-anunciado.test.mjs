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
await c.descanso(env, [enMinuto(48, { anadido_minutos: 3, anadido_parte: 1 })]);
const upd2 = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
const ev2 = log.find((l) => l.sql.includes("INSERT INTO match_events"));
t("con +3 anunciado: para en el 48 (45+3)", upd2 && upd2.args[0] === 48, JSON.stringify(log));
t("con +3 anunciado: evento descanso 45' + 3", ev2 && ev2.args[1] === 45 && ev2.args[2] === 3, JSON.stringify(log));

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
const fin = log.find((l) => l.sql.includes("INSERT INTO match_events"));
const cierra = log.find((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en"));
t("final: a 90+4 con +4 cierra con evento 90+4", fin && fin.args[0] === 7 && fin.args[1] === 4, JSON.stringify(log));
t("final: queda finalizado, reloj parado en 94 y sin 'no cubierto'", cierra && cierra.args[0] === 94 && /estado = 'finalizado'/.test(cierra.sql) && /finalizado_no_cubierto = 0/.test(cierra.sql), JSON.stringify(log));

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
  const ce = vm.createContext({ Number, Math, Date, String, parseInt, console, invalidarCacheArticuloPartido: async () => {},
    json: (body, status = 200) => ({ status, body }) });
  vm.runInContext(cortar("function minutoEnVivoServidor", "// ---------- Avisos de partidos sin cubrir")
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
  const cierra = async (e) => cx.f({ accion: "cerrar_anadido" }, 7, e.env, { waitUntil: () => {} });

  let e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e);
  t("cerrar_anadido: 1ª parte en 45+3 => pone el descanso (pausa en 48)",
    e.log.some((l) => l.sql.includes("UPDATE results SET cronometro_pausado_en") && l.args[0] === 48)
    && e.log.some((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'descanso'")), JSON.stringify(e.log));
  e = escCierre(47, { anadido_minutos: 3, anadido_parte: 1 }); await cierra(e);
  t("cerrar_anadido: antes de agotarse el añadido no toca nada", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(94, { anadido_minutos: 4, anadido_parte: 2 }); await cierra(e);
  t("cerrar_anadido: 2ª parte en 90+4 => finaliza el partido",
    e.log.some((l) => l.sql.includes("INSERT INTO match_events") && l.sql.includes("'fin_partido'"))
    && e.log.some((l) => /estado = 'finalizado'/.test(l.sql)), JSON.stringify(e.log));
  e = escCierre(100, {}); await cierra(e);
  t("cerrar_anadido: sin añadido anunciado nunca para el reloj", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(48, { anadido_minutos: 3, anadido_parte: 1, cronometro_pausado_en: 48 }); await cierra(e);
  t("cerrar_anadido: reloj ya parado => idempotente", e.log.length === 0, JSON.stringify(e.log));
  e = escCierre(94, { anadido_minutos: 4, anadido_parte: 2 }, "finalizado"); await cierra(e);
  t("cerrar_anadido: partido ya finalizado => idempotente", e.log.length === 0, JSON.stringify(e.log));

  // Los dos workers (D1 y Railway) deben llevar la misma acción
  const sec = fs.readFileSync(root + "worker-secondary/src/index.js", "utf8");
  t("worker-secondary lleva también cerrar_anadido", sec.includes('body.accion === "cerrar_anadido"') && sec.includes("cerrarPartidoAlTerminarAnadido(env, ctx, [filaCierre])"));
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
  t("panel: el reloj en pantalla dispara el aviso", /if \(agotado\) mamComprobarFinAnadido\(\);/.test(mam));
  t("panel: descanso y final usan el selector nuevo (sin EOF.preguntar)", mam.includes('mamPedirAnadido(1, "descanso")') && mam.includes('mamPedirAnadido(2, "final")') && !mam.includes("Minutos de tiempo añadido en la"));
}

console.log(`\n${ok} ok, ${fail} fallos`); process.exit(fail ? 1 : 0);
