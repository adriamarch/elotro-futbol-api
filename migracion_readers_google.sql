-- Migración: login de lectores con cuenta de Google, además del login
-- con correo+contraseña ya existente (ver migracion_readers.sql).
--
-- YA APLICADA en la base de producción (confirmado con
-- `wrangler d1 execute ... --command "PRAGMA table_info(readers);"`):
-- se dejan aquí solo los dos comandos que realmente hacían falta, por
-- si hay que aplicarlos alguna vez en otra base (una de pruebas, por
-- ejemplo).
--
-- A propósito NO se toca el NOT NULL de password_hash/salt: para una
-- cuenta que entra solo con Google, el propio código (ver
-- /api/readers/google en src/index.js) guarda ahí un hash de una
-- contraseña aleatoria que nadie conoce ni puede reproducir, en vez de
-- NULL. Intentar quitar ese NOT NULL en SQLite obliga a recrear la
-- tabla entera (SQLite no tiene "ALTER COLUMN ... DROP NOT NULL"), lo
-- que a su vez choca con las claves foráneas que otras tablas
-- (reader_sessions, comments, encuestas, porras...) tienen apuntando a
-- readers(id) -- por eso se optó por el hash de relleno en vez de
-- tocar el esquema.

ALTER TABLE readers ADD COLUMN google_id TEXT;
-- Si tu tabla "readers" TODAVÍA NO tiene "avatar_url", descomenta esto:
-- ALTER TABLE readers ADD COLUMN avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_readers_google_id ON readers(google_id);
