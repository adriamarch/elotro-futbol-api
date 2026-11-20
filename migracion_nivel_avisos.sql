-- Migración: avisos de niveles (Funcionalidades > Responsabilidades > Redacción / Fotografía)
--
-- Cuando alguien cumple los requisitos del siguiente nivel, los Responsables reciben UN aviso (push en la
-- campanita, categoría «niveles», y correo). Esta tabla guarda a quién ya se avisó y para qué nivel, así no se
-- repite el aviso de la misma persona y nivel. El Worker también la crea solo la primera vez que se usa
-- (CREATE TABLE IF NOT EXISTS), así que ejecutar este archivo es opcional y seguro de repetir.
-- Las preferencias del correo van en settings (clave «niveles_avisos_email_off:<id de usuario>»), sin migración.
--
--   npx wrangler d1 execute elotrofutbol --remote --file=worker/migracion_nivel_avisos.sql

CREATE TABLE IF NOT EXISTS nivel_avisos (
  usuario_id INTEGER NOT NULL,
  nivel_objetivo INTEGER NOT NULL,
  avisado_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, nivel_objetivo)
);
