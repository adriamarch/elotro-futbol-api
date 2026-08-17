-- Migración: MVP (jugador destacado) del partido.
--
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_mvp_partido.sql

-- Jugador elegido como MVP del partido (texto libre: "9 · Rodrigo",
-- solo dorsal o solo nombre, igual que el campo "jugador" de
-- match_events) y de qué equipo es, para poder pintar su escudo junto
-- al nombre. Los dos NULL = todavía no se ha marcado ningún MVP para
-- este partido (lo normal hasta que un redactor lo elija, desde el
-- panel de Minuto a Minuto o desde el panel normal de edición del
-- resultado).
ALTER TABLE results ADD COLUMN mvp_jugador TEXT;
ALTER TABLE results ADD COLUMN mvp_equipo TEXT; -- 'local' | 'visitante'
