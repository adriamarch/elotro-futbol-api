-- Migración 006: tracking propio de vistas y tiempo de lectura, para
-- alimentar el panel de analíticas (misma migración que
-- worker/migracion_analiticas.sql en D1, aplicada aquí a Postgres para
-- que el esquema de ambas bases coincida).

BEGIN;

CREATE TABLE IF NOT EXISTS article_views (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitante_hash TEXT NOT NULL,
  fuente TEXT NOT NULL DEFAULT 'directo',
  referer_dominio TEXT,
  dispositivo TEXT NOT NULL DEFAULT 'escritorio',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_article_views_article ON article_views(article_id);
CREATE INDEX IF NOT EXISTS idx_article_views_created ON article_views(created_at);
CREATE INDEX IF NOT EXISTS idx_article_views_visitante_dia ON article_views(visitante_hash, article_id, created_at);

CREATE TABLE IF NOT EXISTS article_reading (
  id SERIAL PRIMARY KEY,
  view_id INTEGER NOT NULL REFERENCES article_views(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  segundos INTEGER NOT NULL,
  scroll_maximo INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_article_reading_article ON article_reading(article_id);
CREATE INDEX IF NOT EXISTS idx_article_reading_created ON article_reading(created_at);
CREATE INDEX IF NOT EXISTS idx_article_reading_view ON article_reading(view_id);

COMMIT;
