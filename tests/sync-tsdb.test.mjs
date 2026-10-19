import fs from "fs";
import vm from "vm";
const file = process.argv[2] || new URL("../src/index.js", import.meta.url).pathname;
const src = fs.readFileSync(file, "utf8");
const a = src.indexOf("const SYNC_FUENTE");
const b = src.indexOf("async function syncRutasAdmin");
const code = src.slice(a, b);

let ahoraFalso = Date.now();
const store = { config: null, estado: "{}" };
let rowsPlan = [], rowsCand = [], inserts = 0, escriturasSettings = 0;
const fetchLog = [];

const mkDB = () => ({
  prepare(sql) {
    let args = [];
    const q = {
      bind(...a) { args = a; return q; },
      async all() {
        if (sql.includes("FROM settings")) return { results: [
          { key: "sync_partidos_config", value: store.config },
          { key: "sync_partidos_estado", value: store.estado }] };
        if (sql.includes("GROUP BY jornada")) return { results: rowsPlan };
        if (sql.includes("fecha_partido <= ?")) return { results: rowsCand };
        return { results: [] };
      },
      async first() { return sql.includes("jornadas_calendario") ? { n: 0 } : null; },
      async run() {
        if (sql.includes("INSERT INTO settings")) { escriturasSettings++; store.estado = args[1]; }
        return { meta: { changes: 0 } };
      },
    };
    return q;
  },
  async batch(l) { inserts += l.length; return []; },
});

const ctx = vm.createContext({
  console, Intl, Date: class extends Date { constructor(...x) { super(...(x.length ? x : [ahoraFalso])); } static now() { return ahoraFalso; } },
  AbortSignal, URL, Request, Response, encodeURIComponent, Math, JSON, Promise, Number, String, Set, Map, Object, Array, parseInt, RegExp, Error,
  json: () => null, requireAuth: async () => null,
  fetch: async (url) => {
    fetchLog.push(url);
    const r = /[?&]r=(\d+)/.exec(url)?.[1];
    return { ok: true, status: 200, json: async () => ({ events: r ? [{ idEvent: "e" + r + "_" + fetchLog.length, strHomeTeam: "A" + r, strAwayTeam: "B" + r, dateEvent: "2030-01-01", strTime: "20:00:00", intRound: r }] : [] }) };
  },
});
vm.runInContext(code + "\nthis.syncEjecutarPasada = syncEjecutarPasada; this.syncCalcularOmitidas = syncCalcularOmitidas; this.syncPartesMadrid = syncPartesMadrid;", ctx);

let ok = 0, fail = 0;
const t = (nombre, cond, extra = "") => { cond ? ok++ : fail++; console.log((cond ? "OK   " : "FALLO"), nombre, extra); };
const hoy = ctx.syncPartesMadrid(new Date(ahoraFalso)).fecha;
const dia = (d) => new Date(Date.parse(hoy + "T12:00:00Z") + d * 864e5).toISOString().slice(0, 10);

// --- pura
const filas = [];
for (let j = 1; j <= 7; j++) filas.push({ jornada: j, n: 11, fin: 11, ultima: dia(-30 + j) });
filas.push({ jornada: 8, n: 11, fin: 5, ultima: dia(1) });
for (let j = 9; j <= 42; j++) filas.push({ jornada: j, n: 11, fin: 0, ultima: dia(5 + j) });
filas.push({ jornada: 7, n: 11, fin: 11, ultima: dia(-30) });
const om = ctx.syncCalcularOmitidas(filas, hoy);
t("cerradas 1..7 omitidas", [1,2,3,4,5,6,7].every((j) => om.has(j)));
t("8..11 se piden", [8,9,10,11].every((j) => !om.has(j)));
t("12..42 omitidas", om.has(12) && om.has(42));
t("jornada cerrada hace <2 dias no se omite", !ctx.syncCalcularOmitidas([{jornada:1,n:11,fin:11,ultima:dia(-1)},{jornada:2,n:11,fin:11,ultima:dia(-9)}], hoy).has(1));
t("jornada incompleta (menos partidos) no se omite", !ctx.syncCalcularOmitidas([{jornada:1,n:9,fin:9,ultima:dia(-30)},{jornada:2,n:11,fin:11,ultima:dia(-20)},{jornada:3,n:11,fin:11,ultima:dia(-10)}], hoy).has(1));

