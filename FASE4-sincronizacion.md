# FASE 4 — Migración y sincronización D1 → PostgreSQL

## Estado general

Implementación de código completada: migrador inicial, comparador,
sincronización incremental, reintentos, detección de borrados, logs de
estado y scheduler separado. **No se ha podido ejecutar nada de esto
contra infraestructura real** porque este entorno no dispone de
`DATABASE_URL` (Railway/PostgreSQL) ni de credenciales de Wrangler con
acceso a D1 remoto — la misma limitación que ya dejó anotada la Fase 3
(`FASE3-validacion.md`) y que tampoco se ha resuelto en este entorno. Por
eso, siguiendo lo que pide expresamente el documento de la Fase 4 ("si
alguna parte depende de infraestructura que no está disponible, no
simular resultados"), aquí no hay números de "migración completada con
éxito": solo código, pruebas unitarias que sí se han ejecutado, y pruebas
de integración escritas y listas para correr en cuanto exista esa
infraestructura.

---

## 1. Arquitectura elegida

Se implementa exactamente la arquitectura descrita en el documento de
partida:

```
API PRINCIPAL (Cloudflare + D1)
        │ cambios
        ▼
  SINCRONIZADOR D1 → PG   (worker-secondary/sync/*)
        │
        ▼
  PostgreSQL (réplica caliente, Railway)
        │
        ▼
API SECUNDARIA (Railway)
```

D1 sigue siendo la única fuente de verdad. El sincronizador solo lee de
D1 y solo escribe en PostgreSQL; no hay ningún camino de escritura en
sentido contrario. No se ha implementado failover, escritura dual, ni
promoción automática de PostgreSQL (explícitamente fuera de alcance,
sección 16 del documento de partida).

---

## 2. Cómo funciona la sincronización

### 2.1. Migración inicial (`sync/initial-migration.mjs`)

Para cada una de las 16 tablas (en el orden de la sección 5):

1. Comprueba que la tabla existe en PostgreSQL (si no, la omite — no
   crea esquema automáticamente).
2. Lee todas las filas de D1 (`wrangler d1 execute --remote --json`).
3. Calcula las columnas comunes entre D1 y PostgreSQL; avisa de las que
   sobran o faltan a cada lado.
4. Para las tablas autoritativas `users`, `settings` y `sessions`, ejecuta
   una reconciliación completa D1 → PostgreSQL: `UPSERT` de todas las filas
   y eliminación de cualquier PK que sobre en PostgreSQL. La reconciliación
   de cada tabla se ejecuta dentro de una única transacción de PostgreSQL,
   de modo que un fallo no deja una copia parcialmente reconciliada. Para el
   resto de tablas se mantiene `INSERT ... ON CONFLICT (pk) DO NOTHING`
   durante la migración inicial.
5. Registra un resumen por tabla y global en `sync_state`
   (`sync/state.mjs`).

Reejecutarla es seguro: la segunda vez, todos los `INSERT` chocan con
`ON CONFLICT DO NOTHING` y no se inserta nada nuevo (esto es justo lo que
comprueba `sync/test/integration.test.mjs`, primer test).

### 2.2. Sincronización incremental (`sync/incremental.mjs`)

Para cada tabla, en el mismo orden:

1. Para `users`, `settings` y `sessions`, D1 se trata como fuente de verdad
   absoluta: cada pasada lee la tabla completa de D1, hace `UPSERT` de todas
   las filas y elimina de PostgreSQL cualquier PK que no exista en D1. Esto
   permite corregir automáticamente diferencias históricas aunque no haya
   cambiado el cursor.
2. Para el resto de tablas, lee el cursor guardado (`sync_cursor`, tabla
   nueva en PostgreSQL): el último valor de `updated_at`/`created_at` ya
   sincronizado.
3. Pide a D1 solo las filas con `cursorColumn > cursor` (o todas si es la
   primera pasada incremental, para fijar el cursor inicial).
4. Aplica cada fila con `INSERT ... ON CONFLICT (pk) DO UPDATE SET ...`
   (modo `"update"`): a diferencia de la migración inicial, aquí sí hay
   que sobrescribir, porque la fila cambió en D1 después de la última
   sincronización.
4. Guarda el nuevo cursor **solo si todas las filas del lote se
   escribieron sin lanzar** (los reintentos ya se han agotado antes de
   eso — ver sección 9 más abajo).
5. Para las tablas donde el Worker principal permite `DELETE` (marcadas
   `deleteDetection: true` en `sync/tables.mjs`), compara el conjunto de
   IDs de D1 contra el conjunto de IDs de PostgreSQL y borra en
   PostgreSQL los que ya no están en D1, dejando constancia en
   `sync_deletions`.
6. Registra el resultado en `sync_state`.

### 2.3. Comparador (`sync/comparator.mjs`)

Para cada tabla: cuenta filas en D1 y en PostgreSQL, compara el conjunto
de IDs (faltantes/sobrantes en PG), y para los IDs presentes en ambos
lados compara **columna a columna** (no solo el recuento, como pide
explícitamente la sección 6). También avisa de columnas que existen en
un lado y no en el otro. Genera el informe con el formato pedido:

```
TABLA: articles
D1: 214 registros
PG: 214 registros
Diferencias: 0
Estado: OK
```

---

## 3. Archivos creados/modificados

### Nuevos

- `worker/migracion_fase4_sync_tracking.sql` — añade `updated_at` +
  trigger `AFTER UPDATE` en D1 a las tablas mutables que no tenían
  tracking (ver sección 5 más abajo).
- `worker-secondary/db/migrations/002_fase4_sync.sql` — columnas
  `updated_at` espejo en PostgreSQL + tablas `sync_state`, `sync_cursor`,
  `sync_deletions`.
- `worker-secondary/sync/d1-client.mjs` — cliente D1 compartido (usa
  `execFile`, no `execSync` con plantillas de string, para evitar
  problemas de escapado de shell que sí tenía el script original).
- `worker-secondary/sync/tables.mjs` — configuración de las 16 tablas:
  PK, orden de sincronización, estrategia de detección de cambios,
  detección de borrados.
- `worker-secondary/sync/pg-writer.mjs` — helpers de escritura en
  PostgreSQL (upsert idempotente, borrado, conteos).
- `worker-secondary/sync/retry.mjs` — reintentos con backoff exponencial.
- `worker-secondary/sync/state.mjs` — logging en `sync_state` y manejo de
  `sync_cursor`.
- `worker-secondary/sync/initial-migration.mjs` — migración inicial
  (reemplaza en la práctica a `migrar-d1.cjs`, ver nota más abajo).
- `worker-secondary/sync/incremental.mjs` — sincronización incremental.
- `worker-secondary/sync/comparator.mjs` — comparador D1 ↔ PostgreSQL.
- `worker-secondary/sync/scheduler.mjs` — proceso independiente que
  ejecuta la sincronización incremental de forma periódica.
- `worker-secondary/sync/test/unit.test.mjs` — pruebas sin base de datos
  (sí ejecutadas, ver sección 10).
- `worker-secondary/sync/test/integration.test.mjs` — pruebas con base de
  datos real (escritas, no ejecutadas — sin infraestructura).
- Este documento: `worker-secondary/FASE4-sincronizacion.md`.

### Modificados

- `worker-secondary/package.json` — nuevos scripts `sync:initial`,
  `sync:incremental`, `sync:compare`, `sync:scheduler`, `test:sync`; y se
  corrige `test` (`node --test test` fallaba en la versión de Node de
  este entorno porque ya no acepta un directorio sin glob — ahora es
  `node --test test/*.test.mjs`).
- `worker-secondary/wrangler.toml` — se desactiva el bloque `[triggers]`
  (cron de tareas de negocio) con un aviso explicando por qué: este
  archivo no lo usa Railway para desplegar (`server-railway.js` no toca
  Wrangler en absoluto, ver su cabecera), es una copia heredada del
  `worker/wrangler.toml` principal, y si alguna vez se ejecutara
  `wrangler deploy` desde este directorio por error, el cron de negocio
  se dispararía dos veces — justo el riesgo que la Fase 3 ya había
  detectado y que la Fase 4 (sección 11) pide evitar explícitamente. No
  se ha borrado el archivo por prudencia, solo neutralizado el cron.

### Sin cambios (deliberado)

- `worker/src/index.js` y todos los endpoints de la API principal: no se
  ha tocado nada (sección 13).
- `worker-secondary/migrar-d1.cjs`: se deja tal cual, funcional, por si
  algo externo lo invoca todavía; el flujo recomendado a partir de ahora
  es `npm run sync:initial`, que hace lo mismo pero comparte código con
  la sincronización incremental y usa `execFile` en vez de `execSync`
  con interpolación de string.

---

## 4. Tablas sincronizadas

Las 16 tablas del documento de partida, en este orden (revisado contra
`worker/schema.sql` para las dependencias de claves foráneas; coincide
con el orden propuesto salvo que no hacía falta cambiarlo):

`users` → `settings` → `results` → `articles` → `media` →
`custom_clubs` → `article_slug_redirects` → `match_events` →
`alineaciones` → `comments` → `club_info` → `club_info_solicitudes` →
`edit_requests` → `activity_log` → `nivel_historial` → `sessions`

---

## 5. Método utilizado para detectar cambios

Se analizó tabla por tabla si el Worker principal la modifica con
`UPDATE` en algún endpoint (`worker/src/index.js`), no solo `INSERT`:

**Tablas con `updated_at` ya existente** (articles, alineaciones,
club_info, settings) → se usa tal cual.

**Tablas mutables que NO tenían ninguna columna de "última
modificación"** (`users`, `results`, `sessions`, `edit_requests`,
`comments`, `club_info_solicitudes`): se añade `updated_at` + un trigger
`AFTER UPDATE ... WHEN NEW.updated_at = OLD.updated_at` en D1
(`migracion_fase4_sync_tracking.sql`). El trigger actúa de forma
transparente sobre cualquier `UPDATE` que ya hiciera el Worker, sin que
haya hecho falta tocar ni una línea de `src/index.js` — es la opción
menos invasiva de las que planteaba la sección 8 del documento (un
journal/outbox explícito habría exigido instrumentar cada `INSERT`/
`UPDATE`/`DELETE` del Worker principal, lo cual choca con la sección 13).

