-- Migración: motivo de las tarjetas en el panel de Minuto a Minuto.
--
-- Permite indicar por qué se saca una amarilla (o doble amarilla / roja):
-- "Falta", "Protestas", "Pérdida de tiempo"... Texto libre corto, NULL si
-- no se indica. Solo se rellena en eventos de tarjeta.
--
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_motivo_tarjeta.sql
--
-- Si la base de datos es nueva, ignora este archivo: schema.sql ya lo incluye.
ALTER TABLE match_events ADD COLUMN motivo_tarjeta TEXT;
