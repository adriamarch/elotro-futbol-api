-- Migración: noticias rápidas.
--
-- Apartado de "noticias rápidas": piezas muy breves que escriben los
-- redactores (y admin) con SOLO tres campos: foto, titular y subtitular.
-- No tienen cuerpo, categoría, club ni borrador: se publican en cuanto se
-- guardan. Un fotógrafo no puede crearlas (igual que el resto de contenido
-- editorial, ver puedeGestionarContenidoEditorial en el worker).
--
-- Aplicar en D1 con:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_noticias_rapidas.sql
CREATE TABLE IF NOT EXISTS noticias_rapidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  subtitulo TEXT NOT NULL,
  imagen_url TEXT NOT NULL,
  autor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_noticias_rapidas_created ON noticias_rapidas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_noticias_rapidas_autor ON noticias_rapidas(autor_id);
