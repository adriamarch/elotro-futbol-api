-- Migración: perfil de autor ampliado (redactores y fotógrafos).
--   cargo                  Texto corto bajo el nombre (p. ej. "Redactor de Hypermotion").
--   ciudad                 Ciudad o zona desde la que trabaja.
--   articulo_destacado_id  Noticia propia ya publicada que se fija arriba en su perfil público.
-- Las redes nuevas (linkedin, threads, facebook, web) NO necesitan columna:
-- viven en el JSON de users.redes_sociales.
--
-- Es segura aunque no se ejecute todavía: el código sigue funcionando sin estas
-- columnas (simplemente no guarda ni enseña esos tres campos).
--
-- Ejecutar con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_perfil_autores_v2.sql
ALTER TABLE users ADD COLUMN cargo TEXT;
ALTER TABLE users ADD COLUMN ciudad TEXT;
ALTER TABLE users ADD COLUMN articulo_destacado_id INTEGER;
