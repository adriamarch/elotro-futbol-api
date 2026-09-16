-- Migración: añade la tabla "media" (contenido subido por redactores:
-- fotos y vídeos) sin tocar el resto de datos ya existentes.
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media.sql
--
-- IMPORTANTE: antes de usar esta función también hace falta crear la
-- cuenta de Cloudinary donde se guardan los archivos en sí (ver README,
-- apartado "Contenido multimedia (Cloudinary)").

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloudinary_public_id TEXT UNIQUE NOT NULL,
  cloudinary_resource_type TEXT NOT NULL,
  cloudinary_url TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano_bytes INTEGER NOT NULL,
  autor_id INTEGER,
  autor_nombre TEXT,
  club TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at);
