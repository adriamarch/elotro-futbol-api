-- Anuncios por correo desde el panel de admin (Funcionalidades > Anuncios).
-- Ejecutar sobre la base D1 ya desplegada:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_anuncios_email.sql
-- Si la base es nueva, añade también este bloque a schema.sql.

CREATE TABLE IF NOT EXISTS anuncios_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  -- JSON: lista antigua ["admins","lectores"] o selección por personas
  -- {"admins":"todos","redactores":["ana@x.com"]} (sin migración: mismo campo)
  audiencias TEXT NOT NULL,
  boton_texto TEXT,
  boton_url TEXT,
  creado_por_id INTEGER,
  creado_por_nombre TEXT,
  total_destinatarios INTEGER NOT NULL DEFAULT 0,
  enviados INTEGER NOT NULL DEFAULT 0,
  fallidos INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'enviando', -- 'enviando' | 'completado'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completado_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_anuncios_email_created ON anuncios_email(created_at);
