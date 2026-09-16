-- Migración: banner flotante de "última hora" en la web pública.
--
-- OJO: esto es un concepto DISTINTO al PIN de "última hora" que ya
-- existe (ver migracion_pin_ultima_hora_global.sql / ultima_hora_pin en
-- settings), que solo sirve para que un redactor de Nivel 1 pueda
-- publicar sin pasar por borrador. Para no mezclar los dos conceptos
-- bajo el mismo nombre, este usa "banner_urgente": es la marca, puesta
-- a mano por un admin/redactor desde el panel, que hace aparecer el
-- banner rojo flotante en todas las páginas públicas.
--
-- banner_urgente: 0/1. A 1, el banner se muestra en toda la web
-- apuntando a esta noticia.
-- banner_urgente_hasta: fecha/hora (UTC, mismo formato que el resto de
-- columnas de fecha de esta tabla) en la que el banner deja de
-- mostrarse solo. Se calcula en el servidor como
-- datetime('now', '+2 hours') en el momento de activarlo -- nunca lo
-- manda el cliente, para que no se pueda alargar a mano la ventana de
-- 2h desde el panel. NULL cuando banner_urgente = 0.
ALTER TABLE articles ADD COLUMN banner_urgente INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN banner_urgente_hasta TEXT;

-- Solo puede haber banner activo en un puñado de artículos a la vez (en
-- la práctica casi siempre 0 o 1), así que un índice parcial evita
-- escanear toda la tabla articles en cada carga de página pública (el
-- banner se consulta en /api/articles/banner-urgente desde layout.js,
-- es decir, en TODAS las páginas).
CREATE INDEX idx_articles_banner_urgente ON articles(banner_urgente_hasta) WHERE banner_urgente = 1;
