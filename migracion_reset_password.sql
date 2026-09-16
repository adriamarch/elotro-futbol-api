-- Migración: recuperación de contraseña real por email (con token de un
-- solo uso y caducidad), en vez del formulario anterior que cambiaba la
-- contraseña con solo usuario + correo sin ninguna verificación.
--
-- Ejecutar con:
-- wrangler d1 execute elotrofutbol --remote --file=migracion_reset_password.sql

ALTER TABLE users ADD COLUMN reset_token TEXT;
ALTER TABLE users ADD COLUMN reset_token_expira TEXT;
