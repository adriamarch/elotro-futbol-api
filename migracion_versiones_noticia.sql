-- Historial de versiones de noticias/crónicas/artículos.
-- Cada vez que se crea o se edita una noticia desde el panel se guarda aquí una
-- copia (titular, subtítulo, texto y datos básicos) con quién la guardó y cuándo,
-- para poder ver qué cambió y recuperar un texto si alguien lo pisa o se equivoca.
-- Se conservan las últimas 60 versiones de cada noticia. No hay FK a articles a
-- propósito: si la noticia se borra (papelera) y se restaura, recupera su historial.
--   numero: 1, 2, 3... por noticia
--   motivo: creacion | edicion | revision (Nivel 4 sobre contenido ajeno) | inicial
--           (copia del estado previo a que existiera el historial; sin autor conocido)
--   datos: JSON con tipo, categoria, club, imagen_url, imagenes, etc.
--   hash: huella del contenido, para no guardar dos veces lo mismo
-- APLICAR ANTES de desplegar el Worker (si la tabla no existe, las noticias se
-- guardan igual pero sin historial).
CREATE TABLE IF NOT EXISTS article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  subtitulo TEXT,
  contenido TEXT NOT NULL DEFAULT '',
  datos TEXT,
  hash TEXT,
  editor_id INTEGER,
  editor_nombre TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT 'edicion',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_versions_art ON article_versions(article_id, id);
CREATE INDEX IF NOT EXISTS idx_article_versions_creada ON article_versions(created_at);
