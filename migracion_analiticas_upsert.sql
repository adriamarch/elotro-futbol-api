-- Migración: índice único sobre article_reading(view_id), necesario
-- para el UPSERT (ON CONFLICT DO UPDATE) del endpoint /api/track/reading
-- (ver src/index.js). Ver worker-secondary/db/migrations/
-- 007_article_reading_upsert.sql para la explicación completa: el
-- cliente (public/js/analiticas-tracking.js) ahora manda el tiempo de
-- lectura como "heartbeat" periódico además de al cerrar la pestaña, así
-- que puede llegar más de una vez para la misma vista. Sin este índice,
-- cada heartbeat insertaría una fila nueva y el AVG(segundos) del panel
-- contaría de más.

-- Colapsa filas duplicadas de un mismo view_id (no debería haber
-- ninguna todavía en D1, pero por si esta migración se aplica después
-- de haber probado el heartbeat sin el índice), quedándose con la de
-- mayor id (la más reciente).
DELETE FROM article_reading
WHERE id NOT IN (
  SELECT MAX(id) FROM article_reading GROUP BY view_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_reading_view_unico
  ON article_reading(view_id);
