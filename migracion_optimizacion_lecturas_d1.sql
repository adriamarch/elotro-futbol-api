-- Migración: índices para reducir lecturas innecesarias sobre
-- "articles" (equivalente a migracion_optimizacion_lecturas_d1.sql del
-- Worker principal). No se incluyen los índices de article_views ni
-- article_reading porque esas tablas de analíticas no se replican ni se
-- consultan desde esta API secundaria (Postgres/Railway).
--
-- Segura de ejecutar en cualquier momento; no toca datos ni columnas.

CREATE INDEX IF NOT EXISTS idx_articles_autor_publicado
  ON articles(autor_id, publicado);
CREATE INDEX IF NOT EXISTS idx_articles_coautor_publicado
  ON articles(coautor_id, publicado);
CREATE INDEX IF NOT EXISTS idx_articles_fecha_publicacion
  ON articles(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_categoria_fecha
  ON articles(categoria, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_club_fecha
  ON articles(club, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_tipo_fecha
  ON articles(tipo, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_autor_fecha
  ON articles(autor_id, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_autor_nombre
  ON articles(autor_nombre);
