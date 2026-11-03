-- OPCIONAL, de una sola vez. Devuelve a "pendiente" las porras que se resolvieron
-- con el marcador de un partido "finalizado no cubierto" (cerrado por el cron sin
-- que nadie lo cubriera), cuyo marcador no es fiable. Se vuelven a resolver solas
-- cuando el partido se cubra (finalizado_no_cubierto pasa a 0).
-- Aplicar en D1 y en Postgres (misma sentencia).
UPDATE porras
   SET resultado_acierto = 'pendiente',
       puntos_obtenidos = NULL
 WHERE resultado_acierto != 'pendiente'
   AND resultado_id IN (SELECT id FROM results WHERE finalizado_no_cubierto = 1);
