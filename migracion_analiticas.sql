-- Migración: tracking propio de vistas y tiempo de lectura, para
-- alimentar el panel de analíticas (ver public/panel-analiticas.html
-- y la Parte 1/mockup) con datos reales en vez de GSC.
--
-- Dos tablas:
--
-- 1) article_views: una fila por cada vez que se abre una noticia.
--    Guarda lo mínimo para poder sacar "más leídas", "tráfico por
--    fuente" y "dispositivo", sin guardar IP completa ni nada que
--    identifique a la persona (solo un hash de sesión de un día para
--    poder deduplicar vistas repetidas del mismo visitante en la
--    misma sesión de lectura, ver /api/track/view más abajo).
--
-- 2) article_reading: cierra cada vista anterior con el tiempo que
--    ha estado la noticia abierta (se manda con navigator.sendBeacon
--    al salir de la página, ver public/js/analiticas-tracking.js de
--    la Parte 3). Fila 1:1 con la vista que la originó.
--
-- Ambas tablas crecen sin límite con el tráfico; el panel siempre
-- agrega (COUNT/AVG/SUM) sobre un rango de fechas, nunca lista filas
-- sueltas, así que no hace falta purgarlas para que las consultas
-- sigan siendo rápidas mientras haya los índices por fecha/artículo.

CREATE TABLE IF NOT EXISTS article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- Hash (no reversible) de IP + User-Agent + día, solo para poder
  -- deduplicar recargas/refrescos de la misma persona el mismo día
  -- sin inflar la cifra de "visitas únicas". No permite identificar a
  -- nadie a partir de esta tabla.
  visitante_hash TEXT NOT NULL,
  -- 'directo', 'buscador', 'redes_sociales', 'referido', 'interno'
  -- (calculado en el Worker a partir de la cabecera Referer, ver
  -- clasificarFuenteTrafico() en src/index.js).
  fuente TEXT NOT NULL DEFAULT 'directo',
  -- Dominio del referer cuando la fuente no es directa/interna (p.ej.
  -- "google.com", "twitter.com"), para poder desglosar dentro de cada
  -- fuente si algún día hace falta. NULL en directo/interno.
  referer_dominio TEXT,
  dispositivo TEXT NOT NULL DEFAULT 'escritorio', -- 'movil', 'escritorio', 'tablet'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_views_article ON article_views(article_id);
CREATE INDEX IF NOT EXISTS idx_article_views_created ON article_views(created_at);
CREATE INDEX IF NOT EXISTS idx_article_views_visitante_dia ON article_views(visitante_hash, article_id, created_at);

CREATE TABLE IF NOT EXISTS article_reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id INTEGER NOT NULL REFERENCES article_views(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- Segundos que ha estado la noticia abierta en la pestaña activa
  -- (se descuenta el tiempo en segundo plano, ver Page Visibility API
  -- en analiticas-tracking.js). Con tope de 30 minutos por vista para
  -- que una pestaña olvidada abierta toda la noche no desvirtúe la
  -- media.
  segundos INTEGER NOT NULL,
  -- Porcentaje (0-100) de la noticia que ha llegado a ver en pantalla,
  -- según el scroll máximo alcanzado. Sirve para distinguir "ha leído
  -- por encima" de "ha leído entera" en el detalle por noticia.
  scroll_maximo INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_reading_article ON article_reading(article_id);
CREATE INDEX IF NOT EXISTS idx_article_reading_created ON article_reading(created_at);
CREATE INDEX IF NOT EXISTS idx_article_reading_view ON article_reading(view_id);
