// Comprobación de seguridad antes de desplegar. Lee wrangler.toml en
// ESTA carpeta (worker/) y verifica que existe y que su "name" es el
// esperado (elotrofutbol-api), NO el del worker de assets estáticos
// (elotrofutboltv, en la raíz del proyecto/public). Aborta el deploy
// si algo no cuadra, en vez de dejar que "wrangler deploy" suba
// silenciosamente al padre y sobreescriba el worker equivocado -que es
// justo lo que pasó el 24/08/2026: se corrió el deploy desde esta
// carpeta pero acabó subiendo "elotrofutboltv" (el de public/) en vez
// de "elotrofutbol-api" (este, el de la API con D1/Hyperdrive).
const fs = require("fs");
const path = require("path");

const WORKER_NAME_ESPERADO = "elotrofutbol-api";
const tomlPath = path.join(__dirname, "wrangler.toml");

if (!fs.existsSync(tomlPath)) {
  console.error(`\n❌ No se encuentra ${tomlPath}.`);
  console.error("   Estás en la carpeta equivocada, o el archivo se ha perdido/movido.");
  console.error("   NO se ejecuta el deploy.\n");
  process.exit(1);
}

const contenido = fs.readFileSync(tomlPath, "utf8");
const match = contenido.match(/^\s*name\s*=\s*"([^"]+)"/m);
const nombreEncontrado = match ? match[1] : null;

if (nombreEncontrado !== WORKER_NAME_ESPERADO) {
  console.error(`\n❌ El wrangler.toml de esta carpeta declara name="${nombreEncontrado}".`);
  console.error(`   Se esperaba "${WORKER_NAME_ESPERADO}" (el worker de la API).`);
  console.error("   NO se ejecuta el deploy: revisa qué wrangler.toml se está usando.\n");
  process.exit(1);
}

console.log(`✅ wrangler.toml correcto (name="${nombreEncontrado}"). Desplegando...`);
