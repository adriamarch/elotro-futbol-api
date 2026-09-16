-- Migración: dos estadísticas nuevas para el panel de analíticas
-- (public/panel-analiticas.html):
--
-- 1) "idiomas más usados al leer una noticia": columna `idioma` en
--    article_views, rellenada por /api/track/view con el idioma que el
--    lector tenía seleccionado (selector de idioma de noticia.html).
--    Por defecto "es" para no romper filas ya existentes ni clientes
--    viejos que todavía no manden el campo.
--
-- 2) "partidos más seguidos en resultados": tabla nueva result_views,
--    una fila por cada carga de minuto-a-minuto.html (la página pública
--    de seguimiento de un partido), igual de ligera que article_views
--    -- sin guardar nada que identifique a la persona, solo un hash de
--    visitante+día para poder sacar "visitantes únicos" además de
--    "vistas".

ALTER TABLE article_views ADD COLUMN idioma TEXT NOT NULL DEFAULT 'es';
CREATE INDEX IF NOT EXISTS idx_article_views_idioma ON article_views(idioma);

CREATE TABLE IF NOT EXISTS result_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  visitante_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_result_views_result ON result_views(result_id);
CREATE INDEX IF NOT EXISTS idx_result_views_created ON result_views(created_at);
CREATE INDEX IF NOT EXISTS idx_result_views_created_result ON result_views(created_at, result_id);
