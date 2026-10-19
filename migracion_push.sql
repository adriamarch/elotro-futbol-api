-- Notificaciones push (Web Push): una fila por navegador/dispositivo suscrito.
-- Ejecutar sobre la D1 ya desplegada (no toca datos existentes):
--   npx wrangler d1 execute elotrofutbol --remote --file=migracion_push.sql
-- Si la base de datos es nueva, esta misma tabla ya esta en schema.sql.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  noticias INTEGER NOT NULL DEFAULT 1,
  partidos INTEGER NOT NULL DEFAULT 1,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_noticias ON push_subscriptions(noticias);
CREATE INDEX IF NOT EXISTS idx_push_partidos ON push_subscriptions(partidos);
