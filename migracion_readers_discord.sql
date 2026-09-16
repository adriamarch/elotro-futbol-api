-- Migración: login de lectores con cuenta de Discord, además del login
-- con correo+contraseña, Google (migracion_readers_google.sql) y
-- Microsoft (migracion_readers_microsoft.sql). Mismo patrón: se añade
-- una columna "discord_id" (el "id" numérico único que da la API de
-- Discord en /users/@me) además de las otras; una cuenta puede tener
-- varias rellenas si el lector ha entrado alguna vez con cada
-- proveedor.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, mismo
-- motivo que con Google/Microsoft: para una cuenta que entra solo con
-- Discord, el código (ver /api/readers/discord/callback en
-- src/index.js) guarda ahí un hash de una contraseña aleatoria que
-- nadie conoce ni puede reproducir, en vez de NULL.

ALTER TABLE readers ADD COLUMN discord_id TEXT;

CREATE INDEX IF NOT EXISTS idx_readers_discord_id ON readers(discord_id);
