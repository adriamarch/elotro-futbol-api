-- Migración: permite elegir la portada (miniatura) de cada vídeo subido en
-- "Subir contenido". Se guarda el segundo exacto del vídeo que se usará
-- como fotograma de portada en la galería de contenido subido; si es NULL
-- se sigue usando el segundo 1 por defecto (comportamiento actual).
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media_portada.sql

ALTER TABLE media ADD COLUMN portada_segundo REAL;
