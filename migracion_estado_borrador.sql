-- Migración: añade la columna "estado_borrador" a los artículos.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye la columna.
--
-- Sirve para distinguir, dentro de los borradores (publicado = 0), si el
-- redactor considera la noticia "terminada" (lista para revisión/
-- publicación, así que se avisa por email a la redacción) o "en_proceso"
-- (la sigue escribiendo, así que no se manda correo). Se pregunta con una
-- notificación en el panel justo al guardar como borrador.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_estado_borrador.sql

ALTER TABLE articles ADD COLUMN estado_borrador TEXT;
