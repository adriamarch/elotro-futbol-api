-- Migración: añade "notif_visto_at" a la tabla de usuarios, para guardar
-- en el servidor (no solo en localStorage del navegador) la última vez
-- que cada persona ha visto las novedades del panel. Así, si se pierde
-- la sesión o se borran las cookies/datos del navegador, al volver a
-- iniciar sesión no le vuelven a salir como nuevas las novedades que ya
-- había visto.
--
-- Ejecutar SOLO si la base de datos ya existía antes de este cambio.
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_notif_visto.sql

ALTER TABLE users ADD COLUMN notif_visto_at TEXT;
