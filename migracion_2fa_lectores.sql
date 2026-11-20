-- Migración: verificación en dos pasos (TOTP) OPCIONAL para lectores con contraseña.
-- Versión para D1 (principal). La de PostgreSQL es worker-secondary/db/migrations/081_2fa_lectores.sql.
-- Si no se ejecutan, el Worker crea estas columnas solo la primera vez que se usa el 2FA de lectores.
--
--   totp_secret       secreto TOTP CIFRADO (AES-GCM, clave derivada de JWT_SECRET)
--   totp_activo       1 cuando el lector ya ha confirmado su app de autenticación
--   totp_ultimo_paso  último intervalo de 30 s aceptado (impide reutilizar un código)
--   totp_recovery     JSON con los HASHES de los códigos de recuperación sin usar
--
-- ORDEN DE DESPLIEGUE (importante): la tabla "readers" se sincroniza a Postgres en modo
-- autoritativo y, si D1 tiene columnas que Postgres no tiene, el sincronizador aborta la tabla
-- entera en esa pasada. Por tanto:
--   1) PostgreSQL primero: worker-secondary/db/migrations/081_2fa_lectores.sql
--      (node scripts/migrate.mjs en worker-secondary; ya usa BIGINT e IF NOT EXISTS).
--   2) Después D1 con este archivo:
--      wrangler d1 execute elotrofutbol --remote --file=./migracion_2fa_lectores.sql
--   3) Desplegar los dos workers y comprobar en los logs del sincronizador que "readers" no
--      muestra el error "Columnas D1 sin equivalente en PG".
-- (Este archivo es solo para D1/SQLite: no admite IF NOT EXISTS en ADD COLUMN.)

ALTER TABLE readers ADD COLUMN totp_secret TEXT;
ALTER TABLE readers ADD COLUMN totp_activo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE readers ADD COLUMN totp_ultimo_paso INTEGER;
ALTER TABLE readers ADD COLUMN totp_recovery TEXT;
