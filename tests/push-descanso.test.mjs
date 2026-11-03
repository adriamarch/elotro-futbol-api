// Aviso push de descanso: solo en partidos CUBIERTOS (nunca en los no cubiertos).
import fs from "fs"; import vm from "vm";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };

for (const ruta of ["worker/src/index.js", "worker-secondary/src/index.js"]) {
  const src = fs.readFileSync(root + ruta, "utf8");
  const a = src.indexOf("async function partidoTieneCoberturaManual"), b = src.indexOf("// Limite sencillo por IP y hora (KV)", a);
  if (a < 0 || b < 0) throw new Error("no encuentro notificarPushPartido en " + ruta);
  const envio = [];
  const ctx = vm.createContext({ console, Number, parseInt, String, SITIO_URL: "https://x.test",
    pushRecortar: (s) => s, pushEnviarATopico: async (env, tema, msg) => { envio.push({ tema, msg }); } });
  vm.runInContext(src.slice(a, b) + "\nthis.notif = notificarPushPartido;", ctx);

  // partido simulado: fila de results + tipos de eventos presentes
  const escenario = ({ estado = "en_juego", noCubierto = 0, eventos = [] } = {}) => ({ DB: { prepare: (sql) => { const q = { bind: () => q,
    first: async () => (sql.includes("FROM results") ? { equipo_local: "A", equipo_visitante: "B", goles_local: 1, goles_visitante: 0, estado, finalizado_no_cubierto: noCubierto }
      : sql.includes("FROM match_events") ? (eventos.some((e) => !["inicio_partido", "descanso", "fin_descanso", "fin_partido"].includes(e)) ? { x: 1 } : null) : null) }; return q; } } });
  const lanza = async (esc, evento) => { envio.length = 0; await ctx.notif(esc, 5, "descanso", evento); return envio.length; };

  t(`${ruta}: descanso pitado a mano => avisa`, await lanza(escenario(), { automatico: false }) === 1);
  t(`${ruta}: el aviso trae 'Descanso' y el marcador`, /Descanso/.test(envio[0].msg.titulo) && envio[0].msg.cuerpo === "A 1-0 B" && envio[0].tema === "partidos");
  t(`${ruta}: descanso automático con goles puestos a mano => avisa (cubierto)`, await lanza(escenario({ eventos: ["inicio_partido", "gol"] }), { automatico: true }) === 1);
  t(`${ruta}: descanso automático sin eventos a mano => NO avisa (sin cubrir)`, await lanza(escenario({ eventos: ["inicio_partido"] }), { automatico: true }) === 0);
  t(`${ruta}: descanso automático solo con eventos del cron => NO avisa`, await lanza(escenario({ eventos: ["inicio_partido", "descanso"] }), { automatico: true }) === 0);
  t(`${ruta}: partido marcado no cubierto => NO avisa ni pitado a mano`, await lanza(escenario({ noCubierto: 1 }), { automatico: false }) === 0);
  t(`${ruta}: partido que no está en juego => NO avisa`, await lanza(escenario({ estado: "finalizado" }), { automatico: false }) === 0);
}

const src = fs.readFileSync(root + "worker/src/index.js", "utf8");
t("el descanso manual del panel dispara el aviso", src.includes('if (body.tipo === "descanso") ctx.waitUntil(notificarPushPartido(env, resultadoId, "descanso"'));
t("el descanso automático del cron dispara el aviso (filtrado por cobertura)", src.includes('await notificarPushPartido(env, partido.id, "descanso", { automatico: true });'));
console.log(`\n${ok} ok, ${fail} fallos`); process.exit(fail ? 1 : 0);
