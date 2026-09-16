-- Limpieza de Segunda Federación: ElOtroFútbol solo cubre 7 de los ~90
-- clubes reales de la categoría (ver CLUBS_BY_CATEGORY.segunda_federacion
-- en public/js/clubs.js). Cualquier partido de "segunda_federacion" en el
-- que NINGUNO de los dos equipos sea uno de esos 7 no debería estar en la
-- base de datos (probablemente entró por relleno automático desde la API
-- externa, que sí conoce los ~90 equipos reales de la categoría).
--
-- Ejecutar una sola vez. Es seguro repetirla (si no hay partidos que
-- borrar, no hace nada).

-- 1) Borra los partidos de Segunda Federación que no involucran a
--    ninguno de los 7 equipos soportados.
DELETE FROM results
WHERE competicion = 'segunda_federacion'
  AND equipo_local NOT IN (
    'Linares Deportivo', 'Recreativo de Huelva', 'CD Badajoz',
    'CD Numancia', 'CD Guadalajara', 'UB Conquense', 'CF Talavera de la Reina'
  )
  AND equipo_visitante NOT IN (
    'Linares Deportivo', 'Recreativo de Huelva', 'CD Badajoz',
    'CD Numancia', 'CD Guadalajara', 'UB Conquense', 'CF Talavera de la Reina'
  );

-- 2) Corrige el grupo de los partidos que SÍ se quedan (por si alguno se
--    había guardado antes con el grupo vacío o incorrecto). A partir de
--    ahora el backend ya asigna esto solo en cada creación/edición (ver
--    grupoAutomaticoSegundaFederacion en worker/src/index.js), así que
--    esta corrección puntual no debería volver a hacer falta.
UPDATE results
SET grupo = 'Grupo 4'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('Linares Deportivo', 'Recreativo de Huelva', 'CD Badajoz')
    OR equipo_visitante IN ('Linares Deportivo', 'Recreativo de Huelva', 'CD Badajoz'));

UPDATE results
SET grupo = 'Grupo 5'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('CD Numancia', 'CD Guadalajara', 'UB Conquense', 'CF Talavera de la Reina')
    OR equipo_visitante IN ('CD Numancia', 'CD Guadalajara', 'UB Conquense', 'CF Talavera de la Reina'));
