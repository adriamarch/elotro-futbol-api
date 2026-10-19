# Relleno automático de partidos (TheSportsDB)

Trae los partidos que ningún redactor cubre (calendario + resultados) para que
salgan en el calendario y cuenten en la clasificación.

## Puesta en marcha
1. Despliega `worker` y `worker-secondary` (el código está en los dos, con paridad).
2. Requisitos de BD (ya incluidos en `migracion_relleno_automatico.sql` / `010_relleno_automatico.sql`):
   columnas `results.fuente` y `results.external_id`, tablas `equipo_alias_externo` y `sync_partidos_auto`.
3. Panel → Resultados → Calendario de jornadas → **Relleno automático**:
   - «Buscar IDs de TheSportsDB» → pulsa la liga para rellenar el ID.
   - Una fila por competición/grupo (Hypermotion 1, Primera Fed. 2 grupos, Segunda Fed. 5 grupos).
   - «Guardar configuración» y «Rellenar todos los partidos ahora».
4. «Equipos sin reconocer»: asigna el nombre de la API al del sitio. Se corrigen los partidos ya
   guardados y se unifican los duplicados con partidos de redacción.

Sin ligas configuradas no se hace nada.

## Cómo funciona
- **Ciclo diario** (a partir de las 04:00, hora de Madrid): recorre todas las jornadas de cada liga,
  repartido en pasadas de 5 min con cursor por liga y presupuesto de subrequests
  (`SYNC_MAX_SUBREQUESTS`, 40 por defecto = plan gratuito de Workers).
- **Refresco vivo** (cada 15 min): solo si hay partidos automáticos que ya deberían haber empezado y
  no tienen resultado; pide solo esas jornadas.
- Solo escribe filas que cambian. Estados que escribe: `programado` y `finalizado`.
- Jornada: primero `jornadas_calendario`, luego la ronda de la API.
- Hora: TheSportsDB da UTC; se guarda en hora de Madrid. Sin hora fiable se guarda solo la fecha.
- Ubicación: la de la API o, si falta, la del último partido del mismo local.

## Reglas de seguridad
- Un redactor siempre gana: editar un partido automático lo pasa a `redaccion` (ya lo hacía el PUT) y
  el relleno deja de tocarlo. Tampoco toca partidos con autor o cronómetro.
- Si ya existe un partido de redacción con la misma pareja de equipos, no se crea otro.
- Si casi ningún equipo de la API coincide con los del sitio, esa liga se omite (probable ID erróneo).
- `iniciarPartidosProgramadosCuyaHoraHaLlegado` ignora los partidos automáticos (antes los habría
  pasado a «en juego» y luego a «finalizado no cubierto»).

## Opcional
- Secreto `THESPORTSDB_API_KEY` (clave premium): usa `eventsseason.php`, 1 petición por liga.
- Rutas admin: `GET/PUT /api/admin/sync-partidos[/config]`, `POST /api/admin/sync-partidos/ejecutar`,
  `GET /api/admin/sync-partidos/ligas`, `GET/POST/DELETE /api/admin/alias-equipos`.
