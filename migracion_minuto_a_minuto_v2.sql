-- Migración v2 del panel de MINUTO A MINUTO.
--
-- Añade lo necesario para:
--   1. Que un partido "programado" pase solo a "en_juego" al llegar su
--      hora (cron) arrancando el cronómetro automáticamente.
--   2. Poder editar el minuto del cronómetro a mano (ajuste manual,
--      además del minuto por evento que ya era editable).
--   3. Botón de pausa de hidratación (reutiliza el mecanismo de pausa
--      del cronómetro, con un tipo de evento propio para distinguirla
--      en el timeline de un descanso normal).
--   4. Estados "retrasado" y "anulado", y gol anulado por VAR (tipo de
--      evento nuevo, no estado: no cuenta para el marcador).
--   5. Asistencias en los goles.
--
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_minuto_a_minuto_v2.sql

-- Desplazamiento (en minutos, puede ser negativo) que aplica el redactor
-- al pulsar "Editar minuto" en el panel. El minuto en vivo pasa a ser
-- "minutos transcurridos desde inicio_cronometro_at" + este ajuste, en
-- vez de tocar inicio_cronometro_at directamente (así no se pierde la
-- referencia real de cuándo empezó el partido). NULL/0 = sin ajuste.
ALTER TABLE results ADD COLUMN ajuste_cronometro_minutos INTEGER NOT NULL DEFAULT 0;

-- Nueva fecha/hora (mismo formato que fecha_partido) cuando se marca un
-- partido como "retrasado" desde el botón correspondiente. Se guarda
-- aparte de fecha_partido para conservar el horario original previsto
-- (se puede mostrar "Retrasado, antes 17:00, ahora 17:30").
ALTER TABLE results ADD COLUMN fecha_partido_retrasado TEXT;

-- jugador que da la asistencia en un evento de tipo "gol" (opcional).
ALTER TABLE match_events ADD COLUMN jugador_asistencia TEXT;

-- Nota: los nuevos estados ("retrasado", "anulado") y los nuevos tipos
-- de evento ("pausa_hidratacion", "fin_pausa_hidratacion", "gol_var",
-- "partido_retrasado", "partido_anulado") no necesitan columnas nuevas:
-- "estado" y "tipo" ya son TEXT libre, validados en el código del
-- Worker (ver ESTADOS_VALIDOS y TIPOS_EVENTO_VALIDOS).
