-- Migración: login de lectores con cuenta de X (antigua Twitter),
-- además del login con correo+contraseña, Google
-- (migracion_readers_google.sql), Microsoft
-- (migracion_readers_microsoft.sql) y Discord
-- (migracion_readers_discord.sql). Mismo patrón: se añade una columna
-- "x_id" (el "id" único que da la API de X en /2/users/me) además de
-- las otras; una cuenta puede tener varias rellenas si el lector ha
-- entrado alguna vez con cada proveedor.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, mismo
-- motivo que con Google/Microsoft/Discord: para una cuenta que entra
-- solo con X, el código (ver /api/readers/x/callback en src/index.js)
-- guarda ahí un hash de una contraseña aleatoria que nadie conoce ni
-- puede reproducir, en vez de NULL.
--
-- OJO: a diferencia de Google/Microsoft/Discord, el tier gratuito de la
-- API de X no da el email real del usuario, así que el código guarda
-- en "email" un valor sintético (x-<id>@x.elotrofutbol.media, no
-- entregable de verdad) solo para cumplir el NOT NULL de esa columna
-- sin tocar el esquema. Ver el comentario largo en
-- /api/readers/x/iniciar (src/index.js) para el porqué y lo que queda
-- pendiente de decidir sobre esto.

ALTER TABLE readers ADD COLUMN x_id TEXT;

CREATE INDEX IF NOT EXISTS idx_readers_x_id ON readers(x_id);
