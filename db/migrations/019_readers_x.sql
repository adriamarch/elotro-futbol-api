-- Migración 019: login de lectores con cuenta de X, antigua Twitter
-- (equivalente a worker/migracion_readers_x.sql en D1, aplicada aquí a
-- Postgres para que el esquema de ambas bases coincida).
--
-- "x_id" guarda el "id" único que da la API de X en /2/users/me, y es
-- la clave con la que se reconoce al lector en logins posteriores.
--
-- A diferencia de las migraciones 016 (Google), 017 (Microsoft) y 018
-- (Discord), aquí NO hay vinculación automática por email a una cuenta
-- existente: el tier gratuito de la API de X no da el email real del
-- usuario, así que no hay con qué comparar. Cada login con X que no
-- coincida por x_id crea una cuenta nueva con un email sintético (ver
-- comentario largo en /api/readers/x/iniciar, src/index.js).
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, mismo
-- motivo que en las migraciones anteriores: para una cuenta que entra
-- solo con X, el propio código (ver /api/readers/x/callback en
-- src/index.js) guarda ahí un hash de una contraseña aleatoria que
-- nadie conoce ni puede reproducir, en vez de NULL.

BEGIN;

ALTER TABLE readers ADD COLUMN IF NOT EXISTS x_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_readers_x_id ON readers(x_id);

COMMIT;
