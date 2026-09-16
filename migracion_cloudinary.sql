-- Migración: pasar de Google Drive a Cloudinary para el contenido
-- multimedia. Solo hace falta ejecutarla si la base de datos YA tenía la
-- tabla `media` con la columna `drive_file_id` (versión anterior con
-- Google Drive). Si es una base de datos nueva o solo tenías la versión
-- con R2, no la ejecutes: usa migracion_media.sql o schema.sql, que ya
-- traen las columnas correctas.
--
-- IMPORTANTE: esto solo prepara la base de datos. Los archivos que ya
-- estuvieran subidos a Drive NO se mueven automáticamente a Cloudinary;
-- habría que volver a subirlos desde "Subir contenido".

ALTER TABLE media RENAME COLUMN drive_file_id TO cloudinary_public_id;
ALTER TABLE media ADD COLUMN cloudinary_resource_type TEXT NOT NULL DEFAULT 'image';
ALTER TABLE media ADD COLUMN cloudinary_url TEXT NOT NULL DEFAULT '';
