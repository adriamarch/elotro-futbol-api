-- Fix puntual de datos: partidos que YA ESTÁN "en_juego" ahora mismo con
-- goles_local y/o goles_visitante a NULL (arrancados por el cron
-- automático antes de aplicar el fix de código en iniciarCronometroPartido).
-- Sin este UPDATE, aunque el código ya esté arreglado, estos partidos
-- concretos seguirían sin aparecer en la clasificación en vivo hasta que
-- alguien anotara un gol o los tocara a mano.
--
-- Ejecutar UNA VEZ en cada base de datos (worker principal y worker-secondary):
--   npx wrangler d1 execute <NOMBRE_DB> --remote --file=fix_en_vivo_goles_null.sql

UPDATE results
SET goles_local = COALESCE(goles_local, 0),
    goles_visitante = COALESCE(goles_visitante, 0)
WHERE estado = 'en_juego'
  AND (goles_local IS NULL OR goles_visitante IS NULL);
