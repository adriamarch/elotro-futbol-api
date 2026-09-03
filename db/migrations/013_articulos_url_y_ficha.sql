-- Migración 013: usa_url_bonita + ficha_tecnica en "articles"
-- (mismo esquema que worker/migracion_formato_enlace.sql y
-- worker/migracion_ficha_tecnica.sql en D1, aplicada aquí a Postgres
-- para que el esquema de ambas bases coincida).
--
-- OJO con "usa_url_bonita": en D1 no basta con el DEFAULT. La migración
-- original (migracion_formato_enlace.sql) añade la columna con
-- DEFAULT 1 y ACTO SEGUIDO ejecuta "UPDATE articles SET usa_url_bonita
-- = 0" sobre TODOS los artículos que ya existían en ese momento (el
-- formato de URL antiguo). Es decir, el valor real por artículo
-- depende de cuándo se creó, no solo del default de la columna.
--
-- Además, "articles" sincroniza en modo incremental por updated_at
-- (no "authoritative", ver sync/tables.mjs), así que añadir aquí la
-- columna con un ALTER TABLE normal NO basta para los artículos que ya
-- estaban en Postgres antes de esta migración: el sincronizador solo
-- volverá a copiarlos si su updated_at en D1 cambia de nuevo, así que
-- se quedarían con el DEFAULT de Postgres (1) en vez de su valor real
-- en D1, que para artículos antiguos casi siempre es 0.
--
-- Por eso esta migración añade la columna con el MISMO default que D1
-- (1, para que los artículos nuevos que se creen a partir de ahora
-- salgan bien sin más), pero el backfill de los valores reales para
-- las filas ya existentes en Postgres NO puede hacerse aquí (esta
-- migración es SQL puro sobre Postgres, sin acceso a D1): hace falta
-- ejecutar aparte scripts/backfill-usa-url-bonita.mjs justo después de
-- aplicar esta migración (lee D1 vía wrangler y corrige fila a fila).

BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS usa_url_bonita INTEGER NOT NULL DEFAULT 1;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS ficha_tecnica TEXT;

COMMIT;
