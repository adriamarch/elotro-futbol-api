# Cron de respaldo (tareas programadas cuando el primario cae)

## Por qué existe

El Worker principal de Cloudflare (`worker/wrangler.toml`) tiene un cron
trigger (`* * * * *`, cada minuto) que:

- publica noticias programadas (`programado_para`),
- arranca automáticamente partidos programados,
- avisa por email de partidos "desatendidos" (nadie ha pulsado
  Descanso/Fin del partido).

Ese cron **solo existe en el Worker principal**. Si el Worker de
Cloudflare deja de responder por completo (no solo D1: el propio dominio
inalcanzable), nada dispara esas tres tareas hasta que vuelva. Este
documento explica cómo desplegar un cron de respaldo en Railway que las
ejecuta contra PostgreSQL **solo cuando detecta que el primario no
responde**, para no duplicar publicaciones si ambos backends estuvieran
vivos a la vez.

## Piezas nuevas

1. **`POST /api/internal/cron-respaldo`** en `src/index.js`: protegido
   por un secreto compartido (cabecera `X-Internal-Cron-Secret`).
   Antes de hacer nada, comprueba `GET /api/health` del Worker
   principal; si responde con `database: true`, no actúa (el cron del
   propio primario ya se encarga). Si no responde, o responde
   degradado, ejecuta las tres tareas contra PostgreSQL.
2. **`scripts/cron-respaldo.mjs`**: un script de una sola ejecución
   (arranca, llama al endpoint anterior, termina) pensado para un
   **servicio Cron nativo de Railway** (no un `setInterval` corriendo
   sin parar — Railway cobra por tiempo activo, y sus Cron Jobs están
   pensados para arrancar, ejecutar y apagarse solos).

## Pasos para desplegarlo

### 1. Variables de entorno en el servicio `server-railway.js` (el que ya tienes)

Añade en Railway → tu proyecto → servicio de la API secundaria → Variables:

```
INTERNAL_CRON_SECRET=<una cadena larga y aleatoria, la que quieras>
```

(Opcional) Si el subdominio `workers.dev` del Worker principal cambiara
alguna vez:

```
PRIMARY_HEALTH_URL=https://TU-SUBDOMINIO.workers.dev/api/health
```

Vuelve a desplegar ese servicio para que recoja la variable nueva.

### 2. Crear el servicio Cron en Railway

Dentro del **mismo proyecto** de Railway:

1. "New" → "Empty Service" (o duplica el servicio existente y cambia su
   comando de arranque).
2. Conéctalo al mismo repositorio/carpeta `worker-secondary/`.
3. En Settings de ese nuevo servicio:
   - **Start Command**: `npm run cron:respaldo`
   - **Cron Schedule**: `*/5 * * * *` (cada 5 minutos — es el mínimo que
     permite Railway; no puede ser cada minuto como en Cloudflare).
4. Variables de entorno de este servicio Cron (no las confundas con las
   del servicio principal de Railway, aunque puede que Railway te deje
   compartirlas si usas "Shared Variables"):

```
CRON_RESPALDO_URL=https://TU-SERVICIO.up.railway.app/api/internal/cron-respaldo
INTERNAL_CRON_SECRET=<el MISMO valor que pusiste en el paso 1>
```

`CRON_RESPALDO_URL` es la URL pública de tu servicio
`server-railway.js` (la misma que ya usa `SECONDARY_API` en
`public/js/config.js`) + `/api/internal/cron-respaldo`.

### 3. Verificar

- Con el primario vivo: fuerza una ejecución manual del servicio Cron
  desde el dashboard de Railway. La respuesta debe ser
  `{"ok":true,"actuado":false,"motivo":"primaria_viva"}` — no debe tocar
  ninguna tabla.
- Simulando el primario caído (por ejemplo, apunta temporalmente
  `PRIMARY_HEALTH_URL` a una URL que no exista): la respuesta debe ser
  `{"ok":true,"actuado":true,"motivo":"primaria_caida","resultados":{...}}`.
  Revierte la variable después de la prueba.

## Limitación conocida: intervalo de 5 minutos, no 1

El cron del Worker principal corre cada minuto; el de Railway, como
mínimo cada 5 (límite de la plataforma). Esto significa que, durante una
caída larga del primario, una noticia programada o un partido programado
podrían tardar hasta ~5 minutos de más en activarse, en vez del minuto
habitual. Es una degradación aceptada, no un fallo: sigue siendo mucho
mejor que quedarse sin ninguna publicación automática hasta que el
primario vuelva.
