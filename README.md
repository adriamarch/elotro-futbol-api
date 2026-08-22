# worker-secondary — API secundaria (Railway + PostgreSQL)

Para que la secundaria funcione como una réplica completa e
independiente del Worker principal de Cloudflare (mismos datos, mismo
comportamiento "en vivo"), hacen falta **tres servicios distintos**
corriendo en el mismo proyecto de Railway. No es uno solo: cada pieza
tiene un trabajo distinto y se despliega por separado.

## Los tres servicios

### 1. API HTTP — `server-railway.js`

El servicio que ya tienes desplegado. Atiende las peticiones normales
del sitio (`/api/results`, `/api/articles`, login, etc.) contra
PostgreSQL.

- **Start Command**: `npm start`
- Variables de entorno: `DATABASE_URL`, `JWT_SECRET` (mismo valor que
  en el Worker principal), `RESEND_API_KEY`, `CLOUDINARY_*`,
  `INTERNAL_CRON_SECRET` (ver servicio 3).

### 2. Sincronizador de datos — `sync/scheduler.mjs`

Mantiene PostgreSQL al día con D1 (el principal): trae artículos,
resultados, comentarios, usuarios, etc. Corre en bucle, cada 60
segundos por defecto. Ver `FASE4-sincronizacion.md` para el detalle
completo de cómo sincroniza.

- **Start Command**: `npm run sync:scheduler`
- Variables de entorno: `DATABASE_URL` (la misma que el servicio 1),
  más las necesarias para leer D1 remoto (credenciales de Wrangler —
  ver `sync/d1-client.mjs`).
- Opcional: `SYNC_INTERVAL_MS` para cambiar el intervalo (por defecto
  60000).

**Sin este servicio corriendo, la secundaria tiene datos cada vez más
viejos** aunque la API HTTP (servicio 1) responda perfectamente.

### 3. Cron de tareas periódicas — `scripts/cron-respaldo.mjs`

Dispara en Postgres las mismas tareas automáticas que el cron trigger
de Cloudflare ejecuta cada minuto en el principal: arrancar el
cronómetro de partidos programados (esto es lo que hace que la
clasificación se vea "en directo"), publicar noticias programadas,
avisar de partidos desatendidos, enviar el boletín semanal. Ver
`CRON-RESPALDO.md` para el detalle completo, incluida la respuesta
esperada al probarlo.

- Se configura como **servicio Cron nativo de Railway** (no un
  `npm start` normal — arranca, ejecuta, se apaga solo).
- **Start Command**: `npm run cron:respaldo`
- **Cron Schedule**: `*/5 * * * *`
- Variables de entorno: `CRON_RESPALDO_URL` (URL pública del servicio
  1 + `/api/internal/cron-respaldo`), `INTERNAL_CRON_SECRET` (mismo
  valor que en el servicio 1).

**Sin este servicio corriendo, los datos pueden estar sincronizados
(gracias al servicio 2) pero nada arranca los partidos automáticamente
en la secundaria** — es decir, exactamente el síntoma de "ayer se veía
en directo y hoy no".

## Por qué tres servicios y no uno

Railway cobra por tiempo de proceso activo. El sincronizador (2) sí
necesita estar siempre corriendo (es un bucle). El cron de tareas (3)
en cambio se beneficia de ser un Cron Job nativo de Railway: arranca,
hace una llamada HTTP, y se apaga — no malgasta recursos el resto de
los 5 minutos. Fusionarlo con el servicio 1 tampoco vale, porque un
cron periódico dentro del propio proceso HTTP (`setInterval`) se
perdería en cada reinicio/redeploy y no es lo que Railway espera para
tareas programadas.

## Checklist de una instalación completa

- [ ] Servicio 1 (`server-railway.js`) desplegado y `/api/health`
      responde `200`.
- [ ] Servicio 2 (`sync/scheduler.mjs`) desplegado y corriendo — revisa
      sus logs, debe imprimir una pasada cada `SYNC_INTERVAL_MS`.
- [ ] Servicio 3 (Cron `cron-respaldo.mjs`) creado con schedule
      `*/5 * * * *` — fuerza una ejecución manual desde el dashboard y
      confirma la respuesta `{"ok":true,...}` (ver `CRON-RESPALDO.md`).
- [ ] `INTERNAL_CRON_SECRET` coincide exactamente entre el servicio 1 y
      el servicio 3.
- [ ] `JWT_SECRET` coincide exactamente entre el Worker principal y el
      servicio 1 (si no, los tokens de sesión no son intercambiables
      entre ambos backends).

Con los tres servicios corriendo, la secundaria queda funcionalmente
equivalente al principal en todo momento, sin depender de que el
principal esté vivo ni de ningún healthcheck cruzado.
