-- Las previas de Copa del Rey y Copa Federación ya no siguen el horario de publicación
-- (se pueden subir y compartir en redes cualquier día; el horario de previas solo vale
-- para las de liga). Esto quita la marca "fuera de calendario" de las que se
-- publicaron antes de existir la excepción. Idempotente.
--   D1: wrangler d1 execute elotrofutbol --remote --file=worker/migracion_previas_copas_sin_horario.sql
UPDATE articles SET fuera_calendario = 0
WHERE tipo = 'previa' AND categoria IN ('copa_del_rey', 'copa_federacion') AND fuera_calendario = 1;
