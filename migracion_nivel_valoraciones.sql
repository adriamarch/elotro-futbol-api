-- Migración: valoraciones de ascenso (Funcionalidades > Responsabilidades > Redacción / Fotografía)
--
-- Cuando una persona cumple los requisitos del siguiente nivel, un Responsable decide desde su tarjeta
-- «Subir de nivel» o «Ahora no». Subir ya queda en nivel_historial (migracion_niveles.sql); esta tabla
-- guarda las decisiones «Ahora no» (quién, cuándo y por qué) para que el criterio de la dirección no se pierda.
-- El Worker también la crea solo la primera vez que se usa (CREATE TABLE IF NOT EXISTS), así que ejecutar
-- este archivo es opcional y seguro de repetir.
--
--   npx wrangler d1 execute elotrofutbol --remote --file=worker/migracion_nivel_valoraciones.sql

CREATE TABLE IF NOT EXISTS nivel_valoraciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  nivel_objetivo INTEGER NOT NULL,
  decision TEXT NOT NULL,              -- 'aplazado'
  nota TEXT,
  decidido_por_id INTEGER,
  decidido_por_nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nivel_valoraciones_usuario ON nivel_valoraciones(usuario_id, nivel_objetivo);
