-- Migración: ficha técnica editable para crónicas.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye la columna.
--
-- Guarda, como JSON, los datos de la ficha técnica que un redactor
-- rellena a mano desde el formulario de la crónica (estadio, árbitro,
-- asistencia, goleadores, tarjetas, MVP...). Es independiente del
-- "Resultado vinculado" (tabla results): no hace falta tener un
-- partido registrado en "Resultados" para poder rellenar la ficha, y
-- si la crónica sí tiene un resultado vinculado, la ficha no se
-- recalcula sola a partir de él -- son datos aparte que el redactor
-- edita como quiera. NULL si la crónica no tiene ficha técnica
-- (incluida cualquier noticia/opinión/entrevista, que no la usan).
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_ficha_tecnica.sql

ALTER TABLE articles ADD COLUMN ficha_tecnica TEXT;
