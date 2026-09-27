-- Migración: galería/imágenes vinculadas a una noticia (Bloque B —
-- Fotógrafo + galerías, Fase 12)
--
-- Contexto: hasta ahora una noticia solo tenía las fotos que el
-- redactor insertaba directamente dentro del texto (columna
-- articles.imagenes, ver normalizarImagenes en worker/src/index.js).
-- Esta migración añade una tabla puente para que, además, un redactor
-- pueda vincular a la noticia:
--   (a) la galería completa de un partido (match_gallery), o
--   (b) imágenes sueltas del banco general de "media",
-- sin que eso las mezcle con el contenido del propio texto. Se guarda
-- como una lista aparte (no como "imagenes") porque su uso previsto es
-- distinto: un carrusel/grid de fotos del partido al pie de la noticia,
-- con crédito del fotógrafo autor de cada imagen (Fase 14), no fotos
-- posicionadas entre párrafos.
--
-- "orden" funciona igual que en match_gallery: posición dentro del
-- carrusel/grid de la noticia. Al guardar la noticia (POST/PUT
-- /api/articles) se sustituye la fila completa de article_media de esa
-- noticia por la selección final que mande el redactor (ver
-- sincronizarArticleMedia): no hace falta un endpoint aparte para
-- vincular/desvincular una imagen suelta.
--
-- Ejecutar primero en local/dev y después en remoto:
--   wrangler d1 execute elotrofutbol --local --file=./migracion_article_media.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_article_media.sql

CREATE TABLE IF NOT EXISTS article_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- Una misma imagen no se vincula dos veces a la misma noticia (sí puede
-- repetirse en noticias distintas, igual que en match_gallery).
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_media_unico
  ON article_media(article_id, media_id);

-- Consulta habitual: pintar la galería de una noticia en orden (editor
-- y página pública).
CREATE INDEX IF NOT EXISTS idx_article_media_article
  ON article_media(article_id, orden);

-- Saber en qué noticias aparece una imagen (por si se borra de "media"
-- y hay que revisar dónde estaba enlazada).
CREATE INDEX IF NOT EXISTS idx_article_media_media
  ON article_media(media_id);
