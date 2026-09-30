-- Estado de los recordatorios automáticos a redactores inactivos (ver
-- "RECORDATORIOS DE INACTIVIDAD DE REDACTORES" en src/index.js).
--
-- Una fila por redactor que ya ha recibido al menos un aviso:
--   ref_actividad      fecha de referencia del ciclo (última noticia o, si
--                      nunca subió nada, creación de la cuenta). Si el
--                      redactor sube algo después, la referencia real pasa
--                      a ser posterior y el ciclo se reinicia solo.
--   avisos_enviados    0-5. Al 5º aviso el texto lleva el incumplimiento del
--                      apartado 2.1.5 (Compromiso) de la guía del medio.
--   ultimo_aviso_at    cuándo salió el último aviso (ISO, UTC); de ahí se
--                      cuentan los 5 días hasta el siguiente aviso o hasta
--                      avisar a los admins.
--   admins_avisados_at cuándo se avisó a los admins de que hay que expulsar
--                      a este usuario (NULL = todavía no).
--
-- NO añadir esta tabla a worker-secondary/sync/tables.mjs: la lógica solo
-- corre en el Worker principal (D1) para no mandar los avisos duplicados.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_recordatorios_inactividad.sql
CREATE TABLE IF NOT EXISTS recordatorios_inactividad (
  user_id INTEGER PRIMARY KEY,
  ref_actividad TEXT NOT NULL,
  avisos_enviados INTEGER NOT NULL DEFAULT 0,
  ultimo_aviso_at TEXT,
  admins_avisados_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
