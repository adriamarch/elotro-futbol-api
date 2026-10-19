// Descarga los partidos de TheSportsDB desde GitHub Actions (sus IPs no estan
// bloqueadas como las de Cloudflare Workers) y los entrega al Worker.
// Variables: SYNC_API_URL (https://tu-dominio), SYNC_INGEST_TOKEN,
//            THESPORTSDB_API_KEY (opcional; por defecto la gratuita "123").
const BASE = (process.env.SYNC_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.SYNC_INGEST_TOKEN || "";
const CLAVE = process.env.THESPORTSDB_API_KEY || "123";
const premium = CLAVE !== "123" && CLAVE !== "3";
if (!BASE || !TOKEN) { console.error("Faltan SYNC_API_URL o SYNC_INGEST_TOKEN"); process.exit(1); }

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; ElOtroFutbol-sync/1.0)", Accept: "application/json" };

async function tsdb(ruta) {
  for (let intento = 0; intento < 4; intento++) {
    const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${CLAVE}/${ruta}`, { headers: UA });
    if (r.status === 429) { console.log("429: espero 65 s"); await dormir(65000); continue; }
    if (!r.ok) throw new Error(`TheSportsDB ${r.status} en ${ruta.split("?")[0]}`);
    await dormir(2200); // ~27 peticiones/min (limite gratuito: 30)
    return r.json();
  }
  throw new Error("TheSportsDB: 429 repetido");
}

async function worker(metodo, ruta, cuerpo) {
  const r = await fetch(`${BASE}/api/admin/sync-partidos/ingestar${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Worker ${r.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

const { temporada, ligas } = await worker("GET", "");
console.log(`Temporada ${temporada}, ${ligas.length} ligas`);
let fallos = 0;
for (const liga of ligas) {
  console.log(`== ${liga.clave} (${liga.leagueId})`);
  try {
    if (premium) {
      const d = await tsdb(`eventsseason.php?id=${liga.leagueId}&s=${encodeURIComponent(temporada)}`);
      const porRonda = new Map();
      for (const e of d?.events || []) { const k = parseInt(e.intRound, 10) || 0; porRonda.set(k, [...(porRonda.get(k) || []), e]); }
      for (const [ronda, eventos] of porRonda) await worker("POST", "", { clave: liga.clave, ronda, eventos });
    } else {
      let vacias = 0;
      for (let ronda = 1; ronda <= liga.rondas; ronda++) {
        const d = await tsdb(`eventsround.php?id=${liga.leagueId}&r=${ronda}&s=${encodeURIComponent(temporada)}`);
        const eventos = d?.events || [];
        if (!eventos.length) { if (++vacias >= 3) break; continue; }
        vacias = 0;
        const res = await worker("POST", "", { clave: liga.clave, ronda, eventos });
        console.log(`  ronda ${ronda}: ${eventos.length} eventos`, JSON.stringify(res.resumen || {}).slice(0, 120));
      }
    }
  } catch (err) { fallos++; console.error(`  ERROR ${liga.clave}: ${err.message}`); }
}
if (fallos) { console.error(`${fallos} liga(s) con error`); process.exit(1); }
console.log("Listo");
