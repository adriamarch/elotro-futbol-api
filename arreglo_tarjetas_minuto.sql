-- Arregla los 3 eventos de tarjeta amarilla cuyo minuto quedó a 0/NULL
-- porque el nombre del jugador se guardó con el minuto pegado dentro,
-- p.ej. jugador = "Lucas Terrer (27')" y minuto = 0.
-- Causa: el parser de importación rápida (analizarLineaTarjeta) fallaba
-- cuando dentro del paréntesis venía algo más además del minuto (el
-- nombre del equipo), y esto viene de ese fallo ya guardado en BD.
--
-- 1) Localiza primero el resultado_id del partido (ajusta los nombres
--    de equipo si hace falta):
SELECT id, equipo_local, equipo_visitante, fecha_partido
FROM results
WHERE equipo_local LIKE '%Zaragoza%' AND equipo_visitante LIKE '%Tarragona%';

-- 2) Revisa los eventos de tarjeta de ese resultado_id (sustituye ?ID?
--    por el id obtenido arriba) para confirmar cuáles están mal:
SELECT id, tipo, jugador, minuto, minuto_extra
FROM match_events
WHERE resultado_id = ?ID?
  AND tipo IN ('amarilla', 'doble_amarilla', 'roja')
ORDER BY minuto;

-- 3) Corrige cada fila afectada. El patrón es siempre "Nombre (NN')":
--    se extrae el número y se limpia el nombre. Ejecuta un UPDATE por
--    cada evento mal guardado (los 3 de la captura):

UPDATE match_events
SET jugador = 'Lucas Terrer', minuto = 27
WHERE resultado_id = ?ID? AND tipo = 'amarilla' AND jugador LIKE 'Lucas Terrer%';

UPDATE match_events
SET jugador = 'Eugeni', minuto = 43
WHERE resultado_id = ?ID? AND tipo = 'amarilla' AND jugador LIKE 'Eugeni%';

UPDATE match_events
SET jugador = 'Pau Sans', minuto = 58
WHERE resultado_id = ?ID? AND tipo = 'amarilla' AND jugador LIKE 'Pau Sans%';

-- 4) Verifica que ha quedado bien:
SELECT id, tipo, jugador, minuto, minuto_extra
FROM match_events
WHERE resultado_id = ?ID?
  AND tipo IN ('amarilla', 'doble_amarilla', 'roja')
ORDER BY minuto;
