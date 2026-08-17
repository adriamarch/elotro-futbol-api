// Cliente D1 compartido por todo el sincronizador (migración inicial,
// incremental y comparador). Todos pasan por aquí para que solo haya un
// sitio que sepa invocar Wrangler.
//
// D1 no expone una API HTTP directa sencilla para este proyecto, así que
// -igual que hacía worker-secondary/migrar-d1.cjs en su versión original-
// usamos `wrangler d1 execute --remote --json`. Se mantiene ese mismo
// mecanismo para no introducir una segunda vía de acceso a D1 con
// comportamiento distinto.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DB_NAME = process.env.D1_DATABASE_NAME || "elotrofutbol";

// En Windows, npx es en realidad "npx.cmd" (un script de shell), no un
// ejecutable directo. execFile() sin shell puede además lanzar
// "spawn EINVAL" al intentar invocar un .cmd directamente en algunas
// versiones de Node en Windows (problema conocido de Node en Windows con
// archivos .cmd/.bat: necesitan pasar por cmd.exe). La solución fiable en
// Windows es usar shell:true -pero eso reintroduce el problema de
// escapado que queríamos evitar (Node antepondría comillas dobles “a lo
// tonto” a cada argumento, y un SQL con comillas simples/dobres podría
// romper el parseo de cmd.exe)-. Por eso en Windows citamos manualmente
// cada argumento al estilo cmd.exe (doblando comillas dobres internas y
// envolviendo el argumento entero entre comillas) antes de unirlos en un
// único string y pasar shell:true; en el resto de plataformas seguimos
// usando execFile con el array de argumentos tal cual, sin shell.
const ES_WINDOWS = process.platform === "win32";
const NPX_CMD = ES_WINDOWS ? "npx.cmd" : "npx";
const D1_TIMEOUT_MS = Number(process.env.D1_TIMEOUT_MS || 120000);

function citarArgumentoWindows(arg) {
  // Escapa comillas dobres duplicándolas (regla de cmd.exe) y envuelve el
  // argumento completo entre comillas dobres para que espacios, comillas
  // simples y saltos de línea del SQL no rompan el parseo del shell.
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/**
 * Ejecuta una sentencia SQL de solo lectura contra D1 remoto.
 * Usa --command; para SELECT con parámetros dinámicos, este helper
 * construye el SQL ya interpolado de forma segura con escaparValorD1.
 */
export async function ejecutarD1(sql) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    DB_NAME,
    "--remote",
    "--command",
    sql,
    "--json",
  ];

  try {
    let stdout;
    if (ES_WINDOWS) {
      // shell:true + un único string ya citado a mano (ver nota arriba).
      const comando = [NPX_CMD, ...args.map(citarArgumentoWindows)].join(" ");
      ({ stdout } = await execFileAsync(comando, {
        shell: true,
        maxBuffer: 200 * 1024 * 1024,
        windowsHide: true,
          timeout: D1_TIMEOUT_MS,
        }));
    } else {
      // execFile con array de argumentos, sin shell: evita problemas de
      // escapado en Linux/Mac (el SQL entero viaja como un único argumento).
      ({ stdout } = await execFileAsync(NPX_CMD, args, {
        maxBuffer: 200 * 1024 * 1024,
        windowsHide: true,
          timeout: D1_TIMEOUT_MS,
        }));
    }

    const data = JSON.parse(stdout);

    if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0].results)) {
      throw new Error("Respuesta inesperada de Wrangler:\n" + stdout);
    }

    return data[0].results;
  } catch (error) {
    const stderr = error.stderr || "";
    const stdout = error.stdout || "";
    throw new Error(
      `Wrangler no pudo consultar D1: ${error.message}\n${stderr}\n${stdout}`
    );
  }
}

/**
 * Escapa un valor literal para incluirlo en SQL de D1 (SQLite).
 * Se usa solo para construir sentencias de solo lectura (SELECT ... WHERE
 * columna > 'valor'); no se usa para escribir en D1 (Fase 4 no escribe
 * nunca en D1 — D1 sigue siendo la única fuente de verdad).
 */
export function escaparValorD1(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export async function contarD1(table) {
  const rows = await ejecutarD1(`SELECT COUNT(*) AS total FROM ${table};`);
  return Number(rows[0]?.total || 0);
}
