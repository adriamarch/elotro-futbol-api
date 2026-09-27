-- Migración: añade las columnas "fecha_preferencia_desde" y
-- "fecha_preferencia_hasta" a los artículos.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye las columnas.
--
-- Permite al REDACTOR, al marcar su borrador como "terminado" (listo
-- para que lo revisen), sugerir opcionalmente un rango de fechas en el
-- que le gustaría que se publicase la noticia. Son fechas simples
-- (YYYY-MM-DD, sin hora), puramente informativas: no programan nada ni
-- afectan a "publicado". Quien tenga permiso de publicar la ve en el
-- listado del panel como referencia.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_fecha_preferencia_publicacion.sql

ALTER TABLE articles ADD COLUMN fecha_preferencia_desde TEXT;
ALTER TABLE articles ADD COLUMN fecha_preferencia_hasta TEXT;
