-- Migración: añade la columna "email" a los usuarios.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye la columna.
--
-- Esta columna se rellena la primera vez que cada persona inicia sesión
-- (el panel se lo pide automáticamente si está vacía) y permite recuperar
-- la contraseña desde el enlace "He olvidado mi contraseña" del login,
-- indicando usuario + correo electrónico.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_email.sql

ALTER TABLE users ADD COLUMN email TEXT;
