-- Migración: añade a "users" el perfil público del redactor/admin
-- (biografía, foto y redes sociales propias) para poder tener una
-- página de autor (autor.html) enlazada desde el nombre en sus
-- noticias, editable por cada persona desde "Ajustes de cuenta".
--
-- Ejecutar SOLO si la base de datos ya existía antes de este cambio
-- (si es una base de datos nueva, usa schema.sql directamente, que ya
-- incluye estas columnas).
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_perfil_autores.sql

ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN redes_sociales TEXT;
