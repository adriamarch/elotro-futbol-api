-- Migración 022: columna "categorias_adicionales" en "articles".
--
-- Permite marcar, además de la categoría principal (la que se usa para
-- construir el link de la noticia, /futbol/[categoria]/slug), hasta 4
-- categorías adicionales como simples etiquetas informativas -- no
-- afectan al filtrado por categoría ni a la URL, solo se muestran junto
-- a la noticia. Ver worker/schema.sql y worker/migracion_categorias_adicionales.sql
-- para el mismo cambio en D1.

BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS categorias_adicionales TEXT;

COMMIT;

-- ------------------------------------------------------------
-- Nota: "articles" ya está registrada en worker-secondary/sync/tables.mjs
-- con changeStrategy "updated_at" y sincroniza todas sus columnas de
-- forma dinámica, así que en cuanto esta migración se aplique en
-- Postgres, sync/incremental.mjs empezará a replicar el valor de
-- "categorias_adicionales" sin ningún paso manual adicional en el sync.
-- ------------------------------------------------------------
