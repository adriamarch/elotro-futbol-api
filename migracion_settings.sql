-- Migración: añade la tabla "settings" para poder editar las redes
-- sociales del medio desde un único sitio (el panel de administración)
-- en vez de tener que tocar el código en varios archivos.
--
-- Ejecutar SOLO si la base de datos ya existía antes de este cambio
-- (si es una base de datos nueva, usa schema.sql directamente, que ya
-- incluye esta tabla).
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_settings.sql

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES (
  'redes_sociales',
  '{"twitter":"https://twitter.com/elotrofutbol","instagram":"https://instagram.com/elotrofutbol","tiktok":"https://tiktok.com/@elotrofutbol","youtube":"https://youtube.com/@elotrofutbol"}'
);
