-- Migración: gol de penalti en el panel de Minuto a Minuto.
--
-- El botón "Penalti pitado" del panel permite registrar un penalti como
-- "Metido" (gol) o "Fallado". Un penalti metido es un evento "gol" de
-- toda la vida (suma al marcador y a los goleadores igual que cualquier
-- otro) con esta marca para rotularlo como "Gol de penalti". El penalti
-- fallado reutiliza el tipo "penalti_fallado" que ya existía.
--
-- No confundir con la TANDA de penaltis de un partido eliminatorio
-- ("penalti_marcado" / "penalti_fallado_tanda", ver
-- migracion_penaltis_propia_puerta.sql).
--
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_gol_penalti.sql
--
-- Si la base de datos es nueva, ignora este archivo: schema.sql ya lo incluye.

-- 1 = el gol fue de penalti; 0 = gol normal (valor por defecto, así los
-- goles ya guardados siguen siendo goles normales). Solo se usa con
-- tipo = 'gol'.
ALTER TABLE match_events ADD COLUMN es_penalti INTEGER NOT NULL DEFAULT 0;
