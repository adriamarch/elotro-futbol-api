-- Migración 020: banner flotante de "última hora" en la web pública
-- (equivalente a worker/migracion_banner_urgente.sql y
-- worker-secondary/migracion_banner_urgente.sql en D1, aplicada aquí a
-- Postgres para que el esquema de ambas bases coincida).
--
-- OJO: esto es un concepto DISTINTO al PIN de "última hora" que ya
-- existe (ver migración de ultima_hora_pin en settings), que solo sirve
-- para que un redactor de Nivel 1 pueda publicar sin pasar por
-- borrador. Para no mezclar los dos conceptos bajo el mismo nombre,
-- este usa "banner_urgente": es la marca, puesta a mano por un
-- admin/redactor desde el panel, que hace aparecer el banner rojo
-- flotante en todas las páginas públicas.
--
-- banner_urgente: 0/1 (mismo patrón que el resto de booleanos de este
-- esquema en Postgres, ver p. ej. la migración 015: INTEGER en vez de
-- BOOLEAN, para no tener que traducir tipos entre motores). A 1, el
-- banner se muestra en toda la web apuntando a esta noticia.
-- banner_urgente_hasta: fecha/hora (TEXT, mismo patrón que
-- created_at/updated_at/cierra_en en este esquema -- ver el comentario
-- largo sobre esas columnas en sql-compat.js, que YA incluye
-- "banner_urgente_hasta" en su lista de columnas de fecha a castear a
-- timestamptz al comparar, aunque la columna en sí nunca se hubiera
-- llegado a crear aquí) en la que el banner deja de mostrarse solo. Se
-- calcula en el servidor, nunca lo manda el cliente. NULL cuando
-- banner_urgente = 0.
--
-- Sin esta migración, sync/incremental.mjs (ver tables.mjs: "articles"
-- sincroniza columnas dinámicamente) detecta banner_urgente/
-- banner_urgente_hasta como columnas sin equivalente en PG y corta la
-- sincronización de "articles" en cada pasada.

BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS banner_urgente INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS banner_urgente_hasta TEXT;

-- Mismo motivo que el índice parcial en D1 (migracion_banner_urgente.sql):
-- solo puede haber banner activo en un puñado de artículos a la vez, así
-- que un índice parcial evita escanear toda la tabla en cada carga de
-- página pública.
CREATE INDEX IF NOT EXISTS idx_articles_banner_urgente ON articles(banner_urgente_hasta) WHERE banner_urgente = 1;

COMMIT;
