-- Migración: eventos de un partido (goles, tarjetas amarillas/rojas) para
-- el detalle que se ve al clicar un resultado en resultados.html.
--
-- Solo hace falta ejecutar esto si la base de datos D1 ya estaba
-- desplegada ANTES de esta función. Si la base de datos es nueva,
-- ignora este archivo: schema.sql ya incluye esta tabla.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_eventos_partido.sql

CREATE TABLE IF NOT EXISTS match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resultado_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- gol, amarilla, doble_amarilla, roja
  equipo TEXT NOT NULL, -- 'local' o 'visitante'
  jugador TEXT,
  minuto INTEGER NOT NULL,
  minuto_extra INTEGER, -- minutos de descuento (ej. 45+2 -> minuto=45, minuto_extra=2)
  orden INTEGER NOT NULL DEFAULT 0, -- para desempatar eventos en el mismo minuto
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_match_events_resultado ON match_events(resultado_id);
