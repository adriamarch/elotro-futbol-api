-- Recordatorios de galería a fotógrafos acreditados (ver "RECORDATORIO DE GALERÍA A
-- FOTÓGRAFOS ACREDITADOS" en src/index.js).
--
-- Una fila por (solicitud de acreditación, partido) ya avisada: evita repetir el correo.
-- El Worker la crea solo la primera vez que hace falta (CREATE TABLE IF NOT EXISTS), así que
-- ejecutar esto a mano es opcional.
--
-- NO añadir esta tabla a worker-secondary/sync/tables.mjs: la lógica solo corre en el
-- Worker principal (D1) para que los correos no salgan duplicados.
--
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_recordatorios_galeria.sql
CREATE TABLE IF NOT EXISTS recordatorios_galeria (
  acreditacion_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  email TEXT,
  enviado_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (acreditacion_id, result_id)
);
