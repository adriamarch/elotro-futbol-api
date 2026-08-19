-- Migración 005: añade el hash SHA-256 del contenido de cada archivo
-- subido en "Subir contenido" (misma migración que
-- worker/migracion_media_hash.sql en D1, aplicada aquí a Postgres para
-- que el esquema de ambas bases coincida).

ALTER TABLE media ADD COLUMN IF NOT EXISTS hash_archivo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_hash_unico
  ON media(hash_archivo) WHERE hash_archivo IS NOT NULL;
