// Ejecuta un archivo .sql de migración contra Postgres usando la misma
// librería "pg" que ya usa el proyecto (evita depender de tener el
// cliente "psql" instalado en el sistema, que en Windows no viene por
// defecto).
//
// Uso:
//   node scripts/run-migration.mjs db/migrations/022_categorias_adicionales.sql
//
// Requiere que la variable de entorno DATABASE_URL (o PG_CONNECTION_STRING,
// ver más abajo) apunte a la base de datos de Railway. Si usas un archivo
// .env, cárgalo antes, por ejemplo:
//   node -r dotenv/config scripts/run-migration.mjs db/migrations/022_categorias_adicionales.sql

import { readFileSync } from "node:fs";
import { Client } from "pg";

const archivo = process.argv[2];
if (!archivo) {
  console.error("Uso: node scripts/run-migration.mjs <ruta-al-archivo.sql>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("Falta la variable de entorno DATABASE_URL (o PG_CONNECTION_STRING) con la cadena de conexión a Postgres.");
  process.exit(1);
}

const sql = readFileSync(archivo, "utf-8");

const client = new Client({
  connectionString,
  ssl: connectionString.includes("railway") ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  console.log(`Conectado. Ejecutando ${archivo}...`);
  await client.query(sql);
  console.log("Migración aplicada correctamente.");
} catch (err) {
  console.error("Error aplicando la migración:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