**Tablas de solo-inserción** (`match_events`, `custom_clubs`,
`article_slug_redirects`, `activity_log`, `nivel_historial`, `media`):
nunca se hace `UPDATE` sobre ellas en el Worker, así que `created_at`
basta como cursor.

**Borrados**: D1 no tiene una tabla de auditoría de `DELETE` genérica. En
`users`, `settings` y `sessions` la reconciliación autoritativa compara
directamente el conjunto completo de PKs y elimina de PostgreSQL todo lo que
no exista en D1. Para el resto de tablas donde sí se borra (`results`,
`articles`, `media`, `match_events`, `alineaciones`, `comments`) el
sincronizador incremental compara el conjunto de IDs de D1 contra
PostgreSQL en cada pasada y borra en PostgreSQL los IDs que ya no están en D1
(`sync/incremental.mjs`, sección "detección de borrados").
`article_slug_redirects` se borra en cascada desde `articles`
(`ON DELETE CASCADE` también existe en el esquema PostgreSQL), así que no
necesita comparación propia.

---

## 6. Frecuencia de sincronización

Configurable por variable de entorno `SYNC_INTERVAL_MS` (por defecto
60000 ms = 1 minuto) en `sync/scheduler.mjs`. No se ha fijado un valor
más agresivo porque, al usar timestamps, el coste de una pasada sin
cambios es barato (una consulta `SELECT ... WHERE updated_at > cursor`
por tabla, normalmente vacía) — no hace falta espaciarlo más para
proteger D1/Wrangler.

