-- Migración 017: login de lectores con cuenta de Microsoft (equivalente
-- a worker/migracion_readers_microsoft.sql en D1, aplicada aquí a
-- Postgres para que el esquema de ambas bases coincida).
--
-- "microsoft_id" guarda el "oid" (o "sub" como respaldo) del token de
-- Microsoft Identity Platform, y es la clave con la que se reconoce al
-- lector en logins posteriores. Vinculación automática por email: si el
-- correo de la cuenta de Microsoft coincide con un lector ya registrado
-- (con contraseña o con Google), se vincula microsoft_id a esa cuenta
-- existente en vez de duplicarla.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, mismo
-- motivo que en la migración 016 de Google: para una cuenta que entra
-- solo con Microsoft, el propio código (ver /api/readers/microsoft en
-- src/index.js) guarda ahí un hash de una contraseña aleatoria que
-- nadie conoce ni puede reproducir, en vez de NULL.

BEGIN;

ALTER TABLE readers ADD COLUMN IF NOT EXISTS microsoft_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_readers_microsoft_id ON readers(microsoft_id);

COMMIT;