// --- ciclo incremental
store.config = JSON.stringify({ activo: true, ligas: [{ competicion: "hypermotion", leagueId: "4400", rondas: 42 }] });
rowsPlan = filas;
store.estado = JSON.stringify({ ultimo_ciclo_completo: new Date(ahoraFalso - 24 * 3600e3).toISOString(), ultimo_ciclo_fin: new Date(ahoraFalso - 24 * 3600e3).toISOString() });
let r = await ctx.syncEjecutarPasada({ DB: mkDB() }, { modo: "ciclo" });
let est = JSON.parse(store.estado);
const rondasPedidas = fetchLog.map((u) => +/r=(\d+)/.exec(u)[1]);
t("ciclo incremental pide solo 8..11", JSON.stringify(rondasPedidas) === "[8,9,10,11]", JSON.stringify(rondasPedidas));
t("ciclo diario normal es incremental", est.ciclo_completo === false);

// segundo ciclo (ya hay ultimo_ciclo_completo)
est.ciclo_en_curso = false; est.ultimo_ciclo_fin = new Date(ahoraFalso - 23 * 3600e3).toISOString(); est.cursores = {}; est.ultimo_ciclo_completo = new Date(ahoraFalso - 2 * 864e5).toISOString();
store.estado = JSON.stringify(est); fetchLog.length = 0;
r = await ctx.syncEjecutarPasada({ DB: mkDB() }, { modo: "ciclo" });
est = JSON.parse(store.estado);
t("2.o ciclo es incremental", est.ciclo_completo === false);
t("2.o ciclo pide 8..11", JSON.stringify(fetchLog.map((u) => +/r=(\d+)/.exec(u)[1])) === "[8,9,10,11]", fetchLog.length + " peticiones");
t("ultima_pasada registra peticiones_api y rondas_omitidas", est.ultima_pasada.peticiones_api === 4 && est.ultima_pasada.rondas_omitidas > 0, JSON.stringify(est.ultima_pasada));

// manual = completo
est.ciclo_en_curso = false; store.estado = JSON.stringify(est); fetchLog.length = 0;
r = await ctx.syncEjecutarPasada({ DB: mkDB() }, { modo: "ciclo", reiniciar: true, forzar: true });
t("manual pide rondas completas (>=30 en una pasada)", fetchLog.length >= 30, fetchLog.length + " peticiones");

// --- vivo
const aMadrid = (ms) => { const p = ctx.syncPartesMadrid(new Date(ms)); return `${p.fecha}T${p.hora}`; };
store.estado = JSON.stringify({ ultimo_ciclo_fin: new Date(ahoraFalso).toISOString() });
rowsCand = [{ id: 1, competicion: "hypermotion", grupo: null, jornada: 8, fecha_partido: aMadrid(ahoraFalso - 30 * 60e3) }];
fetchLog.length = 0; escriturasSettings = 0;
r = await ctx.syncEjecutarPasada({ DB: mkDB() }, { modo: "vivo" });
t("vivo: partido empezado hace 30 min NO se consulta", fetchLog.length === 0 && escriturasSettings === 0, `${fetchLog.length} peticiones, ${escriturasSettings} escrituras`);

rowsCand = [{ id: 1, competicion: "hypermotion", grupo: null, jornada: 8, fecha_partido: aMadrid(ahoraFalso - 130 * 60e3) }];
let total = 0;
const esperas = [];
for (let i = 0; i < 80; i++) {
  fetchLog.length = 0;
  await ctx.syncEjecutarPasada({ DB: mkDB() }, { modo: "vivo" });
  if (fetchLog.length) { total++; esperas.push(i * 5); }
  ahoraFalso += 5 * 60e3;
}
t("vivo: reintentos limitados a 6 en ~6 h (antes ~80 en 6,7 h)", total === 6, `intentos=${total} en minutos ${esperas.join(",")}`);

console.log(`\n${ok} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