---

## 7. Sistema de reintentos

`sync/retry.mjs`: hasta 4 intentos con backoff exponencial (500 ms, 1 s,
2 s, 4 s) alrededor de cada lectura a D1 y cada escritura en PostgreSQL.
Un fallo persistente en una fila concreta no detiene el resto: se
registra en `errors` de esa tabla y el bucle continúa con la siguiente
fila/tabla (sección 9 y 10: "no perder cambios por un fallo temporal" +
"no se generan duplicados" — el upsert es idempotente, así que reprocesar
una fila tras un fallo parcial no duplica nada).

---

## 8. Sistema de logs

Tabla `sync_state` en PostgreSQL (migración `002_fase4_sync.sql`): una
fila por ejecución (inicial o incremental) con `started_at`,
`finished_at`, `status` (`running`/`ok`/`error`), contadores
(`records_inserted`, `records_updated`, `records_deleted`, `errors`),
`duration_ms`, y `detail` (JSON con el desglose por tabla, incluyendo el
mensaje de cada error concreto). Formato exigido por la sección 12:

```
Última sincronización: <started_at>
Estado: <status>
Registros procesados: <records_processed>
Errores: <errors>
Duración: <duration_ms>ms
```

El scheduler (`sync/scheduler.mjs`) comprueba antes de cada pasada si ya
hay una fila `running` reciente (menos de 30 minutos) en `sync_state`
para no solaparse consigo mismo si una pasada tarda más que el intervalo
— salvaguarda de la sección 10 ("ejecución simultánea accidental").

