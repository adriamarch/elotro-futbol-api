-- Migración: añade la columna para guardar la imagen ya montada para
-- redes sociales (portada + título + categoría + fecha), generada
-- automáticamente al publicar un artículo.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye la columna.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_imagen_post.sql

ALTER TABLE articles ADD COLUMN imagen_post_url TEXT;
