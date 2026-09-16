-- Newsletter / boletín semanal: tabla de personas suscritas.
-- Ejecutar sobre una base de datos D1 ya desplegada (no toca datos
-- existentes). Si la base de datos es nueva, añade también estas líneas
-- a schema.sql antes de crearla.

CREATE TABLE IF NOT EXISTS newsletter_suscriptores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  -- Token propio de este suscriptor para darse de baja con un enlace sin
  -- necesidad de iniciar sesión (va en cada boletín enviado).
  baja_token TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  baja_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_suscriptores(email);

-- Registro del último boletín semanal enviado, para que el disparador
-- programado (cron) sepa si ya tocó esta semana sin tener que llevar
-- cuenta aparte. Solo hay una fila, con id fijo = 1.
CREATE TABLE IF NOT EXISTS newsletter_envios (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_envio_at TEXT
);
INSERT OR IGNORE INTO newsletter_envios (id, ultimo_envio_at) VALUES (1, NULL);
