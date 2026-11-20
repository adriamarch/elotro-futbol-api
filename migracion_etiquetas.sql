-- Migración: etiquetas (tags) reales por noticia.
--
-- Hasta ahora los hashtags de la cabecera de una noticia se generaban solos
-- (competición, tipo, clubes) y no había páginas de etiqueta. Esta migración
-- añade dos columnas a "articles" para que el redactor pueda poner temas
-- propios como «Ascenso 2026» o «Fichajes», cada uno con su página
-- (/etiqueta/{slug}), su feed (/rss/etiqueta/{slug}.xml) y su entrada en
-- /sitemap-etiquetas.xml:
--
--   etiquetas        array JSON con los nombres tal como se escribieron
--                    ('["Ascenso 2026","Fichajes"]', máximo 8). NULL si no hay.
--   etiquetas_slugs  los mismos nombres normalizados y entre comas
--                    (',ascenso-2026,fichajes,'). Es lo que se consulta con
--                    LIKE '%,fichajes,%'; las comas de los extremos evitan
--                    que «liga» case con «liga-2». NULL si no hay.
--
-- Es seguro aplicarla ANTES de desplegar el worker (las columnas nuevas no las
-- usa nadie hasta entonces) y el worker tolera que falte (guardar etiquetas
-- falla en silencio sin impedir publicar la noticia), pero las páginas de
-- etiqueta no funcionan hasta que esté aplicada.
--
-- Ejecutar con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./worker/migracion_etiquetas.sql

ALTER TABLE articles ADD COLUMN etiquetas TEXT;
ALTER TABLE articles ADD COLUMN etiquetas_slugs TEXT;
