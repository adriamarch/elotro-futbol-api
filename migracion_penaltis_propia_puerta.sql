-- Migración: tandas de penaltis (para partidos eliminatorios que se
-- deciden así) y goles en propia puerta.
--
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_penaltis_propia_puerta.sql

-- Goles marcados en la tanda de penaltis, aparte del resultado del
-- tiempo reglamentario (goles_local/goles_visitante no se tocan). NULL
-- en los dos = el partido no se decidió por penaltis; en cuanto hay
-- tanda, ambos pasan a valer al menos 0 (ver recalcularPenaltisDesdeEventos
-- en el Worker).
ALTER TABLE results ADD COLUMN penaltis_local INTEGER;
ALTER TABLE results ADD COLUMN penaltis_visitante INTEGER;

-- Nota: los nuevos tipos de evento ("penalti_marcado", "penalti_fallado_tanda"
-- para la tanda, y "gol_pp" para gol en propia puerta) no necesitan
-- columnas nuevas: "tipo" ya es TEXT libre, validado en el código del
-- Worker (ver TIPOS_EVENTO_VALIDOS). Para "penalti_marcado" y
-- "penalti_fallado_tanda", "equipo" es el equipo que tira el penalti y
-- "minuto" se usa como el número de orden dentro de la tanda (1, 2, 3...),
-- no como un minuto de partido real. Para "gol_pp", "equipo" es el
-- equipo del jugador que marca en su propia puerta (el gol beneficia al
-- rival; ver recalcularMarcadorDesdeEventos en el Worker).
