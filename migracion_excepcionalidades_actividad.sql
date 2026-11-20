-- Excepcionalidades de actividad (ver "EXCEPCIONALIDADES DE ACTIVIDAD" en src/index.js).
-- Un Responsable concede a un redactor 3 días o 1 semana de margen extra de inactividad por una
-- causa justificable (estudios, fallecimiento de un familiar, salud...). Mientras está en vigor no
-- se mandan avisos de inactividad y esos días no cuentan como tiempo sin subir nada.
--   desde / hasta   días de calendario de Madrid (YYYY-MM-DD), ambos incluidos
--   cancelada_at    NULL = vigente/valida; con fecha = cancelada por un Responsable
--   correo_enviado_at  cuándo salió el correo automático al colaborador (NULL = no salió)
-- NO añadir a worker-secondary/sync/tables.mjs (igual que recordatorios_inactividad).
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_excepcionalidades_actividad.sql
CREATE TABLE IF NOT EXISTS excepciones_actividad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  causa TEXT NOT NULL,
  nota TEXT,
  dias INTEGER NOT NULL,
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  concedida_por_id INTEGER,
  concedida_por_nombre TEXT,
  correo_enviado_at TEXT,
  cancelada_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_excepciones_actividad_user ON excepciones_actividad (user_id, desde);
