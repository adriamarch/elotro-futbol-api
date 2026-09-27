-- Migración: añade "visibilidad" a la tabla "media" (contenido subido
-- desde "Subir contenido"), para poder marcar una foto/vídeo como
-- público (aparece en las galerías públicas del sitio) o privado (solo
-- visible en el panel de administración, para el equipo de redacción).
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media_visibilidad.sql

ALTER TABLE media ADD COLUMN visibilidad TEXT NOT NULL DEFAULT 'publico';

CREATE INDEX IF NOT EXISTS idx_media_visibilidad ON media(visibilidad);
