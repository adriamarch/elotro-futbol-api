-- Migración 023: dos estadísticas nuevas para el panel de analíticas
-- (misma migración que worker/migracion_analiticas_idioma_partidos.sql
-- en D1, aplicada aquí a Postgres para que el esquema de ambas bases
-- coincida -- ver ese fichero para la explicación completa).

BEGIN;

ALTER TABLE article_views ADD COLUMN IF NOT EXISTS idioma TEXT NOT NULL DEFAULT 'es';
CREATE INDEX IF NOT EXISTS idx_article_views_idioma ON article_views(idioma);

CREATE TABLE IF NOT EXISTS result_views (
  id SERIAL PRIMARY KEY,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  visitante_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_result_views_result ON result_views(result_id);
CREATE INDEX IF NOT EXISTS idx_result_views_created ON result_views(created_at);
CREATE INDEX IF NOT EXISTS idx_result_views_created_result ON result_views(created_at, result_id);

COMMIT;
