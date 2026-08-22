import { createD1CompatDb } from "./src/postgres-db.js";

const db = createD1CompatDb();

const vistas = await db.prepare("SELECT COUNT(*) c FROM article_views").first();
console.log("vistas:", vistas.c);

const lecturas = await db.prepare("SELECT COUNT(*) c FROM article_reading").first();
console.log("lecturas:", lecturas.c);

const filas = await db.prepare(
  "SELECT segundos, scroll_maximo, created_at FROM article_reading ORDER BY created_at DESC LIMIT 10"
).all();
console.log(JSON.stringify(filas.results, null, 2));

const huerfanas = await db.prepare(
  `SELECT COUNT(*) c FROM article_views v
   WHERE NOT EXISTS (SELECT 1 FROM article_reading r WHERE r.view_id = v.id)`
).first();
console.log("vistas SIN lectura asociada:", huerfanas.c);

process.exit(0);
