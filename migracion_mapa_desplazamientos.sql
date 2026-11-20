-- ============================================================
-- Mapa de desplazamientos — Fase 1: estadios visitados por lector
-- ============================================================
-- Una fila por lector: su equipo (nombre de club tal y como sale en
-- clubs.js) y la lista de estadios que ha marcado como visitados, como
-- JSON de ids (slug del nombre del estadio, ver public/js/mapa-estadios-datos.js).
-- No se guarda ninguna coordenada: el mapa vive entero en el frontend.
-- Se aplica con:  wrangler d1 execute <BD> --remote --file=migracion_mapa_desplazamientos.sql
CREATE TABLE IF NOT EXISTS reader_mapa_desplazamientos (
  reader_id INTEGER PRIMARY KEY REFERENCES readers(id) ON DELETE CASCADE,
  equipo TEXT,
  estadios TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
