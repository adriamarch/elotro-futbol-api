-- Normalización (lote 4): el club de Segunda Federación (Grupo 2) pasa de
-- llamarse "Utebo" a "Utebo FC" (nombre oficial en public/js/clubs.js).
-- Repara lo que ya estuviera guardado con el nombre antiguo.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_normalizar_nombres_segunda_federacion_4.sql

UPDATE results SET equipo_local = 'Utebo FC' WHERE equipo_local = 'Utebo';
UPDATE results SET equipo_visitante = 'Utebo FC' WHERE equipo_visitante = 'Utebo';
UPDATE alineaciones SET equipo = 'Utebo FC' WHERE equipo = 'Utebo';
