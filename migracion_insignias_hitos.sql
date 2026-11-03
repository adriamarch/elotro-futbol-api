-- Migración: índice para las INSIGNIAS POR HITOS ("Mi progreso").
--
-- La insignia "Primer directo" busca, para una persona, los partidos en los que registró eventos
-- (activity_log: accion = 'crear_evento_partido'). Sin este índice compuesto SQLite tiene que
-- recorrer todas las filas de actividad de esa persona (inicios de sesión, ediciones...) o todas
-- las de esa acción; "Mi progreso" se refresca cada 30 s, así que conviene que sea una lectura
-- acotada. Una vez conseguida, la insignia se guarda en settings y esta consulta deja de lanzarse.
--
-- No hay tablas ni columnas nuevas: las insignias conseguidas se guardan en la tabla settings
-- (clave "insignias_hitos:<id de usuario>"). Es idempotente y seguro de repetir.
--
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_insignias_hitos.sql

CREATE INDEX IF NOT EXISTS idx_activity_usuario_accion ON activity_log(usuario_id, accion);
