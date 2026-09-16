-- Migración: relleno automático de partidos que nadie de redacción cubre.
--
-- Problema que resuelve: en LaLiga Hypermotion, Primera Federación y
-- Segunda Federación no todos los partidos de cada jornada tienen un
-- redactor asignado a ninguno de los dos equipos, así que esos partidos
-- nunca se creaban en "results" y faltaban tanto del calendario como de
-- la clasificación (que se calcula sumando los "finalizado" de esta
-- tabla). La solución: un cron diario trae de una API externa
-- (API-Football) los partidos que faltan y los inserta aquí igual que
-- si los hubiera creado un redactor, pero marcados como "fuente=auto"
-- para poder distinguirlos y para que un redactor real SIEMPRE tenga
-- prioridad si más tarde decide cubrir ese partido a mano.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_relleno_automatico.sql

-- 'redaccion' = creado/editado por un redactor desde el panel (como hasta
-- ahora). 'auto_api_football' = insertado por el cron de relleno
-- automático, sin ningún redactor asignado. Todo lo que ya existía en la
-- tabla antes de esta migración es por definición 'redaccion' (el valor
-- por defecto cubre esas filas sin tener que tocarlas una a una).
ALTER TABLE results ADD COLUMN fuente TEXT NOT NULL DEFAULT 'redaccion';

-- Id del partido en la API externa (p.ej. "fixture.id" de API-Football).
-- Permite al cron encontrar y actualizar (marcador, estado) un partido
-- automático que ya había insertado antes, en vez de duplicarlo cada día.
-- NULL en todos los partidos de redacción, que no vienen de ninguna API.
ALTER TABLE results ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_results_external_id
  ON results(external_id) WHERE external_id IS NOT NULL;

-- Tabla de alias: nombre de equipo tal como lo devuelve la API externa ->
-- nombre "oficial" que usa el sitio (el mismo que aparece en
-- public/js/clubs.js), para que "Deportivo Fabril" (API) y "RC
-- Deportivo Fabril" (vuestro) se traten como el mismo equipo y no se
-- creen fichas duplicadas. Se rellena a mano desde el panel (Ajustes ->
-- Alias de equipos) la primera vez que el cron encuentra un nombre que
-- no reconoce.
CREATE TABLE IF NOT EXISTS equipo_alias_externo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_externo TEXT NOT NULL UNIQUE,
  nombre_interno TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registro de la última sincronización automática (una fila fija, igual
-- patrón que newsletter_envios): permite al cron -que corre cada minuto
-- para otras tareas- saber si ya ha tocado hoy sin tener que guardar
-- estado en ningún otro sitio, y al panel mostrar "última actualización"
-- y avisar si llevamos varios días sin sincronizar (posible fallo de la
-- API externa o clave caducada).
CREATE TABLE IF NOT EXISTS sync_partidos_auto (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_sync_at TEXT,
  ultimo_sync_ok INTEGER NOT NULL DEFAULT 1, -- 0 si el último intento falló (ver logs)
  ultimo_error TEXT
);
INSERT OR IGNORE INTO sync_partidos_auto (id, ultimo_sync_at) VALUES (1, NULL);
