-- Migración: portada obligatoria en las galerías de partido.
--
-- Contexto: la galería pública de un partido (match_gallery) no tenía una
-- foto "de portada" propia: allí donde hacía falta una imagen representativa
-- (portada del sitio, listado /galerias, vista previa al compartir el enlace)
-- se usaba simplemente la primera foto por orden. Ahora quien hace la galería
-- ELIGE la portada y es obligatorio hacerlo (ver el panel: "Subir contenido"
-- y "Galería de partido").
--
--   match_gallery.es_portada: 1 en la foto que es la portada de la galería de
--   ESE partido, 0 en el resto. Debe haber como mucho una por partido (lo
--   garantiza el código al fijarla, ver fijarPortadaGaleria() en src/index.js).
--   Va en la tabla puente y no en "media" porque una misma imagen puede estar
--   en varios partidos y ser portada solo de uno de ellos.
--
-- Las galerías que ya existían se rellenan con su primera foto pública (la
-- misma que se venía usando como imagen representativa), para que ninguna
-- quede sin portada. Quien las gestione podrá cambiarla desde el panel.
--
-- Ejecutar DESPUÉS de migracion_media_visibilidad.sql (usa media.visibilidad):
--   wrangler d1 execute elotrofutbol --local  --file=./migracion_galeria_portada.sql
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_galeria_portada.sql
-- Y en el secundario (Railway), ANTES de la siguiente sincronización:
--   worker-secondary/db/migrations/076_match_gallery_portada.sql

ALTER TABLE match_gallery ADD COLUMN es_portada INTEGER NOT NULL DEFAULT 0;

UPDATE match_gallery
   SET es_portada = 1
 WHERE id IN (
   SELECT (
     SELECT mg2.id
       FROM match_gallery mg2
       JOIN media m ON m.id = mg2.media_id
      WHERE mg2.result_id = g.result_id
        AND (m.tipo = 'foto' OR m.tipo IS NULL)
        AND m.visibilidad = 'publico'
      ORDER BY mg2.orden ASC, mg2.created_at ASC
      LIMIT 1
   )
   FROM (SELECT DISTINCT result_id FROM match_gallery) g
 );