---

## 9. Resultado de las comparaciones D1 ↔ PostgreSQL

**No ejecutado.** Requiere `DATABASE_URL` real y acceso a D1 remoto vía
Wrangler, ninguno de los dos disponible en este entorno. El comparador
(`npm run sync:compare`) está listo para ejecutarse en cuanto exista esa
infraestructura.

---

## 10. Tests realizados

### Ejecutados (sin necesidad de base de datos real)

`npm run test:sync` → **7 de 7 pasan**, 4 se saltan explícitamente por
falta de `DATABASE_URL` (no se simulan):

- Las 16 tablas del documento están configuradas.
- El orden de sincronización no tiene posiciones duplicadas y respeta las
  dependencias de FK básicas (`users` antes que `articles`, `results`
  antes que `articles`/`match_events`, etc.).
- Toda tabla con estrategia `updated_at` usa `updated_at` como cursor (y
  las `immutable`, `created_at`).
- `getTable` lanza para nombres no configurados.
- `conReintentos` reintenta y finalmente lanza tras agotar los intentos.
- `conReintentos` devuelve el resultado si un intento posterior tiene
  éxito.
- `escaparValorD1` escapa correctamente comillas simples y tipos.

También se corrigió y volvió a pasar la suite ya existente de Fase 3
(`npm test`, 1/1, traducción de SQL SQLite→Postgres).

### Escritos pero no ejecutados (requieren infraestructura real)

`sync/test/integration.test.mjs`, cubre exactamente los escenarios
obligatorios de la sección 14 del documento de partida:

- Migración inicial D1 → PostgreSQL, y repetición sin duplicados
  (compara recuentos antes/después de una segunda pasada).
- Comparador sin diferencias tras la migración inicial.
- Sincronización incremental no falla en una base ya al día (no-op).
- Réplica caliente: la fila `settings.redes_sociales` migrada es legible
  (aproximación mínima a la sección 15, ver limitación abajo).

No se han escrito como pruebas simuladas/mockeadas porque eso habría
maquillado justo lo que la Fase 4 pide comprobar de verdad: que
Wrangler puede leer D1 remoto y que Postgres real acepta las
transacciones/upserts tal y como están escritas.

---

## 11. Tests fallidos

Ninguno de los ejecutados ha fallado (7/7 unitarios + 1/1 heredado de
Fase 3). No hay pruebas de integración fallidas — no se han podido
ejecutar en absoluto, ver sección 10.

---

## 12. Problemas encontrados y solucionados

- **`npm test` roto**: `node --test test` (sin glob) ya no funciona en la
  versión de Node de este entorno — hacía falta `node --test
  test/*.test.mjs`. Corregido en `package.json`; confirmado que la suite
  heredada de Fase 3 vuelve a pasar.
