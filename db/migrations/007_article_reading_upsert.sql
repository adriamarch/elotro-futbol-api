-- Migración 007: índice único sobre article_reading(view_id).
--
-- Necesario para el cambio del cliente (public/js/analiticas-tracking.js)
-- que ahora manda el tiempo de lectura como "heartbeat" cada 15s mientras
-- la pestaña sigue abierta, además de en el cierre -- antes SOLO se
-- mandaba una vez al cerrar/ocultar la pestaña (visibilitychange/
-- pagehide), y si esos eventos no llegaban a dispararse a tiempo (p. ej.
-- "view_id" del INSERT en article_views todavía no había llegado cuando
-- la persona salió de la noticia) la lectura se perdía entera, sin
-- ningún reintento: de ahí "0s" en todos los KPIs de tiempo de lectura
-- pese a que article_views sí se rellenaba con normalidad.
--
-- Con el heartbeat, varias llamadas a /api/track/reading pueden llegar
-- para la MISMA vista (mismo view_id): sin este índice único, cada una
-- insertaría una fila nueva y el AVG(segundos)/AVG(scroll_maximo) del
-- panel contaría de más (una lectura de 60s con 4 heartbeats sumaría
-- como si fueran varias lecturas distintas). El índice único permite
-- hacer UPSERT (ON CONFLICT (view_id) DO UPDATE) en vez de INSERT, así
-- que cada vista sigue teniendo como mucho una fila en article_reading,
-- que se va actualizando con el tiempo más reciente.

BEGIN;

-- Requisito para el UPSERT: solo puede haber una fila de article_reading
-- por view_id. Si ya existieran filas duplicadas de antes de este
-- cambio, se colapsan primero a la de mayor "segundos" (la más completa)
-- para no perder información ni que la migración falle al crear el
-- índice único sobre datos con duplicados.
DELETE FROM article_reading a
USING article_reading b
WHERE a.view_id = b.view_id
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_reading_view_unico
  ON article_reading(view_id);

COMMIT;
