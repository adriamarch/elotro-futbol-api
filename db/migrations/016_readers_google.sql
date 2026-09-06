-- Migración 016: login de lectores con cuenta de Google (equivalente a
-- worker/migracion_readers_google.sql en D1, aplicada aquí a Postgres
-- para que el esquema de ambas bases coincida).
--
-- "google_id" guarda el "sub" del token de Google (identificador único
-- e inmutable), y es la clave con la que se reconoce al lector en
-- logins posteriores. Vinculación automática por email: si el correo
-- de la cuenta de Google coincide con un lector ya registrado con
-- contraseña, se vincula google_id a esa cuenta existente en vez de
-- duplicarla.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt (a
-- diferencia de una versión anterior de esta migración): para una
-- cuenta que entra solo con Google, el propio código (ver
-- /api/readers/google en src/index.js) guarda ahí un hash de una
-- contraseña aleatoria que nadie conoce ni puede reproducir, en vez de
-- NULL. Así se evita tocar una restricción de columna en una tabla con
-- claves foráneas entrantes desde varias otras (reader_sessions,
-- comments, encuestas, porras...), que en D1/SQLite obligó a recrear la
-- tabla entera y chocó con esas mismas foreign keys.

BEGIN;

ALTER TABLE readers ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_readers_google_id ON readers(google_id);

COMMIT;
