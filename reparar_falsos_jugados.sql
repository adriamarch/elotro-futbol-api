-- Reparación de una sola vez (también la hace sola el cron cada 10 min tras desplegar).
-- Devuelve a "programado" los partidos FUTUROS que se quedaron como "finalizado sin cubrir"
-- (o "en juego", o "finalizado" 0-0 si alguien guardó el partido después y se borró la marca) porque el cron los arrancó cuando tenían una fecha mal puesta ya pasada.
-- Solo toca partidos cuya fecha empieza dentro de más de ~3 h y que no tienen eventos reales
-- (goles, tarjetas...), solo los automáticos del cron. Ejecutar en D1 y en Postgres.

UPDATE results SET estado = 'programado', goles_local = NULL, goles_visitante = NULL,
  penaltis_local = NULL, penaltis_visitante = NULL, inicio_cronometro_at = NULL,
  cronometro_pausado_en = NULL, ajuste_cronometro_minutos = 0, aviso_desatendido_mitad = NULL,
  finalizado_no_cubierto = 0
WHERE (estado IN ('en_juego', 'colgado') OR (estado = 'finalizado' AND (finalizado_no_cubierto = 1 OR (COALESCE(goles_local, 0) = 0 AND COALESCE(goles_visitante, 0) = 0))))
  AND fecha_partido IS NOT NULL AND length(fecha_partido) >= 10
  AND fecha_partido > strftime('%Y-%m-%dT%H:%M', 'now', '+3 hours')  -- Postgres: to_char(now() + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI')
  AND (fecha_partido_retrasado IS NULL OR fecha_partido_retrasado = '')
  AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.resultado_id = results.id
                  AND NOT (e.tipo IN ('inicio_partido','descanso','fin_descanso','fin_partido') AND (e.equipo = 'ninguno' OR e.equipo IS NULL)));

-- Elimina los eventos automáticos que dejó el cron en esos partidos (ya "programado" y futuros).
DELETE FROM match_events
WHERE tipo IN ('inicio_partido', 'descanso', 'fin_descanso', 'fin_partido')
  AND resultado_id IN (SELECT id FROM results WHERE estado = 'programado' AND goles_local IS NULL
                       AND fecha_partido > strftime('%Y-%m-%dT%H:%M', 'now', '+3 hours'));
