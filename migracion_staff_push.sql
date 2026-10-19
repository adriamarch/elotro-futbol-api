-- Migración: notificaciones push del equipo (campanita del panel de redactores).
-- Solo admins y redactores de Nivel 4 pueden activarlas. Se guardan aparte de
-- push_subscriptions (el push público de lectores):
--   * staff_push_subscriptions: un dispositivo/navegador por fila, ligado a la cuenta.
--   * staff_push_prefs: categorías activadas por persona (una fila = categoría activa).
--     Categorías: contenido, acreditaciones, incorporaciones, noticias, fichas,
--     tienda, ediciones, comentarios, anuncios.
--
--   npx wrangler d1 execute elotrofutbol --remote --file=worker/migracion_staff_push.sql
-- Para Postgres (Railway) usa worker-secondary/db/migrations/056_staff_push.sql.

CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_push_user ON staff_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS staff_push_prefs (
  user_id INTEGER NOT NULL,
  categoria TEXT NOT NULL,
  PRIMARY KEY (user_id, categoria)
);
CREATE INDEX IF NOT EXISTS idx_staff_push_prefs_cat ON staff_push_prefs(categoria);
