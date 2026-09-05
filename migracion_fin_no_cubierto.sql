-- Añade el flag que marca un partido como cerrado automáticamente por el
-- cron (nadie pulsó "Fin del partido" a mano), para poder mostrar el
-- aviso "FINALIZADO NO CUBIERTO" en la tabla de Resultados del panel
-- admin. Mismo cambio que worker/migracion_fin_no_cubierto.sql, aplicado
-- aquí para que el esquema de ambos D1 coincida.
ALTER TABLE results ADD COLUMN finalizado_no_cubierto INTEGER NOT NULL DEFAULT 0;
