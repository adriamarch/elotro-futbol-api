-- Migración: añade la columna "programado_para" a los artículos.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye la columna.
--
-- Permite a un administrador dejar una noticia escrita y programada para
-- que se publique ella sola en la fecha/hora que elija, sin tener que
-- entrar al panel a esa hora. Mientras "programado_para" tenga una fecha
-- futura, la noticia se guarda con publicado = 0 (no se ve en la web) y
-- un disparador (cron) del Worker revisa cada minuto si ya le toca
-- publicarse; en ese momento la marca como publicado = 1 y limpia esta
-- columna, exactamente igual que si un admin la hubiera publicado a mano.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_programado.sql

ALTER TABLE articles ADD COLUMN programado_para TEXT;
