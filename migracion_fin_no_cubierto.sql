-- Añade el flag que marca un partido como cerrado automáticamente por el
-- cron (nadie pulsó "Fin del partido" a mano) para poder mostrar el aviso
-- "FINALIZADO NO CUBIERTO" en la tabla de Resultados del panel admin.
-- 0 = finalizado normal (a mano o por marcador ya cerrado), 1 = cerrado
-- solo por crearFinPartidoAutomaticoAlMinuto90 al llegar al minuto 150
-- sin que nadie lo cerrara antes.
ALTER TABLE results ADD COLUMN finalizado_no_cubierto INTEGER NOT NULL DEFAULT 0;
