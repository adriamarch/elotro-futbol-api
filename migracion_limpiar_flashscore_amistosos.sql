-- Migración: limpia el enlace a Flashscore guardado en partidos que no
-- deberían tenerlo (amistosos, competiciones sin Flashscore, o partidos
-- que aún no están finalizados). Se ejecuta una sola vez para arreglar
-- datos guardados antes de que el backend validara esto al guardar.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_limpiar_flashscore_amistosos.sql

UPDATE results
SET flashscore_url = NULL
WHERE flashscore_url IS NOT NULL
  AND (
    competicion NOT IN ('hypermotion', 'primera_federacion', 'segunda_federacion')
    OR estado <> 'finalizado'
  );
