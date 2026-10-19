import fs from "fs"; import vm from "vm";
const root = new URL("../../", import.meta.url).pathname;
// --- panel
const mam = fs.readFileSync(root + "public/admin/js/minuto-a-minuto.js", "utf8");
const fn = mam.slice(mam.indexOf("function mamEnSegundaParte"), mam.indexOf("// Minuto del reloj en texto"));
const adm = fs.readFileSync(root + "public/admin/js/admin.js", "utf8");
const div = adm.slice(adm.indexOf("function dividirMinutoConAñadido"), adm.indexOf("// Calcula el minuto en vivo de un resultado cualquiera"));
const c = vm.createContext({ MAM_EVENTOS: [], MAM_RESULTADO: null, parseInt, Number });
vm.runInContext(fn + div + "\nthis.seg=mamEnSegundaParte; this.div=dividirMinutoConAñadido;", c);
let ok = 0, fail = 0; const t = (n, x) => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n); };
const texto = (m) => { const d = c.div(m, null, c.seg()); return d.minutoExtra ? `${d.minuto}+${d.minutoExtra}` : `${d.minuto}`; };
c.MAM_RESULTADO = { inicio_cronometro_at: "2026-10-10 10:00:00", cronometro_pausado_en: null };
c.MAM_EVENTOS = []; t("1a parte, minuto 47 => 45+2", texto(47) === "45+2");
c.MAM_RESULTADO = { inicio_cronometro_at: "x", cronometro_pausado_en: 45 };
c.MAM_EVENTOS = [{ tipo: "descanso" }]; t("en el descanso (parado) sigue siendo 1a parte", c.seg() === false);
c.MAM_RESULTADO = { inicio_cronometro_at: "x", cronometro_pausado_en: null };
t("descanso auto reanudado, evento aun sin recargar => 47", texto(47) === "47");
c.MAM_EVENTOS = [{ tipo: "descanso" }, { tipo: "fin_descanso" }]; t("con fin_descanso => 47", texto(47) === "47");
t("2a parte 93 => 90+3", texto(93) === "90+3");
// --- servidor: el evento va antes que el arranque
const src = fs.readFileSync(root + "worker/src/index.js", "utf8");
const a = src.indexOf("const MINUTOS_DESCANSO_AUTOMATICO"), b = src.indexOf("// Minuto real (de cronómetro) a partir del cual");
const log = [];
const env = { DB: { prepare: (sql) => { const q = { bind: (...x) => q, all: async () => ({ results: [{ id: 1, cronometro_pausado_en: 45 }] }),
  first: async () => ({ tipo: "descanso", var_motivo: "automatico", created_at: "2000-01-01 10:00:00" }),
  run: async () => { log.push(sql.includes("INSERT INTO match_events") ? "evento" : sql.includes("DELETE") ? "borrar" : "otro"); return {}; } }; return q; } } };
const c2 = vm.createContext({ console, Date, Number, Math, MINUTO_DESCANSO_AUTOMATICO: 45, fechaBdAMs: (v) => Date.parse(v.replace(" ", "T") + "Z"),
  iniciarCronometroPartido: async () => { log.push("cronometro"); } });
vm.runInContext(src.slice(a, b) + "\nthis.f = reanudarSegundaParteAutomatica;", c2);
await c2.f(env, null);
t("servidor: primero el evento, luego el cronometro", log.join(",") === "evento,cronometro", log.join(","));
log.length = 0; c2.iniciarCronometroPartido = async () => { throw new Error("fallo"); };
await c2.f(env, null);
t("servidor: si falla el cronometro se retira el evento", log.join(",") === "evento,borrar", log.join(","));
console.log(`\n${ok} ok, ${fail} fallos`); process.exit(fail ? 1 : 0);
