#!/usr/bin/env node
// Scheduler del sincronizador D1 -> PostgreSQL (FASE4.md sección 11).
//
// Proceso Node independiente y separado de cualquier tarea de negocio.
// NO es el cron de Cloudflare Workers ([triggers] en wrangler.toml, que
// ya ejecuta cada minuto la publicación programada / avisos / tareas
// deportivas del Worker principal) ni lo sustituye ni lo toca. La Fase 3
// detectó el riesgo de doble ejecución de esas tareas si se dispara el
// mismo cron desde dos sitios; por eso este scheduler:
//
//   1. Vive en un proceso propio (`node sync/scheduler.mjs`), pensado
//      para lanzarse como un servicio/worker separado en Railway (un
//      segundo "service" en el mismo proyecto, o un cron job de Railway),
//      nunca dentro del Worker de Cloudflare ni de server-railway.js.
//   2. No importa ni ejecuta nada de worker/src/index.js ni de
//      worker-secondary/src/index.js.
//   3. Antes de cada pasada comprueba en sync_state si ya hay una
//      ejecución 'running' (ver sync/incremental.mjs) para no solaparse
//      consigo mismo si una pasada tarda más que el intervalo.
//
// Uso:
//   SYNC_INTERVAL_MS=60000 node sync/scheduler.mjs
// (por defecto, cada 60s; ajustable sin tocar código)

import { pathToFileURL } from "node:url";
import { ejecutarSincronizacionIncremental } from "./incremental.mjs";

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 60_000);

let detenido = false;
process.on("SIGTERM", () => { detenido = true; });
process.on("SIGINT", () => { detenido = true; });

async function bucle() {
  console.log(`Scheduler de sincronización iniciado. Intervalo: ${INTERVAL_MS}ms`);
  while (!detenido) {
    try {
      await ejecutarSincronizacionIncremental();
    } catch (error) {
      console.error("Error en pasada de sincronización:", error.message);
      // No relanzamos: el scheduler debe seguir vivo para el próximo
      // intento aunque una pasada falle por completo.
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  console.log("Scheduler detenido.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  bucle();
}
