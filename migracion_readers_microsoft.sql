-- Migración: login de lectores con cuenta de Microsoft, además del login
-- con correo+contraseña (migracion_readers.sql) y con Google
-- (migracion_readers_google.sql). Mismo patrón que Google: se añade una
-- columna "microsoft_id" (el "sub"/"oid" del token de Microsoft Entra
-- ID) además de "google_id"; una cuenta puede tener las dos rellenas si
-- el lector ha entrado alguna vez con cada proveedor.
--
-- A propósito NO se toca el NOT NULL de password_hash/salt, por el
-- mismo motivo que con Google: para una cuenta que entra solo con
-- Microsoft, el código (ver /api/readers/microsoft en src/index.js)
-- guarda ahí un hash de una contraseña aleatoria que nadie conoce ni
-- puede reproducir, en vez de NULL. Quitar ese NOT NULL en SQLite
-- obligaría a recrear la tabla entera (SQLite no tiene "ALTER COLUMN
-- ... DROP NOT NULL"), lo que chocaría con las claves foráneas de
-- reader_sessions, comments, encuestas, porras... que apuntan a
-- readers(id).

ALTER TABLE readers ADD COLUMN microsoft_id TEXT;

CREATE INDEX IF NOT EXISTS idx_readers_microsoft_id ON readers(microsoft_id);
