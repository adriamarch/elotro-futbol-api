-- Migración 024: corrige "lectores recurrentes" en el panel de
-- analíticas. Misma migración que worker/migracion_analiticas_recurrencia.sql
-- en D1, aplicada aquí a Postgres para que el esquema de ambas bases
-- coincida (ver ese archivo para la explicación completa del bug).

BEGIN;

ALTER TABLE article_views ADD COLUMN IF NOT EXISTS visitante_estable TEXT;
CREATE INDEX IF NOT EXISTS idx_article_views_visitante_estable ON article_views(visitante_estable, created_at);

COMMIT;
