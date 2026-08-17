-- Migración: pasar de R2 a Google Drive para el contenido multimedia.
-- Solo hace falta ejecutarla si la base de datos YA tenía la tabla
-- `media` creada (con la columna `r2_key`). Si es una base de datos
-- nueva, no hace falta: schema.sql ya trae la columna `drive_file_id`.
--
-- IMPORTANTE: esto solo renombra la columna en la base de datos. Los
-- archivos que ya estuvieran subidos a R2 NO se mueven automáticamente
-- a Google Drive (son sistemas distintos); habría que volver a subirlos
-- desde "Subir contenido", o pedir un script aparte que los copie de R2
-- a Drive si hay muchos.

ALTER TABLE media RENAME COLUMN r2_key TO drive_file_id;
