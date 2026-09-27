-- Migración: pestañas por equipo en la galería de partido + link propio
-- para cada galería (Fase 1 del rediseño de "Subir contenido" +
-- "Galería de partido").
--
-- Contexto: hasta ahora, al vincular una foto a un partido en
-- match_gallery, no se guardaba de qué equipo era esa foto en concreto
-- (el campo "club" de "media" es texto libre, sin relación real con
-- ninguno de los dos equipos del partido). Esto añade:
--
--   1) match_gallery.equipo: 'local', 'visitante' o NULL (foto general
--      del partido, sin equipo concreto). Con esto la vista pública
--      puede agrupar las fotos en pestañas: una por cada equipo que
--      tenga fotos, y una general si hay fotos sin equipo asignado.
--
--   2) results.slug: URL bonita y estable para la galería pública de
--      ese partido (ej. "real-valladolid-lugo-2026-03-10-12345"), en
--      vez de exponer directamente el id numérico. Se genera la
--      primera vez que el partido recibe una foto en su galería (ver
--      slugPartido() en src/index.js); antes de eso puede ser NULL.
--
-- Ejecutar primero en local/dev y después en remoto:
--   wrangler d1 execute elotrofutbol --local --file=./migracion_galeria_partido_equipo_slug.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_galeria_partido_equipo_slug.sql

ALTER TABLE match_gallery ADD COLUMN equipo TEXT;

ALTER TABLE results ADD COLUMN slug TEXT;

-- Único cuando no es NULL: dos partidos no pueden compartir slug, pero
-- los partidos que todavía no tienen galería (slug NULL) no chocan entre
-- sí (SQLite no aplica UNIQUE entre NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_slug
  ON results(slug) WHERE slug IS NOT NULL;
