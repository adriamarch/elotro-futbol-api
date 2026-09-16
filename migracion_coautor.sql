-- Migración: añade un segundo autor (coautor) opcional a los artículos.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye las columnas.
--
-- El autor principal sigue siendo autor_id/autor_nombre (se usa para
-- permisos de edición, autor.html, SEO, etc. exactamente igual que
-- antes). El coautor es solo un segundo nombre que se firma junto al
-- principal en la portada, la ficha de la noticia y las tarjetas; no
-- tiene permisos de edición especiales por sí mismo.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_coautor.sql

ALTER TABLE articles ADD COLUMN coautor_id INTEGER REFERENCES users(id);
ALTER TABLE articles ADD COLUMN coautor_nombre TEXT;
