-- Restaura los 5 aplazados de Segunda Federación Grupo 3, jornada 7, que el relleno
-- automático devolvió al 18-oct a las 10:56 del 23-oct-2026, y los protege del sync.
-- Requiere haber ejecutado antes migracion_horario_manual.sql (columna horario_manual).
-- Cada UPDATE lleva guarda por la fecha errónea (18-oct), así que solo toca si sigue mal.
-- Se quita estado en juego/finalizado, marcador 0-0 y cronómetro que arrancó el cron.

UPDATE results SET fecha_partido = '2026-11-25T20:00', ubicacion = 'Antonio Solana',
  estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  inicio_cronometro_at = NULL, finalizado_no_cubierto = 0, horario_manual = 1
WHERE competicion = 'segunda_federacion' AND jornada = 7
  AND equipo_local = 'CF Intercity' AND equipo_visitante = 'Real Murcia Imperial'
  AND fecha_partido = '2026-10-18T12:00';

UPDATE results SET fecha_partido = '2026-11-11T19:30', ubicacion = 'El Collao',
  estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  inicio_cronometro_at = NULL, finalizado_no_cubierto = 0, horario_manual = 1
WHERE competicion = 'segunda_federacion' AND jornada = 7
  AND equipo_local = 'CD Alcoyano' AND equipo_visitante = 'Elche Ilicitano'
  AND fecha_partido = '2026-10-18T18:00';

UPDATE results SET fecha_partido = '2026-11-11T20:30', ubicacion = 'La Arboleja',
  estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  inicio_cronometro_at = NULL, finalizado_no_cubierto = 0, horario_manual = 1
WHERE competicion = 'segunda_federacion' AND jornada = 7
  AND equipo_local = 'CD Cieza' AND equipo_visitante = 'Valencia Mestalla'
  AND fecha_partido = '2026-10-18T17:00';

UPDATE results SET fecha_partido = '2026-11-11T18:45', ubicacion = 'Eliseo Pla Ramírez',
  estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  inicio_cronometro_at = NULL, finalizado_no_cubierto = 0, horario_manual = 1
WHERE competicion = 'segunda_federacion' AND jornada = 7
  AND equipo_local = 'UD Castellonense' AND equipo_visitante = 'CF La Nucía'
  AND fecha_partido = '2026-10-18T11:45';

UPDATE results SET fecha_partido = '2026-11-11T19:00', ubicacion = 'Gaetà Huguet',
  estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  inicio_cronometro_at = NULL, finalizado_no_cubierto = 0, horario_manual = 1
WHERE competicion = 'segunda_federacion' AND jornada = 7
  AND equipo_local = 'CD Castellón B' AND equipo_visitante = 'CD Minera'
  AND fecha_partido = '2026-10-18T12:00';