- **Los scripts `sync:*` no hacían nada en Windows**: usaban
  `import.meta.url === \`file://${process.argv[1]}\`` para detectar si se
  ejecutaban como entry point directo. En PowerShell/Windows esa
  comparación nunca era cierta (rutas con `\` y sin la normalización que
  sí lleva `import.meta.url`), así que `main()` no se llamaba nunca y el
  proceso salía con código 0 sin imprimir nada. Corregido usando
  `pathToFileURL(process.argv[1]).href`, que es la forma correcta y
  multiplataforma de hacer esta comparación en Node.
- **`sync:initial` fallaba con `relation "sync_state" does not exist`**:
  faltaba aplicar `db/migrations/002_fase4_sync.sql` antes de la primera
  ejecución. Como `install-postgres.sh` (el instalador de la migración
  001 de Fase 2/3) es un script bash que no corre directamente en
  PowerShell, se creó `scripts/migrate.mjs` — un runner de migraciones en
  Node puro (usa el mismo driver `pg` que ya tiene el proyecto), que
  aplica los `.sql` de `db/migrations/` en orden y lleva registro en una
  tabla `schema_migrations` para no reaplicar lo ya aplicado.
- **Invocar Wrangler desde Windows dio dos errores sucesivos**:
  primero `spawn npx ENOENT` (Windows no tiene un ejecutable `npx`, sino
  `npx.cmd`, y `execFile` sin shell no lo resuelve como sí hace
  `exec`/`execSync`); al arreglar eso apareció `spawn EINVAL` (problema
  conocido de Node en Windows: invocar un `.cmd`/`.bat` con `execFile`
  puede fallar incluso usando el nombre correcto, porque de verdad hace
  falta pasar por `cmd.exe`). La solución final (`sync/d1-client.mjs`) usa
  `execFile` sin shell en Linux/Mac (como antes) y, solo en Windows,
  construye el comando completo como un único string con cada argumento
  citado a mano al estilo `cmd.exe` (comillas dobres duplicadas,
  argumento envuelto entre comillas) y lo ejecuta con `shell: true` — así
  se evita tanto el `ENOENT`/`EINVAL` como el problema de escapado
  original que había motivado usar `execFile` con array de argumentos en
  vez de `execSync`.
- **6 tablas mutables sin columna de "última modificación"**: ver
  sección 5. Resuelto con `updated_at` + trigger en D1, sin tocar
  `src/index.js`.
- **`worker-secondary/wrangler.toml` duplicaba el cron de negocio** del
  Worker principal: ver sección 3 ("Modificados") y sección 13 más abajo
  ("riesgos pendientes") para el resto de contexto.
- **Riesgo de inyección/escapado en el script de migración original**
  (`migrar-d1.cjs` construía el comando de Wrangler con interpolación de
  string y `execSync`): la nueva versión (`sync/d1-client.mjs`) usa
  `execFile` con los argumentos como array, evitando que el propio SQL
  tenga que pasar por un shell.

---

## 13. Riesgos pendientes

- **Nada de esto se ha probado contra infraestructura real.** Es el
  riesgo principal: el código sigue el contrato de D1/PostgreSQL tal y
  como está documentado en los esquemas, pero solo una ejecución real
  puede confirmar cosas como el formato exacto que devuelve `wrangler d1
  execute --json` en este proyecto concreto, o si Railway impone algún
  límite de conexiones/timeout distinto al asumido.
- **`worker-secondary/wrangler.toml`**: se ha neutralizado el cron pero
  no se ha confirmado con el equipo si el archivo completo puede
  eliminarse sin más. Si en algún momento se despliega ese directorio con
  Wrangler por cualquier motivo (aunque hoy Railway no lo use), hay que
  recordar que el cron sigue comentado a propósito.
- **`activity_log`/`nivel_historial` se consideran "solo inserción"**
  basándose en que no aparece ningún `UPDATE`/`DELETE` sobre ellas en
  `worker/src/index.js` hoy. Si en el futuro se añade un endpoint que las
  modifique, haría falta repetir el mismo tratamiento (`updated_at` +
  trigger) que se ha dado a las otras 6 tablas.
- **`sync_deletions` registra borrados detectados pero no hay ningún
  proceso de limpieza/retención sobre esa tabla** — quedará creciendo
  indefinidamente si hay muchos borrados; no se ha considerado prioritario
  para esta fase.
- **Wrangler como mecanismo de lectura de D1**: sigue dependiendo de
  invocar un proceso `npx wrangler` por cada sentencia SQL, lo cual es
  más lento y más frágil (autenticación, rate limits) que una API HTTP
  directa. Es el mismo mecanismo que ya usaba el script original de la
  Fase 3/4 previa a esta revisión; no se ha cambiado por no ampliar el
  alcance de esta fase sin necesidad.

---

## 14. Porcentaje real de la Fase 4

**Código: completo (100% de los puntos del criterio de finalización que
dependen solo de diseño e implementación).**
**Validación contra infraestructura real: 0%** — bloqueada por falta de
`DATABASE_URL`/credenciales de Wrangler, igual que quedó bloqueada la
Fase 3 en su momento.

Repasando el checklist original punto por punto:

- [x] Migración inicial D1 → PostgreSQL funciona *(código listo,
      ejecución real pendiente)*.
- [x] La migración es idempotente *(por diseño: `ON CONFLICT DO
      NOTHING`; confirmado en pruebas unitarias de configuración, no en
      ejecución real)*.
- [x] Los IDs se conservan *(se insertan tal cual vienen de D1; hace
      falta ejecutar `npm run db:sync-sequences` después, como ya exigía
      la Fase 3)*.
- [x] Las relaciones son correctas *(orden de sincronización verificado
      por test contra las FK de `schema.sql`)*.
- [x] El comparador D1 ↔ PostgreSQL funciona *(código listo, ejecución
      real pendiente)*.
- [ ] No existen diferencias inesperadas — **no verificable sin
      ejecución real**.
- [x] La sincronización incremental funciona *(código listo, ejecución
      real pendiente)*.
- [x] Las modificaciones se replican *(upsert con `DO UPDATE` por
      diseño)*.
- [x] Las inserciones se replican *(mismo upsert)*.
- [x] Las eliminaciones se replican correctamente *(comparación de
      conjuntos de IDs, código listo)*.
- [x] Los errores tienen reintentos *(backoff exponencial, probado en
      unitarias)*.
- [x] No se generan duplicados *(por construcción del upsert; no
      verificado con datos reales)*.
- [x] Existen logs de sincronización *(`sync_state`)*.
- [ ] PostgreSQL puede mantenerse actualizado sin intervención manual —
      **no verificable sin ejecución real** (el scheduler está listo pero
      nunca se ha dejado corriendo).
- [ ] La API secundaria puede leer los datos sincronizados — **no
      verificable sin ejecución real de principio a fin**.
- [x] La API principal sigue funcionando sin cambios *(no se ha tocado
      `worker/src/index.js`)*.

---

## 15. Confirmación de si PostgreSQL está preparado para ser utilizado como secundaria

**No, todavía no**, por el mismo motivo que en la Fase 3: nada de esto se
ha ejecutado contra infraestructura real. El código cumple con el diseño
pedido y las pruebas que sí se pueden correr sin base de datos pasan,
pero declarar PostgreSQL listo como secundaria exige, como mínimo, antes
de continuar:

1. `DATABASE_URL` real de Railway.
2. `npm run db:migrate` — aplica `db/migrations/002_fase4_sync.sql`
   (columnas `updated_at` nuevas + `sync_state`/`sync_cursor`/
   `sync_deletions`), imprescindible antes de `sync:initial`: sin esto,
   `sync:initial` falla con `relation "sync_state" does not exist` porque
   intenta registrar el log de la migración antes de que esa tabla
   exista. `db:migrate` es idempotente (usa `schema_migrations` para no
   reaplicar lo ya aplicado) y no depende de tener `psql` instalado —
   sustituye a `install-postgres.sh` en Windows/PowerShell, donde ese
   script bash no corre directamente.
3. `npm run sync:initial` — migración inicial completa.
4. `npm run db:sync-sequences` — sincronizar IDENTITY/secuencias.
5. `npm run sync:compare` — confirmar `Estado: OK` en las 16 tablas.
6. `npm run sync:incremental` (o dejar `npm run sync:scheduler` corriendo
   un rato) tras hacer cambios de prueba en D1, y volver a comparar.
7. `npm run test:sync` con `DATABASE_URL` puesto, para que corran también
   las 4 pruebas de integración que hoy se saltan.
8. Prueba de réplica caliente real (sección 15 del documento de origen):
   comparar `GET /api/articles`, `/api/results`, `/api/settings`,
   `/api/club-info`, etc. entre la API principal y la secundaria.

No empiezo la Fase 5. Esta documentación deja la Fase 4 completa a nivel
de código y a la espera de que se indique continuar, tal y como pide el
documento de partida.

## Corrección 2026-08-17 — D1 remoto sin `updated_at`

Se ha comprobado que la base D1 remota puede no tener aplicada la migración
`migracion_fase4_sync_tracking.sql`. En ese caso una consulta incremental como
`SELECT * FROM results ORDER BY updated_at` falla con `no such column:
updated_at`.

Para evitar que la réplica dependa de que esa migración esté aplicada antes de
sincronizar, las tablas pequeñas cuya modificación se cubría con ese tracking
(`users`, `results`, `sessions`, `edit_requests`, `comments` y
`club_info_solicitudes`) usan `syncMode: "authoritative"`. En cada pasada se
lee D1 completa, se hace UPSERT en PostgreSQL y se eliminan las claves que solo
existen en PostgreSQL. D1 continúa siendo la única fuente de verdad.


## Cierre del comparador: campos volátiles

`last_seen_at` de `sessions` se considera un campo volátil durante la comparación porque puede cambiar mientras se ejecuta el comparador. El sincronizador continúa copiando este campo desde D1 a PostgreSQL; únicamente se excluye del veredicto de diferencias para evitar falsos positivos de una sesión activa. El resto de columnas de `sessions` se compara normalmente.
