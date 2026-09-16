-- Migración: índices para reducir las "rows read" en D1 (ver panel
-- Analíticas > Queries de Cloudflare). Solo añade índices; no toca datos
-- ni columnas. Segura de ejecutar en cualquier momento.
--
-- Motivos concretos (por query, según el panel de Cloudflare D1):
--
-- 1) SELECT a.autor_nombre..., COUNT(DISTINCT a.id)... FROM articles a
--    JOIN article_views v ON v.article_id = a.id AND v.created_at >= ?
--    (calcularAutoresAnaliticas, worker/src/index.js): 7.06M rows leídas
--    en solo 21 ejecuciones. article_views ya tenía índices por
--    article_id y por created_at por separado, pero no uno compuesto que
--    sirva para "filtrar por fecha y unir por article_id" a la vez, así
--    que el join no podía aprovecharlos bien.
--
-- 2) SELECT tipo, COUNT(*) FROM articles WHERE (autor_id = ? OR
--    coautor_id = ?) AND publicado = 1 (contarPublicacionesPorTipo):
--    3068 ejecuciones (se llama una vez POR CADA usuario listado en
--    GET /api/users) leyendo 571k rows en total. No había ningún índice
--    por autor_id ni coautor_id.
--
-- 3) SELECT * FROM articles WHERE 1=1 ... ORDER BY fecha_publicacion
--    DESC LIMIT ? (GET /api/articles): 46.99k rows leídas para 5
--    devueltas. El único índice de fecha_publicacion exige además
--    publicado = 1 (idx_articles_publicado), así que no sirve para la
--    vista de administración (admin=1, incluye borradores) ni cuando
--    además se filtra por categoria/club/tipo/autor_id.
--
-- Ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_optimizacion_lecturas_d1.sql

-- (1) article_views: índice compuesto (created_at, article_id) para que
-- el filtro por fecha y el join por article_id se resuelvan ambos desde
-- el índice, sin tocar la tabla fila a fila.
CREATE INDEX IF NOT EXISTS idx_article_views_created_article
  ON article_views(created_at, article_id);

-- (1) article_reading: mismo motivo, para el LEFT JOIN por fecha+artículo
-- en calcularAutoresAnaliticas y calcularTiempoLecturaAnaliticas.
CREATE INDEX IF NOT EXISTS idx_article_reading_created_article
  ON article_reading(created_at, article_id);

-- (2) articles: contar publicaciones de un autor (como autor principal o
-- como coautor) sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_articles_autor_publicado
  ON articles(autor_id, publicado);
CREATE INDEX IF NOT EXISTS idx_articles_coautor_publicado
  ON articles(coautor_id, publicado);

-- (3) articles: listado en el panel de administración (incluye
-- borradores, no filtra por publicado) ordenado por fecha.
CREATE INDEX IF NOT EXISTS idx_articles_fecha_publicacion
  ON articles(fecha_publicacion DESC);

-- (3) articles: los filtros más comunes del listado del panel
-- (categoria, club, tipo, autor_id) combinados con el orden por fecha,
-- para que también aprovechen índice cuando se usan junto al orden.
CREATE INDEX IF NOT EXISTS idx_articles_categoria_fecha
  ON articles(categoria, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_club_fecha
  ON articles(club, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_tipo_fecha
  ON articles(tipo, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_autor_fecha
  ON articles(autor_id, fecha_publicacion DESC);

-- articles.autor_nombre: usado por calcularAutoresAnaliticas para
-- agrupar y por WHERE a.autor_nombre IS NOT NULL.
CREATE INDEX IF NOT EXISTS idx_articles_autor_nombre
  ON articles(autor_nombre);
