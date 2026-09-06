-- Migración 018: login de lectores con cuenta de Discord (equivalente a
-- worker/migracion_readers_discord.sql en D1, aplicada aquí a Postgres
-- para que el esquema de ambas bases coincida).
--
-- "discord_id" guarda el "id" numérico único que da la API de Discord
-- en /users/@me, y es la clave con la que se reconoce al lector en
-- logins posteriores. Vinculación automática por email: si el correo
-- de la cuenta de Discord coincide con un lector ya registrado (con
-- contraseña, Google o Microsoft), se vincula discord_id a esa cuenta
-- existente en vez de duplicarla.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, mismo
-- motivo que en las migraciones 016 (Google) y 017 (Microsoft): para
-- una cuenta que entra solo con Discord, el propio código (ver
-- /api/readers/discord/callback en src/index.js) guarda ahí un hash de
-- una contraseña aleatoria que nadie conoce ni puede reproducir, en
-- vez de NULL.

BEGIN;

ALTER TABLE readers ADD COLUMN IF NOT EXISTS discord_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_readers_discord_id ON readers(discord_id);

COMMIT;
