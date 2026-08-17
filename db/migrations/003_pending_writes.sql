-- FASE 5 — Cola de escrituras pendientes (secundaria -> primaria)
--
-- CONTEXTO: la sincronización de FASE 4 (002_fase4_sync.sql,
-- sync/incremental.mjs) es de solo un sentido, D1 -> PostgreSQL, con D1
-- como autoridad. Eso significa que cualquier escritura (POST/PUT/DELETE)
-- que un usuario hace contra la secundaria durante un failover (porque el
-- Worker principal reenvió su petición a Railway al recibir un 5xx, ver
-- fetchRailway en worker/src/index.js) se queda solo en PostgreSQL: en la
-- siguiente pasada de reconciliación autoritativa, D1 no sabe que ese
-- cambio existe y puede sobrescribirlo o borrarlo sin más.
--
-- Esta tabla es la cola de esas escrituras: server-railway.js registra
-- aquí cada escritura que atiende (método, ruta, cuerpo, quién la hizo),
-- y el Worker principal (worker/src/index.js, endpoint interno
-- /api/internal/drain-pending-writes) las reproduce contra D1 en cuanto
-- vuelve a estar operativo, llamando a la MISMA lógica de negocio que
-- usaría si la petición hubiera llegado directamente (handlePrimary) --
-- no un INSERT/UPDATE directo a ciegas, para que se apliquen las mismas
-- validaciones y checks de permisos que a cualquier otra escritura.
--
-- LÍMITE IMPORTANTE (documentado explícitamente, ver conversación con el
-- equipo): esto no resuelve conflictos de edición simultánea del MISMO
-- registro en las dos APIs a la vez. Si D1 rechaza la reproducción (aunque
-- sea por un motivo de negocio normal, no solo un choque de ID), la fila
-- queda en status='failed' con el motivo, visible para revisión manual --
-- nunca se fuerza ni se descarta en silencio.
--
-- ACTUALIZACIÓN: el segundo límite que sigue documentado más abajo (IDs
-- duplicados en altas) quedó resuelto en la práctica -aunque no probado
-- contra infraestructura real, ver la nota al final de esta sección- por
-- worker/migracion_origin_write_id.sql +
-- worker-secondary/db/migrations/004_origin_write_id.sql +
-- sync/pg-writer.mjs (reconciliarFilasPorOriginWriteId), enganchado en
-- sync/incremental.mjs. Se deja aquí el razonamiento original íntegro
-- porque sigue siendo la explicación correcta del PROBLEMA; lo que cambió
-- es que ahora existe un mecanismo que lo resuelve automáticamente en la
-- sincronización, en vez de requerir revisión manual en todos los casos.
--
-- SEGUNDO LÍMITE IMPORTANTE -- IDs duplicados en altas (INSERT): cuando la
-- escritura pendiente es un INSERT (crear un artículo/resultado/etc.
-- nuevo), D1 le asigna su PROPIO id autoincremental al reproducirla, que
-- casi seguro NO coincide con el id que Postgres le asignó al crearlo
-- originalmente durante el failover. El registro queda con dos ids
-- distintos en cada base -- en la siguiente pasada del sync D1 ->
-- Postgres, la fila de D1 (id nuevo) se copia como una fila ADICIONAL en
-- Postgres, dejando la original (id de Postgres) huérfana y duplicada.
-- Esta cola NO soluciona ese caso por sí sola: cualquier ALTA hecha en la
-- secundaria durante un failover debe revisarse a mano tras la
-- recuperación (buscar duplicados por título/fecha/autor), no dar por
-- sentado que "ya se sincronizó sola" solo porque status='applied'. Las
-- ediciones (UPDATE) y borrados (DELETE) sobre un registro que YA existía
-- antes del failover no tienen este problema, porque su id no cambia.
--
-- CÓMO FUNCIONA LA RESOLUCIÓN (ver migracion_origin_write_id.sql para el
-- detalle completo): el mismo write_id que identifica esta fila en la cola
-- ahora viaja también como cabecera X-Write-Id hasta la fila de negocio
-- misma (columna origin_write_id en articles/results, en D1 Y en
-- PostgreSQL). Cuando D1 reproduce el INSERT, su fila nueva lleva ese
-- mismo origin_write_id. En la siguiente sincronización D1 -> PostgreSQL,
-- antes del upsert normal por PK, se busca en PostgreSQL una fila con ese
-- mismo origin_write_id: si existe con un PK distinto (la huérfana del
-- failover), se elimina, y el upsert que sigue inserta limpiamente la fila
-- con el id definitivo de D1 -- resultado neto: una sola fila, no dos.
--
-- Si el borrado de la huérfana fallara (por ejemplo, otra fila creada
-- también durante el mismo failover que la referencia por FK), el
-- conflicto se registra en sync_write_id_conflicts para revisión manual en
-- vez de forzarlo o descartarlo en silencio -- el caso "revisar a mano"
-- sigue existiendo, pero ahora es la EXCEPCIÓN (un conflicto de FK
-- concreto) y no la REGLA (cualquier alta durante cualquier failover).
--
-- NOTA DE VALIDACIÓN: igual que el resto de esta fase, este mecanismo
-- tiene tests unitarios que sí se ejecutan (ver
-- worker-secondary/sync/test/write-id-reconciliation.test.mjs) cubriendo
-- la lógica de reconciliarFilasPorOriginWriteId contra un client de
-- PostgreSQL simulado, pero NO se ha podido probar de extremo a extremo
-- contra D1/PostgreSQL reales dentro de un failover real (misma
-- limitación de infraestructura que el resto del documento). No se declara
-- "validado en producción" -- solo "implementado y probado a nivel de
-- unidad", siguiendo el mismo criterio que el resto de esta fase.
BEGIN;

CREATE TABLE IF NOT EXISTS pending_writes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- Identificador estable generado en el momento de encolar, independiente
  -- de los autoincrementales de D1/Postgres (que pueden colisionar entre
  -- sí): sirve para deduplicar reintentos y para que el cliente pueda
  -- preguntar "¿se aplicó ya mi escritura X?" sin ambigüedad.
  write_id UUID NOT NULL UNIQUE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query_string TEXT,
  -- Cuerpo tal cual llegó (JSON en texto), para reproducir la petición
  -- exactamente igual contra D1 sin reinterpretarlo.
  body TEXT,
  -- Cabecera Authorization tal cual (el JWT ya demuestra quién hizo la
  -- petición y con qué rol; reproducirlo así hace que D1 aplique
  -- exactamente los mismos checks de permiso que aplicó Postgres).
  authorization_header TEXT,
  user_id INTEGER,
  -- Resultado que dio Postgres/Railway al atenderla originalmente, solo
  -- para diagnóstico -- no se usa para decidir si reproducirla o no.
  original_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, applied, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  -- Status HTTP y cuerpo de la respuesta que dio D1 en el último intento
  -- de reproducción; permite ver EXACTAMENTE por qué falló sin adivinar.
  last_result_status INTEGER,
  last_result_body TEXT,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_writes_status ON pending_writes(status, created_at);

COMMIT;
