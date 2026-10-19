#!/usr/bin/env node
// Aplica las migraciones pendientes de la TIENDA en D1 (remota por defecto).
//
// Por qué existe: `wrangler d1 execute ... --remote --file=X.sql` NO manda el
// SQL en una petición normal a la API. Sube el fichero a una URL firmada
// aparte y luego pide a D1 que lo importe. Esa subida es la que falla con
// "fetch failed" en muchas redes (IPv6 roto, VPN, antivirus, proxy, Node 20+
// con autoselección de familia). Este script evita esa vía: lanza cada
// sentencia con `--command` (la petición normal de la API) y, además:
//
//   * es IDEMPOTENTE: mira qué columnas existen antes de hacer ALTER TABLE,
//     así que se puede volver a ejecutar sin el error "duplicate column name"
//     (cosa que el .sql original no permite: SQLite no tiene
//     ADD COLUMN IF NOT EXISTS);
//   * reintenta solo ante errores de red;
//   * fuerza IPv4 primero (--dns-result-order=ipv4first) y desactiva la
//     autoselección de familia de Node si tu versión lo soporta.
//
// Cubre lo mismo que:
//   worker/migracion_tienda_mejoras.sql       (stock, imagenes)
//   worker/migracion_tienda_pedido_codigo.sql (codigo, metodo_pago, entrega,
//                                              direccion_envio + backfill)
//
// Uso (desde la carpeta worker/):
//   node aplicar-migracion-tienda.mjs              # remota
//   node aplicar-migracion-tienda.mjs --dry-run    # solo muestra qué haría
//   node aplicar-migracion-tienda.mjs --local      # base local de wrangler
//   node aplicar-migracion-tienda.mjs --db=otra_bd # otro nombre de base

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CARPETA = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const LOCAL = args.includes("--local");
const DRY = args.includes("--dry-run");
const DB = (args.find((a) => a.startsWith("--db=")) || "--db=elotrofutbol").slice(5);
const REINTENTOS = 4;

// Columnas que debe tener cada tabla para que el Worker funcione.
const COLUMNAS = [
  { tabla: "tienda_productos", columna: "stock", tipo: "INTEGER" },
  { tabla: "tienda_productos", columna: "imagenes", tipo: "TEXT" },
  { tabla: "tienda_pedidos", columna: "codigo", tipo: "TEXT" },
  { tabla: "tienda_pedidos", columna: "metodo_pago", tipo: "TEXT" },
  { tabla: "tienda_pedidos", columna: "entrega", tipo: "TEXT" },
  { tabla: "tienda_pedidos", columna: "direccion_envio", tipo: "TEXT" },
];

// Backfill de pedidos anteriores (todos son seguros de repetir).
const RELLENOS = [
  "UPDATE tienda_pedidos SET codigo = 'EOF-' || printf('%04d', id) WHERE codigo IS NULL",
  "UPDATE tienda_pedidos SET metodo_pago = 'paypal' WHERE metodo_pago IS NULL AND referencia_pago LIKE '[PayPal]%'",
  "UPDATE tienda_pedidos SET metodo_pago = 'bizum' WHERE metodo_pago IS NULL AND referencia_pago LIKE '[Bizum]%'",
  "CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_codigo ON tienda_pedidos(codigo)",
];

// ---------------------------------------------------------------------------
// Cómo se lanza wrangler: con el propio node y el .js de wrangler, SIN shell.
// Así no hay problemas de comillas en Windows (el SQL lleva ' y %).
// ---------------------------------------------------------------------------
function resolverWrangler() {
  if (process.env.WRANGLER_JS) return { cmd: process.execPath, base: [process.env.WRANGLER_JS], shell: false };
  // Se busca por RUTA (require.resolve falla: wrangler no exporta bin/ en su
  // package.json). Sube por las carpetas por si node_modules está más arriba.
  let dir = CARPETA;
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, "node_modules", "wrangler", "bin", "wrangler.js");
    if (existsSync(candidato)) return { cmd: process.execPath, base: [candidato], shell: false };
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  // Último recurso: npx. En Windows requiere shell, y con shell los
  // argumentos NO se entrecomillan solos: se hace a mano (el SQL lleva espacios).
  const win = process.platform === "win32";
  return { cmd: win ? "npx.cmd" : "npx", base: ["wrangler"], shell: win, citar: win };
}

function entornoRed() {
  const flags = [];
  const quiero = ["--dns-result-order=ipv4first", "--no-network-family-autoselection"];
  for (const f of quiero) {
    // Solo se añade si esta versión de Node la admite en NODE_OPTIONS;
    // si no, Node abortaría con "is not allowed in NODE_OPTIONS".
    if (process.allowedNodeEnvironmentFlags.has(f)) flags.push(f);
  }
  const previo = process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : "";
  return { ...process.env, NODE_OPTIONS: previo + flags.join(" "), WRANGLER_SEND_METRICS: "false" };
}

