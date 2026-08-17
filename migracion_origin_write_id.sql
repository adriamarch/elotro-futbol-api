-- Añade origin_write_id a articles y results: identificador estable (el
-- mismo UUID write_id de worker-secondary/db/migrations/003_pending_writes.sql)
-- que permite reconocer, cuando una escritura pendiente se reproduce contra
-- D1 tras un failover, que esta fila NUEVA es en realidad la reproducción
-- de una fila que YA existe en PostgreSQL (creada allí durante el
-- failover) y no una fila de negocio distinta.
--
-- CONTEXTO COMPLETO: 003_pending_writes.sql documentaba este límite como
-- "no resuelto" -- un INSERT (crear artículo/resultado nuevo) hecho contra
-- la secundaria durante un failover recibe un id autoincremental de
-- PostgreSQL; al reproducirse después contra D1, D1 le asigna su PROPIO id
-- (normalmente distinto), y en la siguiente pasada de sincronización
-- D1 -> PostgreSQL esa fila de D1 se copiaba como fila ADICIONAL en
-- PostgreSQL, dejando la original (con el id de PostgreSQL) huérfana y
-- duplicada. Un redactor que creó un artículo durante un incidente podía
-- ver, tras la recuperación, ese artículo duplicado o -peor- editar
-- después la copia huérfana que ya no se sincroniza con nadie.
--
-- Esta columna cierra ese hueco: junto con el cambio en
-- worker-secondary/sync/incremental.mjs (ver comentario allí), al
-- sincronizar D1 -> PostgreSQL, si la fila nueva de D1 trae
-- origin_write_id, el sincronizador busca en PostgreSQL una fila
-- EXISTENTE con ese mismo origin_write_id (la huérfana del failover) y la
-- REEMPLAZA in-place por la de D1 (mismo registro, ahora con el id
-- definitivo de D1) en vez de insertar una fila nueva. Así el redactor
-- nunca ve un duplicado ni pierde la fila que ya estaba viendo/editando en
-- la secundaria.
--
-- NULL para todo lo creado por el camino normal (sin failover): no aplica
-- ninguna lógica especial de deduplicación en ese caso, que es la inmensa
-- mayoría de los INSERTs.
ALTER TABLE articles ADD COLUMN origin_write_id TEXT;
ALTER TABLE results ADD COLUMN origin_write_id TEXT;

-- Único cuando no es NULL: si el mismo write_id llegara dos veces (reintento
-- del drenaje, por ejemplo tras un timeout de red entre Railway y el Worker
-- aunque D1 sí lo hubiera aplicado ya), este índice hace que el segundo
-- INSERT falle por restricción en vez de crear un segundo duplicado real.
-- SQLite/D1 permite múltiples NULL en un índice UNIQUE (no chocan entre
-- sí), así que no afecta a las filas creadas por el camino normal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_origin_write_id ON articles(origin_write_id) WHERE origin_write_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_origin_write_id ON results(origin_write_id) WHERE origin_write_id IS NOT NULL;
