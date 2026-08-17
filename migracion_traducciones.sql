-- Traducciones de noticias/crónicas a euskera, català, galego e inglés.
--
-- Solo afecta a los ARTÍCULOS (noticias, crónicas, opinión, entrevistas):
-- las interfaces de la web y del panel siguen únicamente en castellano.
--
-- Los redactores traducen de forma opcional al subir/editar el artículo.
-- Si un idioma no se rellena, esos campos quedan a NULL y esa noticia se
-- sigue mostrando en castellano en ese idioma, indicando en el selector
-- que la traducción no está disponible ("Disponible en...").
--
-- Prefijos usados: eu (euskera), ca (català), gl (galego), en (english).

ALTER TABLE articles ADD COLUMN titulo_eu TEXT;
ALTER TABLE articles ADD COLUMN subtitulo_eu TEXT;
ALTER TABLE articles ADD COLUMN contenido_eu TEXT;

ALTER TABLE articles ADD COLUMN titulo_ca TEXT;
ALTER TABLE articles ADD COLUMN subtitulo_ca TEXT;
ALTER TABLE articles ADD COLUMN contenido_ca TEXT;

ALTER TABLE articles ADD COLUMN titulo_gl TEXT;
ALTER TABLE articles ADD COLUMN subtitulo_gl TEXT;
ALTER TABLE articles ADD COLUMN contenido_gl TEXT;

ALTER TABLE articles ADD COLUMN titulo_en TEXT;
ALTER TABLE articles ADD COLUMN subtitulo_en TEXT;
ALTER TABLE articles ADD COLUMN contenido_en TEXT;
