-- Opcional: "Comienza la 2ª parte" ya guardado con añadido ("45+2'") pasa a
-- ser siempre 45'. El orden tras "Descanso" lo garantiza el ORDER BY del worker.
UPDATE match_events SET minuto_extra = NULL WHERE tipo = 'fin_descanso' AND minuto_extra IS NOT NULL;
