-- Ejecutar UNA VEZ para reparar el desajuste actual de la secuencia de
-- activity_log (causa de "duplicate key value violates unique constraint
-- activity_log_pkey" en los logs). El fix en sync/incremental.mjs evita que
-- esto vuelva a pasar en el futuro, pero no corrige el estado ya existente.
SELECT setval(
  pg_get_serial_sequence('activity_log', 'id'),
  COALESCE((SELECT MAX(id) FROM activity_log), 1)
);

-- Opcional pero recomendado: revisa si otras tablas con el mismo patrón
-- (PK autoincremental + sincronizadas con id explícito desde D1 + con algún
-- INSERT directo en Postgres sin id) tienen el mismo desajuste. Sustituye
-- "nombre_tabla" por cada una que quieras comprobar:
-- SELECT setval(
--   pg_get_serial_sequence('nombre_tabla', 'id'),
--   COALESCE((SELECT MAX(id) FROM nombre_tabla), 1)
-- );
