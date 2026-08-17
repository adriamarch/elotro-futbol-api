-- Migración: slug definitivo al publicar + redirección de slugs antiguos.
-- SOLO ejecutar si la base de datos YA existía antes de este cambio.
-- Si es una base de datos nueva, ignora este archivo: schema.sql ya
-- incluye todo esto.
--
-- Antes, el slug de una noticia se fijaba en el momento de crearla (a
-- partir del título de ese momento) y ya no se volvía a tocar, aunque el
-- título cambiara después durante la revisión. Con este cambio:
--
--   - Mientras la noticia sea un borrador o esté programada (todavía no
--     se ha publicado nunca), el slug se recalcula cada vez que se
--     guarda, siguiendo al título.
--   - En cuanto se publica por primera vez (a mano o porque llega la hora
--     programada), el slug se "congela" (slug_congelado = 1) y a partir
--     de ahí ya no vuelve a cambiar aunque se edite el título más
--     adelante, para no romper enlaces ya compartidos.
--   - Si aun así el slug cambiara mientras estaba congelado... no debería
--     pasar, pero por si acaso: cada vez que un slug cambia se guarda el
--     antiguo en "article_slug_redirects", así que quien entre con un
--     enlace viejo se redirige automáticamente al nuevo.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_slug_dinamico.sql

ALTER TABLE articles ADD COLUMN slug_congelado INTEGER NOT NULL DEFAULT 0;

-- Los artículos que ya estaban publicados antes de esta migración se dan
-- por "congelados": su slug ya se ha podido compartir, así que no debe
-- volver a moverse aunque se edite el título a partir de ahora.
UPDATE articles SET slug_congelado = 1 WHERE publicado = 1;

CREATE TABLE IF NOT EXISTS article_slug_redirects (
  slug_antiguo TEXT PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
