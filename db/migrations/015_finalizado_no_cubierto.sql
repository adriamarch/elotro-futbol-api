-- Migración 015: columna "finalizado_no_cubierto" en "results"
-- (mismo esquema que worker/migracion_fin_no_cubierto.sql en D1,
-- aplicada aquí a Postgres para que el esquema de ambas bases coincida).
--
-- Sin esto, sync/incremental.mjs (ver tables.mjs: "results" sincroniza
-- TODAS sus columnas dinámicamente, igual que pasó con "fuente" y
-- "external_id" en la migración 010) detectaría esta columna nueva como
-- "sin equivalente en PG" y cortaría la sincronización de "results" en
-- cada pasada -- y, en cascada, la de articles/match_events/alineaciones/
-- article_slug_redirects/comments, que dependen de results por FK.
--
-- 0 = finalizado normal, 1 = cerrado solo por el cron al llegar al
-- minuto MINUTO_FIN_PARTIDO_AUTOMATICO sin que nadie pulsara "Fin del
-- partido" antes (ver worker/src/index.js y worker-secondary/src/index.js,
-- crearFinPartidoAutomaticoAlMinuto90). Se usa para pintar el aviso
-- "FINALIZADO NO CUBIERTO" en la tabla de Resultados del panel admin.

BEGIN;

ALTER TABLE results ADD COLUMN IF NOT EXISTS finalizado_no_cubierto INTEGER NOT NULL DEFAULT 0;

COMMIT;
