// Genera la lista de los 90 nombres de archivo de escudo esperados para
// los 5 grupos de Segunda Federación, leyendo la lista de equipos
// DIRECTAMENTE de public/js/clubs.js (TODOS_LOS_CLUBES_SEGUNDA_FEDERACION),
// para no tener que mantener esa lista duplicada a mano en ningún otro
// sitio. Usa la MISMA función slugEquipo() que usa la web pública para
// resolver el escudo de cada club, así el nombre de archivo que aquí se
// imprime es exactamente el que hay que subir a public/img/escudos/.
//
// Uso:
//   node scripts/listar-escudos-segunda.mjs            -> lista completa, agrupada
//   node scripts/listar-escudos-segunda.mjs --faltantes -> solo los que aún no existen en public/img/escudos/

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clubsJsPath = join(__dirname, "..", "public", "js", "clubs.js");
const escudosDir = join(__dirname, "..", "public", "img", "escudos");

// slugEquipo() tal cual está en public/js/clubs.js (copiado aquí porque
// ese archivo no es un módulo importable directamente: se carga como
// <script> normal en el navegador, sin export).
function slugEquipo(nombre) {
  if (!nombre) return "";
  return nombre
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Extrae el objeto TODOS_LOS_CLUBES_SEGUNDA_FEDERACION del código fuente
// de clubs.js ejecutándolo en un contexto aislado (evita tener que
// mantener un parser propio o duplicar la lista a mano en este script).
const codigoFuente = readFileSync(clubsJsPath, "utf8");
const contexto = {};
// eslint-disable-next-line no-new-func
const fn = new Function(
  "exports",
  codigoFuente + "\nexports.TODOS_LOS_CLUBES_SEGUNDA_FEDERACION = TODOS_LOS_CLUBES_SEGUNDA_FEDERACION;"
);
fn(contexto);
const grupos = contexto.TODOS_LOS_CLUBES_SEGUNDA_FEDERACION;

if (!grupos) {
  console.error("No se ha podido leer TODOS_LOS_CLUBES_SEGUNDA_FEDERACION desde clubs.js");
  process.exit(1);
}

const soloFaltantes = process.argv.includes("--faltantes");
let total = 0;
let faltantes = 0;

for (const [grupo, equipos] of Object.entries(grupos)) {
  const lineas = [];
  for (const nombre of equipos) {
    total++;
    const archivo = `${slugEquipo(nombre)}.png`;
    const existe = existsSync(join(escudosDir, archivo));
    if (!existe) faltantes++;
    if (soloFaltantes && existe) continue;
    lineas.push(`  ${existe ? "[ya existe]" : "[ FALTA  ]"} ${nombre.padEnd(32)} -> ${archivo}`);
  }
  if (lineas.length) {
    console.log(`\n${grupo}:`);
    console.log(lineas.join("\n"));
  }
}

console.log(`\n--- Total: ${total} equipos, ${faltantes} escudos pendientes de subir ---`);
