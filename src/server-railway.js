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
import handler from "./index.js";
import { createD1CompatDb, checkPostgres } from "./postgres-db.js";

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
};

app.get("/api/health", async (c) => {
  try {
    const database = await checkPostgres();
    return c.json({ status: database.ok ? "ok" : "degraded", database: database.ok, storage: null, responseTime: database.responseTime, api: "secondary" }, database.ok ? 200 : 503);
  } catch (error) {
    console.error("[health] PostgreSQL error:", error);
    return c.json({ status: "degraded", database: false, storage: null, responseTime: null, api: "secondary" }, 503);
  }
});

app.all("*", async (c) => {
  if (c.req.path === "/api/health") return c.notFound();
  const ctx = { waitUntil(promise) { Promise.resolve(promise).catch((error) => console.error("[waitUntil]", error)); } };
  return handler.fetch(c.req.raw, env, ctx);
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