const WR = resolverWrangler();
const ENV = entornoRed();
const ES_RED = /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|network/i;
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function ejecutar(sql) {
  let argv = [...WR.base, "d1", "execute", DB, LOCAL ? "--local" : "--remote", "--json", "--command", sql];
  if (WR.citar) argv = argv.map((a) => (/[\s"()%'\[\]|]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  let ultimo = "";
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    const r = spawnSync(WR.cmd, argv, { cwd: CARPETA, env: ENV, encoding: "utf8", shell: WR.shell, maxBuffer: 64 * 1024 * 1024 });
    const salida = `${r.stdout || ""}\n${r.stderr || ""}`;
    if (r.status === 0) return parsearJson(r.stdout || "");
    ultimo = salida.trim();
    if (!ES_RED.test(salida) || intento === REINTENTOS) break;
    const espera = 1500 * intento;
    console.log(`   ↻ error de red (intento ${intento}/${REINTENTOS}), reintento en ${espera / 1000}s...`);
    dormir(espera);
  }
  const e = new Error(ultimo || "wrangler terminó con error sin mensaje");
  e.red = ES_RED.test(ultimo);
  throw e;
}

// wrangler puede imprimir un banner antes del JSON: se busca el primer '['.
function parsearJson(texto) {
  const i = texto.indexOf("[");
  if (i < 0) return [];
  try { return JSON.parse(texto.slice(i)); } catch { return []; }
}

const filas = (resp) => (resp && resp[0] && resp[0].results) || [];

function columnasDe(tabla) {
  return new Set(filas(ejecutar(`PRAGMA table_info(${tabla})`)).map((f) => f.name));
}

function ayudaRed(err) {
  console.error("\n❌ No se pudo hablar con Cloudflare (error de red):\n");
  console.error("   " + String(err.message).split("\n").slice(0, 6).join("\n   "));
  console.error(`
Qué probar, por orden:
  1. npx wrangler whoami            -> ¿sigues logueado? Si no: npx wrangler login
  2. Desactiva VPN / proxy / antivirus con "análisis web" un momento.
  3. Actualiza wrangler:  npm i -D wrangler@latest   (en worker/)
  4. Prueba con otra red (datos del móvil) para descartar el router/IPv6.
  5. Variable de entorno una sola vez:
       PowerShell:  $env:NODE_OPTIONS="--dns-result-order=ipv4first"
       bash/zsh:    export NODE_OPTIONS=--dns-result-order=ipv4first
  Cuando vuelva la conexión, repite el mismo comando: es idempotente.
`);
}

function main() {
  console.log(`\nMigración de la tienda -> base "${DB}" (${LOCAL ? "local" : "remota"})${DRY ? "  [DRY-RUN]" : ""}\n`);

  const porTabla = {};
  for (const t of new Set(COLUMNAS.map((c) => c.tabla))) {
    const cols = columnasDe(t);
    if (!cols.size) {
      console.error(`❌ La tabla ${t} no existe. Ejecuta primero:\n   wrangler d1 execute ${DB} ${LOCAL ? "--local" : "--remote"} --file=migracion_tienda.sql\n`);
      process.exit(1);
    }
    porTabla[t] = cols;
  }

  let cambios = 0;
  for (const { tabla, columna, tipo } of COLUMNAS) {
    if (porTabla[tabla].has(columna)) { console.log(`✓ ${tabla}.${columna} ya existe`); continue; }
    const sql = `ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`;
    console.log(`+ ${sql}`);
    if (!DRY) ejecutar(sql);
    cambios++;
  }

  // Los rellenos solo tienen sentido cuando las columnas ya están (en dry-run
  // con columnas por crear se omiten para no inventar errores).
  const faltaCodigo = !porTabla.tienda_pedidos.has("codigo");
  if (DRY && faltaCodigo) {
    console.log("… (dry-run) los UPDATE de rellenado se ejecutarían después de crear las columnas");
  } else {
    for (const sql of RELLENOS) {
      console.log(`~ ${sql.length > 96 ? sql.slice(0, 93) + "..." : sql}`);
      if (!DRY) ejecutar(sql);
    }
  }

  if (!DRY) {
    const v = filas(ejecutar("SELECT COUNT(*) AS total, SUM(codigo IS NULL) AS sin_codigo FROM tienda_pedidos"))[0] || {};
    console.log(`\n✅ Hecho. Pedidos: ${v.total ?? 0}, sin número de pedido: ${v.sin_codigo ?? 0}. Columnas nuevas: ${cambios}.`);
  } else {
    console.log(`\n(dry-run) Columnas que se añadirían: ${cambios}.`);
  }
}

try {
  main();
} catch (err) {
  if (err.red) ayudaRed(err);
  else console.error("\n❌ Error de wrangler/D1:\n\n" + err.message + "\n");
  process.exit(1);
}
