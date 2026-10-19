-- Partidazo de la jornada: un partido destacado por liga y jornada
-- (LaLiga Hypermotion, Primera Federación, Segunda Federación).
--
-- Lo calcula solo el cron del Worker principal (ver "PARTIDAZO DE LA
-- JORNADA" en src/index.js). Columnas:
--   partidazo             0/1: este partido es el partidazo de su jornada.
--   partidazo_puntuacion  puntos que sumó en la evaluación (para depurar).
--   partidazo_motivos     JSON con las etiquetas a mostrar, p.ej.
--                         ["Derbi regional","Duelo directo por el ascenso"].
--
-- Ejecutar primero en local/dev y después en remoto:
--   wrangler d1 execute elotrofutbol --local --file=./migracion_partidazo.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_partidazo.sql
--
-- IMPORTANTE: ejecutar también worker-secondary/db/migrations/035_partidazo.sql
-- en Postgres. Si D1 tiene columnas que Postgres no tiene, el sincronizador
-- corta la tabla results (mismo problema que con results.slug, migración 029).

ALTER TABLE results ADD COLUMN partidazo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE results ADD COLUMN partidazo_puntuacion INTEGER;
ALTER TABLE results ADD COLUMN partidazo_motivos TEXT;
