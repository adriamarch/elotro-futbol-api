-- Migración: además del segundo del vídeo del que se saca la miniatura
-- (portada_segundo), permite elegir el punto de la imagen que no se debe
-- recortar nunca al generar esa miniatura de vídeo (mismo sistema de foco
-- "50% 50%" que ya usan las fotos de contenido). Si es NULL se sigue
-- usando el centro (comportamiento actual).
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media_portada_foco.sql

ALTER TABLE media ADD COLUMN portada_foco TEXT;
