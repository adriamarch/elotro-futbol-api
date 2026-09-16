-- Migración: varias fotos por noticia/crónica + vincular un resultado
-- (partido) a una noticia/crónica.
--
-- Solo hace falta ejecutar esto si la base de datos D1 ya estaba
-- desplegada ANTES de esta función. Si la base de datos es nueva,
-- ignora este archivo: schema.sql ya incluye estas columnas.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_imagenes_resultado.sql

ALTER TABLE articles ADD COLUMN imagenes TEXT;
ALTER TABLE articles ADD COLUMN resultado_id INTEGER REFERENCES results(id);
