-- Migración: carpetas para el contenido PRIVADO de "Subir contenido".
--
-- Al subir contenido privado se puede elegir una carpeta (o crear una
-- nueva) y así "Ver contenido subido" se organiza por carpetas. Las
-- carpetas son compartidas por todo el equipo; solo tienen sentido en
-- contenido privado (si un archivo es público, carpeta_id queda en NULL).
--
-- media.carpeta_id: NULL = "Sin carpeta". Si se borra una carpeta, sus
-- archivos NO se borran: pasan a NULL (ON DELETE SET NULL).
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media_carpetas.sql
-- Si falla con "duplicate column name: carpeta_id", la columna ya estaba
-- añadida (la tabla y los índices son idempotentes).

CREATE TABLE IF NOT EXISTS media_carpetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  creada_por_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creada_por_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Un nombre de carpeta no se repite, sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_carpetas_nombre ON media_carpetas(LOWER(nombre));

ALTER TABLE media ADD COLUMN carpeta_id INTEGER REFERENCES media_carpetas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_carpeta ON media(carpeta_id);
