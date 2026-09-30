-- Añade a match_events dos columnas para la "Revisión VAR" (tipo "var")
-- del panel de Minuto a Minuto:
--   var_motivo   -> jugada que se revisa: gol, penalti, roja, amarilla,
--                   falta, fuera_juego, mano u otra.
--   var_decision -> punto en el que está la revisión: revisando,
--                   mantiene (se mantiene la decisión del árbitro) o
--                   cambia (el árbitro cambia su decisión).
-- Ambas son NULL en cualquier otro tipo de evento y en las revisiones
-- VAR anteriores a esta migración. Los valores se validan en el Worker
-- (VAR_MOTIVOS_VALIDOS / VAR_DECISIONES_VALIDAS).
--
-- IMPORTANTE: aplicar ANTES de desplegar el Worker nuevo (el INSERT/UPDATE
-- de eventos ya usa estas columnas). En la secundaria (PostgreSQL) hay que
-- aplicar también db/migrations/030_var_motivo_decision.sql, o el
-- sincronizador D1 -> PostgreSQL cortará la tabla match_events por
-- diferencia de columnas.
ALTER TABLE match_events ADD COLUMN var_motivo TEXT;
ALTER TABLE match_events ADD COLUMN var_decision TEXT;
