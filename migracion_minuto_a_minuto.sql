-- Migración: Panel de MINUTO A MINUTO.
--
-- Añade a "results" el instante real en que el redactor pulsó "Iniciar
-- partido" desde el panel (para calcular el cronómetro en vivo) y amplía
-- "match_events" con los tipos de evento nuevos (descanso, cambios,
-- inicio/fin de partido, etc.) y los campos que necesita un cambio
-- (jugador que entra / jugador que sale).
--
-- Solo hace falta ejecutar esto si la base de datos D1 ya estaba
-- desplegada ANTES de esta función. Si la base de datos es nueva,
-- ignora este archivo: schema.sql ya lo incluye.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_minuto_a_minuto.sql

ALTER TABLE results ADD COLUMN inicio_cronometro_at TEXT;
-- Instante (UTC, formato datetime('now')) en que se pulsó "Iniciar
-- partido" en el panel de Minuto a Minuto. Se usa para calcular el
-- minuto en vivo en el propio navegador del redactor. NULL si el
-- partido no se ha iniciado nunca desde el panel (p. ej. resultados
-- introducidos a mano después del partido).

ALTER TABLE results ADD COLUMN cronometro_pausado_en INTEGER;
-- Minuto (entero) en el que se congeló el cronómetro la última vez que
-- se pulsó "Descanso" o "Fin del partido" desde el panel. NULL mientras
-- el cronómetro está corriendo con normalidad.

-- match_events.jugador ya existe y se reutiliza para goles/tarjetas. Para
-- los eventos de tipo "cambio" se guardan aparte el que entra y el que
-- sale, y en "jugador" se deja el que entra (para que el detalle público,
-- que ya usa esa columna, no necesite tocarse).
ALTER TABLE match_events ADD COLUMN jugador_sale TEXT;
