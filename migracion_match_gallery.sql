-- Migración: galería de partido (Bloque B — Fotógrafo + galerías, Fase 9)
--
-- Contexto: hasta ahora "media" era una bolsa plana de fotos/vídeos
-- subidos por cualquier colaborador, sin relación con ningún partido
-- concreto de "results". Esta migración añade una tabla puente que
-- vincula imágenes de "media" con un partido de "results", para que un
-- fotógrafo pueda subir la galería completa de un partido y luego un
-- redactor pueda enlazarla (entera o por imágenes sueltas) a una
-- noticia/crónica (esto último se implementa en fases posteriores del
-- Bloque B, ver plan: Fase 12-14).
--
-- Diseño elegido: tabla puente "match_gallery" en vez de añadir una
-- columna "partido_id" directamente a "media". Se decide así por dos
-- motivos:
--   1) Permite que una misma imagen pertenezca a MÁS DE UN partido sin
--      duplicar la fila en "media" (ej. una foto genérica del estadio
--      reutilizada en varios partidos jugados ahí). Si más adelante se
--      quiere restringir a "solo un partido por imagen", basta con
--      añadir un índice único sobre (media_id) — no hace falta rehacer
--      el modelo.
--   2) Mantiene "media" como la tabla neutra de siempre (fotos/vídeos
--      sueltos sin partido asociado siguen funcionando exactamente
--      igual, sin fila en esta tabla nueva).
--
-- "orden" permite que el fotógrafo (o quien gestione la galería)
-- decida en qué posición aparece cada imagen dentro del partido, para
-- el carrusel/grid que se mostrará en la noticia (Fase 14).
--
-- Ejecutar primero en local/dev y después en remoto:
--   wrangler d1 execute elotrofutbol --local --file=./migracion_match_gallery.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_match_gallery.sql

CREATE TABLE IF NOT EXISTS match_gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  -- Quién vinculó esta imagen al partido (normalmente el fotógrafo que
  -- la subió, pero un admin también puede gestionar cualquier galería).
  -- No es necesariamente el mismo que media.autor_id si un admin enlaza
  -- a posteriori una imagen subida por otra persona.
  vinculado_por_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
  FOREIGN KEY (vinculado_por_id) REFERENCES users(id)
);

-- Una misma imagen no puede estar dos veces en la galería del mismo
-- partido (sí puede repetirse en partidos distintos, ver motivo 1 de
-- arriba).
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_gallery_unico
  ON match_gallery(result_id, media_id);

-- Listar/ordenar la galería de un partido es la consulta más habitual
-- (panel del fotógrafo, selector en el editor de noticia, carrusel
-- público), así que se indexa por result_id con orden.
CREATE INDEX IF NOT EXISTS idx_match_gallery_result
  ON match_gallery(result_id, orden);

-- Saber en qué partidos aparece una imagen (por si se borra la imagen
-- de "media" y hay que revisar dónde estaba enlazada, o para el caso
-- futuro de restringir a un único partido).
CREATE INDEX IF NOT EXISTS idx_match_gallery_media
  ON match_gallery(media_id);
