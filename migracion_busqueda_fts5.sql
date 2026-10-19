-- Búsqueda de artículos con FTS5 (D1). Aplicar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_busqueda_fts5.sql
--
-- No hay que rellenar nada a mano: el cron horario (reconciliarIndiceBusqueda
-- en src/busqueda.js) indexa los artículos existentes por lotes y, al terminar,
-- activa la bandera settings.busqueda_backfill_completo. Hasta entonces la web
-- sigue usando el LIKE de siempre, así que no hay hueco ni orden obligatorio
-- entre desplegar el código y aplicar esta migración. Para acelerarlo:
--   POST /api/admin/busqueda/reindexar   (admin; repetir hasta "listo": true)
--
-- OJO: `wrangler d1 export` NO funciona en bases con tablas virtuales FTS5.
-- Para exportar: DROP TABLE articles_fts (y sus tablas sombra se van con ella),
-- exportar, y volver a ejecutar este archivo + POST /api/admin/busqueda/reindexar?reset=1.

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  titulo,
  subtitulo,
  club,
  autor,
  extra,      -- títulos/subtítulos traducidos (eu, ca, gl, en)
  cuerpo,     -- contenido sin HTML
  actualizado UNINDEXED, -- articles.updated_at en el momento de indexar (detecta desfases)
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

-- Vocabulario (títulos, clubes y autores) para corregir erratas. Es pequeño
-- (miles de filas) y se cachea en KV/memoria; nunca se lee en cada búsqueda.
CREATE TABLE IF NOT EXISTS busqueda_vocab (
  term TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

INSERT OR IGNORE INTO settings (key, value) VALUES ('busqueda_backfill_completo', '0');
