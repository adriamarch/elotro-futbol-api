-- Alias de clubes (punto 7): Celta Fortuna / Celta B, Real Sporting,
-- Arosa SC y RS Gimnástica de Torrelavega (estos dos, Segunda RFEF Grupo 1).
--
-- 1) Alias para la sincronización automática (TheSportsDB): sin ellos, "Celta B"
--    o "Arosa" se guardaban con el nombre de la fuente y no coincidían con el
--    nombre oficial de clubs.js (ni escudo, ni ficha, ni grupo).
-- 2) Reparación de lo ya guardado con esos nombres alternativos.
-- 3) Reparación del grupo de Arosa y Gimnástica de Torrelavega (Grupo 1).
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_alias_celta_sporting_arosa_gimnastica.sql
-- (es repetible: INSERT OR IGNORE y UPDATE con condiciones)

INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  ('Celta B', 'Celta Fortuna'),
  ('Celta de Vigo B', 'Celta Fortuna'),
  ('Celta Vigo B', 'Celta Fortuna'),
  ('RC Celta B', 'Celta Fortuna'),
  ('RC Celta de Vigo B', 'Celta Fortuna'),
  ('Real Club Celta B', 'Celta Fortuna'),
  ('Celta II', 'Celta Fortuna'),
  ('RC Celta Fortuna', 'Celta Fortuna'),
  ('Sporting de Gijón', 'Real Sporting'),
  ('Sporting Gijón', 'Real Sporting'),
  ('Real Sporting de Gijón', 'Real Sporting'),
  ('Real Sporting Gijón', 'Real Sporting'),
  ('Arosa', 'Arosa SC'),
  ('Arosa Sociedad Cultural', 'Arosa SC'),
  ('Gimnástica de Torrelavega', 'RS Gimnástica de Torrelavega'),
  ('Gimnástica Torrelavega', 'RS Gimnástica de Torrelavega'),
  ('Real Sociedad Gimnástica', 'RS Gimnástica de Torrelavega'),
  ('Real Sociedad Gimnástica de Torrelavega', 'RS Gimnástica de Torrelavega');

-- Partidos ya guardados con el nombre alternativo -> nombre oficial.
UPDATE results SET equipo_local = 'Celta Fortuna' WHERE equipo_local IN ('Celta B', 'Celta de Vigo B', 'Celta Vigo B', 'RC Celta B', 'RC Celta de Vigo B', 'Real Club Celta B', 'Celta II', 'RC Celta Fortuna');
UPDATE results SET equipo_visitante = 'Celta Fortuna' WHERE equipo_visitante IN ('Celta B', 'Celta de Vigo B', 'Celta Vigo B', 'RC Celta B', 'RC Celta de Vigo B', 'Real Club Celta B', 'Celta II', 'RC Celta Fortuna');
UPDATE results SET equipo_local = 'Real Sporting' WHERE equipo_local IN ('Sporting de Gijón', 'Sporting Gijón', 'Real Sporting de Gijón', 'Real Sporting Gijón');
UPDATE results SET equipo_visitante = 'Real Sporting' WHERE equipo_visitante IN ('Sporting de Gijón', 'Sporting Gijón', 'Real Sporting de Gijón', 'Real Sporting Gijón');
UPDATE results SET equipo_local = 'Arosa SC' WHERE equipo_local IN ('Arosa', 'Arosa Sociedad Cultural');
UPDATE results SET equipo_visitante = 'Arosa SC' WHERE equipo_visitante IN ('Arosa', 'Arosa Sociedad Cultural');
UPDATE results SET equipo_local = 'RS Gimnástica de Torrelavega' WHERE equipo_local IN ('Gimnástica de Torrelavega', 'Gimnástica Torrelavega', 'Real Sociedad Gimnástica', 'Real Sociedad Gimnástica de Torrelavega');
UPDATE results SET equipo_visitante = 'RS Gimnástica de Torrelavega' WHERE equipo_visitante IN ('Gimnástica de Torrelavega', 'Gimnástica Torrelavega', 'Real Sociedad Gimnástica', 'Real Sociedad Gimnástica de Torrelavega');

-- Alineaciones publicadas con el nombre alternativo.
UPDATE alineaciones SET equipo = 'Celta Fortuna' WHERE equipo IN ('Celta B', 'Celta de Vigo B', 'Celta Vigo B', 'RC Celta B', 'RC Celta de Vigo B', 'Real Club Celta B', 'Celta II', 'RC Celta Fortuna');
UPDATE alineaciones SET equipo = 'Real Sporting' WHERE equipo IN ('Sporting de Gijón', 'Sporting Gijón', 'Real Sporting de Gijón', 'Real Sporting Gijón');
UPDATE alineaciones SET equipo = 'Arosa SC' WHERE equipo IN ('Arosa', 'Arosa Sociedad Cultural');
UPDATE alineaciones SET equipo = 'RS Gimnástica de Torrelavega' WHERE equipo IN ('Gimnástica de Torrelavega', 'Gimnástica Torrelavega', 'Real Sociedad Gimnástica', 'Real Sociedad Gimnástica de Torrelavega');

-- Arosa SC y RS Gimnástica de Torrelavega son de Segunda RFEF, Grupo 1:
-- se corrige el grupo de los partidos que lo tengan vacío o distinto.
UPDATE results SET grupo = 'Grupo 1'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('Arosa SC', 'RS Gimnástica de Torrelavega') OR equipo_visitante IN ('Arosa SC', 'RS Gimnástica de Torrelavega'))
  AND (grupo IS NULL OR grupo <> 'Grupo 1');
