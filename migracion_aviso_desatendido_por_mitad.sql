-- Sustituye el flag único "aviso_desatendido_enviado" (0/1, un solo
-- aviso en toda la vida del partido) por un registro de en qué mitad
-- se ha mandado ya el aviso de "partido posiblemente sin cubrir".
--
-- Antes, si el flag se reseteaba (por cualquier evento nuevo, un ajuste
-- de minuto, etc.) y el partido se volvía a quedar desatendido, se
-- mandaba otro aviso -- y como el cron pasa cada minuto, un partido
-- realmente abandonado podía generar bastantes correos seguidos ("la
-- petada") si había habido algún toque suelto de por medio.
--
-- Con esta columna se reparte como máximo un aviso por cada mitad del
-- partido: uno para la 1ª parte (antes del descanso) y otro para la 2ª
-- parte (después de reanudar), aunque el partido se quede desatendido
-- varias veces dentro de la misma mitad.
--
-- Valores: NULL/'' = nada avisado todavía; 'primera' = ya se avisó en
-- la 1ª parte; 'segunda' = ya se avisó en la 2ª parte;
-- 'primera_segunda' = ya se avisó en ambas.
ALTER TABLE results ADD COLUMN aviso_desatendido_mitad TEXT;

-- Los partidos que ya tuvieran el aviso antiguo enviado (bajo el
-- sistema de un único flag) se marcan como avisados en las dos mitades,
-- para no reabrir avisos ya vistos por la redacción justo al desplegar
-- este cambio.
UPDATE results SET aviso_desatendido_mitad = 'primera_segunda' WHERE aviso_desatendido_enviado = 1;
