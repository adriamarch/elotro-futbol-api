-- Migración: ubicación del partido (para los partidos "por jugar") y
-- enlace a Flashscore (para partidos ya finalizados de Primera Federación,
-- Segunda Federación y LaLiga Hypermotion/LaLiga2).
--
-- Solo hace falta ejecutar esto si la base de datos D1 ya estaba
-- desplegada ANTES de esta función. Si la base de datos es nueva,
-- ignora este archivo: schema.sql ya incluye estas columnas.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_partido_ubicacion_flashscore.sql

ALTER TABLE results ADD COLUMN ubicacion TEXT;
ALTER TABLE results ADD COLUMN flashscore_url TEXT;
