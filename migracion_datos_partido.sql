-- Migración: datos del encuentro y estadísticas del partido (Centro de partido).
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya incluye la columna.
--
-- Guarda, como JSON, lo que la redacción rellena a mano en el panel (Resultados > editar):
--   { "arbitro": "", "asistencia": "", "tv": "", "clima": "",
--     "estadisticas": { "posesion": [local, visitante], "tiros": [..], "tiros_puerta": [..],
--                       "corners": [..], "faltas": [..], "fueras_juego": [..], "paradas": [..] } }
-- NULL si el partido no tiene datos. Se edita con PUT /api/results/:id/datos-partido.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_datos_partido.sql

ALTER TABLE results ADD COLUMN datos_partido TEXT;
