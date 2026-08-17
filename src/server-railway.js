// Punto de entrada para Railway (API secundaria).
//
// IMPORTANTE: este archivo es una capa HTTP nueva, totalmente separada de
// src/index.js (el Worker original de Cloudflare, que NO se toca). Por
// ahora solo expone un endpoint de salud para verificar que el servicio
// arranca correctamente en Railway. Los ~45 endpoints reales de la API
// (login, articles, results, etc.) se migrarán en pasos posteriores,
// reutilizando la lógica de src/index.js poco a poco.
//
// No usa D1 ni ningún binding de Cloudflare: de momento no toca base de
// datos en absoluto.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import crypto from "node:crypto";
import handler from "./index.js";
import { createD1CompatDb, checkPostgres, checkSyncFreshness } from "./postgres-db.js";
import { debeEncolarse, encolarEscritura, contarPendientes } from "./pending-writes.js";

const app = new Hono();
app.use(
  "*",
  cors({
    origin: "https://elotrofutbol.media",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

const env = {
  DB: createD1CompatDb(),
  JWT_SECRET: process.env.JWT_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  // Protege POST /api/internal/cron-respaldo (ver src/index.js): debe
  // coincidir con el valor puesto en el cron externo de Railway que
  // llama a este endpoint (cabecera X-Internal-Cron-Secret).
  INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET,
  // Opcional: sobrescribe la URL de /api/health del primario que usa
  // ese mismo endpoint para decidir si debe actuar. Si no se define, usa
  // el dominio workers.dev por defecto (ver src/index.js).
  PRIMARY_HEALTH_URL: process.env.PRIMARY_HEALTH_URL,
};

// Fallo rápido y con mensaje claro si falta JWT_SECRET: sin validar esto
// aquí, el servicio arranca sin problema (Node no se queja de una env var
// vacía), pero la primera vez que alguien inicia sesión, el código de
// firma de JWT (signHS256, vía crypto.subtle.importKey con una clave de
// longitud 0) revienta con "DOMException: Zero-length key is not
// supported" -- un error sin relación aparente con "falta una variable de
// entorno", que además solo aparece en el peor momento posible: cuando la
// primaria ya ha caído y el panel entero depende de que el login funcione
// en la secundaria. Mejor no arrancar en absoluto que arrancar roto.
if (!process.env.JWT_SECRET) {
  console.error(
    "[worker-secondary] FALTA la variable de entorno JWT_SECRET. " +
    "Debe tener EXACTAMENTE el mismo valor que el JWT_SECRET configurado " +
    "en el Worker primario de Cloudflare (wrangler secret put JWT_SECRET), " +
    "si no, los tokens emitidos por una API no se podrán validar en la " +
    "otra. Configúrala en las variables de entorno del servicio de " +
    "Railway y vuelve a desplegar."
  );
  process.exit(1);
}

app.get("/api/health", async (c) => {
  try {
    const database = await checkPostgres();
    // Estado del sincronizador D1 -> PostgreSQL (proceso Node aparte,
    // sync/scheduler.mjs). requireAuth confía en que este proceso esté
    // sano para poder aceptar sesiones aún no replicadas sin arriesgarse a
    // aceptar sesiones revocadas que nunca lleguen a sincronizarse (ver
    // comentario junto a UMBRAL_SYNC_STALE_MS en index.js). Se expone aquí
    // para poder monitorizarlo y alertar si se cae, en vez de descubrirlo
    // solo cuando falla un intento de revocar una sesión.
    const sync = await checkSyncFreshness();
    // Nota deliberada: el estado HTTP (200/503) de este healthcheck sigue
    // dependiendo solo de "database" (Postgres), no del sincronizador. Un
    // sincronizador caído es un problema real (ver requireAuth), pero vive
    // en OTRO proceso/servicio (sync/scheduler.mjs) -- reiniciar este
    // contenedor de server-railway.js no lo arregla. Si este endpoint
    // devolviera 503 por eso, un healthcheck de plataforma (Railway) podría
    // reiniciar el proceso equivocado en bucle sin resolver nada. Por eso
    // "sync" se expone siempre en el body, para monitorización activa
    // (alertas externas), sin acoplarlo al código HTTP de liveness.
    return c.json(
      {
        status: database.ok ? "ok" : "degraded",
        database: database.ok,
        storage: null,
        responseTime: database.responseTime,
        api: "secondary",
        sync: {
          healthy: !sync.stale,
          lastSyncedAt: sync.lastSyncedAt,
          staleForMs: sync.staleForMs,
          reason: sync.reason,
        },
      },
      database.ok ? 200 : 503
    );
  } catch (error) {
    console.error("[health] PostgreSQL error:", error);
    return c.json({ status: "degraded", database: false, storage: null, responseTime: null, api: "secondary" }, 503);
  }
});

app.all("*", async (c) => {
  if (c.req.path === "/api/health") return c.notFound();
  if (c.req.path === "/api/internal/pending-writes-count") {
    // Solo diagnóstico (panel/monitorización), sin datos sensibles del
    // contenido de las escrituras -- por eso no pasa por requireAuth de
    // index.js. No se expone el contenido de la cola aquí, solo conteos.
    const counts = await contarPendientes();
    return c.json(counts);
  }

  const method = c.req.method;
  const path = c.req.path;
  const esFailoverReal = c.req.header("X-Failover-Origin") === "worker-primary";

  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch((error) => console.error("[waitUntil]", error)); } };

  // Si esta escritura puede necesitar encolarse, hace falta leer el body
  // ANTES de pasarlo a handler.fetch (que también lo consume) -- de ahí el
  // clone(). Para el resto de peticiones (GET, o failover no confirmado)
  // no merece la pena el coste de leer y clonar el body sin necesidad.
  const candidataAEncolar = esFailoverReal && debeEncolarse(method, path);
  let bodyTexto = null;
  if (candidataAEncolar) {
    try {
      bodyTexto = await c.req.raw.clone().text();
    } catch (error) {
      console.error("[pending-writes] no se pudo leer el body para encolar:", error.message);
    }
  }

  // writeId se genera AQUÍ, antes de que Postgres atienda la petición, y no
  // dentro de encolarEscritura() como antes -- así puede pasarse también al
  // handler como cabecera X-Write-Id para que, si la petición crea una fila
  // nueva (POST /api/articles o /api/results), esa fila nazca ya con
  // origin_write_id = writeId en Postgres. Cuando esta misma escritura se
  // reproduzca luego contra D1 (ver drainPendingWrites en
  // worker/src/index.js, que reenvía el mismo write_id de la cola), D1
  // creará su fila con el MISMO origin_write_id, lo que permite a
  // sync/incremental.mjs reconciliar ambas filas como una sola en vez de
  // duplicar (ver worker/migracion_origin_write_id.sql para el porqué
  // completo). Sin esto, el id que ligaba ambos lados solo vivía en la
  // cola (pending_writes.write_id) y nunca llegaba a las tablas de negocio.
  const writeId = candidataAEncolar ? crypto.randomUUID() : null;
  const requestConWriteId = writeId
    ? new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) })
    : c.req.raw;
  if (writeId) requestConWriteId.headers.set("X-Write-Id", writeId);

  const response = await handler.fetch(requestConWriteId, env, ctx);

  if (candidataAEncolar && response.status < 500) {
    // Solo se encola si Postgres/Railway la atendió con éxito (< 500): si
    // Railway también la rechazó (validación, permisos, etc.), no hay nada
    // que reproducir -- el usuario ya vio el error y no hizo falta cambiar
    // nada. Encolarla igualmente duplicaría trabajo sin sentido cuando D1
    // vuelva, y generaría fallos previsibles en la cola por el mismo
    // motivo que ya falló aquí.
    let userId = null;
    try {
      const auth = c.req.header("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) {
        const payloadB64 = token.split(".")[1];
        if (payloadB64) {
          const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
          userId = payload.uid ?? null;
        }
      }
    } catch {
      // Decodificación best-effort solo para metadata de auditoría; un
      // JWT raro no debe impedir encolar la escritura.
    }
    ctx.waitUntil(
      encolarEscritura({
        writeId,
        method,
        path,
        queryString: new URL(c.req.url).search,
        body: bodyTexto,
        authorizationHeader: c.req.header("Authorization") || null,
        userId,
        originalStatus: response.status,
      })
    );
  }

  return response;
});

const port = Number(process.env.PORT) || 8080;

// Railway (y contenedores en general) solo enrutan tráfico externo hacia
// 0.0.0.0. Si se escucha en localhost/127.0.0.1 (comportamiento por
// defecto de @hono/node-server), el proceso arranca y pasa el healthcheck
// interno, pero el dominio público nunca llega a conectar.
serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
}, (info) => {
  console.log(`[worker-secondary] API secundaria escuchando en 0.0.0.0:${info.port}`);
});
