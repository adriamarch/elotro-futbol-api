-- Migración: convierte la columna "users.equipo" de un único club en
-- texto plano (p. ej. "Real Madrid") a un array JSON en texto (p. ej.
-- '["Real Madrid"]'), que es el formato que ahora usa el Worker para
-- poder guardar hasta 3 equipos por persona.
--
-- El código del Worker (parsearEquipos en worker/src/index.js) ya sabe
-- leer AMBOS formatos, así que esta migración no es estrictamente
-- obligatoria para que la web siga funcionando; pero conviene
-- ejecutarla para que los datos queden en el formato nuevo y consistente,
-- y para que al editar esos usuarios desde "Usuarios" en el panel se
-- pueda añadir un segundo o tercer equipo sin líos.
--
-- Ejecutar SOLO si la base de datos ya tenía la columna "equipo" con
-- datos en el formato antiguo (texto plano, no JSON). Si es una base de
-- datos nueva, no hace falta: nunca habrá tenido el formato antiguo.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_equipos_multiples.sql

UPDATE users
SET equipo = '["' || REPLACE(equipo, '"', '\"') || '"]'
WHERE equipo IS NOT NULL
  AND TRIM(equipo) != ''
  AND NOT (equipo LIKE '[%' AND equipo LIKE '%]');
