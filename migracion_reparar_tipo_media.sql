-- Migración de reparación: corrige la columna "tipo" de "media" para los
-- archivos que se guardaron mal etiquetados como "foto" siendo en
-- realidad un vídeo (o viceversa).
--
-- Contexto: al subir un archivo, "tipo" se calculaba a mano a partir del
-- MIME que mandaba el navegador (file.type) y, si venía vacío o genérico
-- (application/octet-stream, algo frecuente con .mov/.mkv en ciertos
-- móviles), de la extensión del nombre del archivo. Eso podía guardar
-- "foto" para un vídeo real. Cloudinary, en cambio, sí analiza el
-- archivo de verdad y ya guardábamos su resultado en
-- "cloudinary_resource_type" ("image" o "video"), así que esta migración
-- usa esa columna -ya fiable- para corregir "tipo" con los datos que ya
-- están en la base de datos, sin tener que volver a subir nada.
--
-- A partir de esta migración, /api/media (POST) también calcula "tipo"
-- usando resourceType en vez de reconstruirlo a mano, así que este
-- problema no debería volver a producirse con subidas nuevas.
--
-- Ejecutar primero en local/dev y después en remoto:
--   wrangler d1 execute elotrofutbol --local --file=./migracion_reparar_tipo_media.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_reparar_tipo_media.sql

UPDATE media
SET tipo = 'video'
WHERE cloudinary_resource_type = 'video' AND tipo <> 'video';

UPDATE media
SET tipo = 'foto'
WHERE cloudinary_resource_type = 'image' AND tipo <> 'foto';
