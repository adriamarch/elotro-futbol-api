-- Migración: añade el hash SHA-256 del contenido de cada archivo subido
-- en "Subir contenido", para poder detectar y bloquear duplicados aunque
-- el archivo se renombre (el hash depende solo de los bytes, no del
-- nombre). Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_media_hash.sql

ALTER TABLE media ADD COLUMN hash_archivo TEXT;

-- Índice único: dos archivos con el mismo hash no pueden coexistir en la
-- tabla. Es parcial (WHERE hash_archivo IS NOT NULL) para no romper los
-- registros ya existentes que se subieron antes de esta migración y que,
-- por tanto, no tienen hash calculado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_hash_unico
  ON media(hash_archivo) WHERE hash_archivo IS NOT NULL;
