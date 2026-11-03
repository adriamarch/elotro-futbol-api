-- Alias de clubes (punto 6): Portugalete, Marino de Luanco, Osasuna B, Peña Deportiva,
-- Deportiva Minera, Navalcarnero, Alcalá y Atlético de Madrid C (Segunda RFEF).
--
-- 1) Alias para la sincronización automática (TheSportsDB): sin ellos, estos clubes
--    se guardaban con el nombre de la fuente ("Portugalete", "Deportiva Minera",
--    "Osasuna B"...) y no coincidían con el nombre oficial de clubs.js (ni escudo,
--    ni ficha, ni grupo).
-- 2) Reparación de lo ya guardado con esos nombres alternativos (results y alineaciones).
-- 3) Reparación del grupo de Segunda RFEF de los partidos de estos clubes.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_alias_segunda_federacion_2.sql
-- (es repetible: INSERT OR IGNORE y UPDATE con condiciones)

INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  ('Portugalete', 'Club Portugalete'),
  ('CD Portugalete', 'Club Portugalete'),
  ('Club Deportivo Portugalete', 'Club Portugalete'),
  ('Marino de Luanco', 'Club Marino de Luanco'),
  ('Marino Luanco', 'Club Marino de Luanco'),
  ('CD Marino de Luanco', 'Club Marino de Luanco'),
  ('CD Marino Luanco', 'Club Marino de Luanco'),
  ('Club Deportivo Marino de Luanco', 'Club Marino de Luanco'),
  ('Osasuna B', 'Atlético Osasuna B'),
  ('CA Osasuna B', 'Atlético Osasuna B'),
  ('Osasuna II', 'Atlético Osasuna B'),
  ('CA Osasuna II', 'Atlético Osasuna B'),
  ('Osasuna Promesas', 'Atlético Osasuna B'),
  ('CA Osasuna Promesas', 'Atlético Osasuna B'),
  ('Atlético Osasuna', 'Atlético Osasuna B'),
  ('Club Atlético Osasuna B', 'Atlético Osasuna B'),
  ('Peña Deportiva', 'SCR Peña Deportiva'),
  ('Penya Deportiva', 'SCR Peña Deportiva'),
  ('SCR Penya Deportiva', 'SCR Peña Deportiva'),
  ('Peña Deportiva Rociera', 'SCR Peña Deportiva'),
  ('Sociedad Cultural Recreativa Peña Deportiva', 'SCR Peña Deportiva'),
  ('Deportiva Minera', 'CD Minera'),
  ('CD Deportiva Minera', 'CD Minera'),
  ('Minera', 'CD Minera'),
  ('Navalcarnero', 'CDA Navalcarnero'),
  ('CD Navalcarnero', 'CDA Navalcarnero'),
  ('AD Navalcarnero', 'CDA Navalcarnero'),
  ('Club Deportivo Agrupación Navalcarnero', 'CDA Navalcarnero'),
  ('Alcalá', 'RSD Alcalá'),
  ('Real Sociedad Deportiva Alcalá', 'RSD Alcalá'),
  ('RS Deportiva Alcalá', 'RSD Alcalá'),
  ('Atlético Madrid C', 'Atlético de Madrid C'),
  ('Atlético de Madrid III', 'Atlético de Madrid C'),
  ('Atlético Madrid III', 'Atlético de Madrid C'),
  ('Club Atlético de Madrid C', 'Atlético de Madrid C');

-- Partidos ya guardados con el nombre alternativo -> nombre oficial.
UPDATE results SET equipo_local = 'Club Portugalete' WHERE equipo_local IN ('Portugalete', 'CD Portugalete', 'Club Deportivo Portugalete');
UPDATE results SET equipo_visitante = 'Club Portugalete' WHERE equipo_visitante IN ('Portugalete', 'CD Portugalete', 'Club Deportivo Portugalete');
UPDATE results SET equipo_local = 'Club Marino de Luanco' WHERE equipo_local IN ('Marino de Luanco', 'Marino Luanco', 'CD Marino de Luanco', 'CD Marino Luanco', 'Club Deportivo Marino de Luanco');
UPDATE results SET equipo_visitante = 'Club Marino de Luanco' WHERE equipo_visitante IN ('Marino de Luanco', 'Marino Luanco', 'CD Marino de Luanco', 'CD Marino Luanco', 'Club Deportivo Marino de Luanco');
UPDATE results SET equipo_local = 'Atlético Osasuna B' WHERE equipo_local IN ('Osasuna B', 'CA Osasuna B', 'Osasuna II', 'CA Osasuna II', 'Osasuna Promesas', 'CA Osasuna Promesas', 'Atlético Osasuna', 'Club Atlético Osasuna B');
UPDATE results SET equipo_visitante = 'Atlético Osasuna B' WHERE equipo_visitante IN ('Osasuna B', 'CA Osasuna B', 'Osasuna II', 'CA Osasuna II', 'Osasuna Promesas', 'CA Osasuna Promesas', 'Atlético Osasuna', 'Club Atlético Osasuna B');
UPDATE results SET equipo_local = 'SCR Peña Deportiva' WHERE equipo_local IN ('Peña Deportiva', 'Penya Deportiva', 'SCR Penya Deportiva', 'Peña Deportiva Rociera', 'Sociedad Cultural Recreativa Peña Deportiva');
UPDATE results SET equipo_visitante = 'SCR Peña Deportiva' WHERE equipo_visitante IN ('Peña Deportiva', 'Penya Deportiva', 'SCR Penya Deportiva', 'Peña Deportiva Rociera', 'Sociedad Cultural Recreativa Peña Deportiva');
UPDATE results SET equipo_local = 'CD Minera' WHERE equipo_local IN ('Deportiva Minera', 'CD Deportiva Minera', 'Minera');
UPDATE results SET equipo_visitante = 'CD Minera' WHERE equipo_visitante IN ('Deportiva Minera', 'CD Deportiva Minera', 'Minera');
UPDATE results SET equipo_local = 'CDA Navalcarnero' WHERE equipo_local IN ('Navalcarnero', 'CD Navalcarnero', 'AD Navalcarnero', 'Club Deportivo Agrupación Navalcarnero');
UPDATE results SET equipo_visitante = 'CDA Navalcarnero' WHERE equipo_visitante IN ('Navalcarnero', 'CD Navalcarnero', 'AD Navalcarnero', 'Club Deportivo Agrupación Navalcarnero');
UPDATE results SET equipo_local = 'RSD Alcalá' WHERE equipo_local IN ('Alcalá', 'Real Sociedad Deportiva Alcalá', 'RS Deportiva Alcalá');
UPDATE results SET equipo_visitante = 'RSD Alcalá' WHERE equipo_visitante IN ('Alcalá', 'Real Sociedad Deportiva Alcalá', 'RS Deportiva Alcalá');
UPDATE results SET equipo_local = 'Atlético de Madrid C' WHERE equipo_local IN ('Atlético Madrid C', 'Atlético de Madrid III', 'Atlético Madrid III', 'Club Atlético de Madrid C');
UPDATE results SET equipo_visitante = 'Atlético de Madrid C' WHERE equipo_visitante IN ('Atlético Madrid C', 'Atlético de Madrid III', 'Atlético Madrid III', 'Club Atlético de Madrid C');

-- Alineaciones publicadas con el nombre alternativo.
UPDATE alineaciones SET equipo = 'Club Portugalete' WHERE equipo IN ('Portugalete', 'CD Portugalete', 'Club Deportivo Portugalete');
UPDATE alineaciones SET equipo = 'Club Marino de Luanco' WHERE equipo IN ('Marino de Luanco', 'Marino Luanco', 'CD Marino de Luanco', 'CD Marino Luanco', 'Club Deportivo Marino de Luanco');
UPDATE alineaciones SET equipo = 'Atlético Osasuna B' WHERE equipo IN ('Osasuna B', 'CA Osasuna B', 'Osasuna II', 'CA Osasuna II', 'Osasuna Promesas', 'CA Osasuna Promesas', 'Atlético Osasuna', 'Club Atlético Osasuna B');
UPDATE alineaciones SET equipo = 'SCR Peña Deportiva' WHERE equipo IN ('Peña Deportiva', 'Penya Deportiva', 'SCR Penya Deportiva', 'Peña Deportiva Rociera', 'Sociedad Cultural Recreativa Peña Deportiva');
UPDATE alineaciones SET equipo = 'CD Minera' WHERE equipo IN ('Deportiva Minera', 'CD Deportiva Minera', 'Minera');
UPDATE alineaciones SET equipo = 'CDA Navalcarnero' WHERE equipo IN ('Navalcarnero', 'CD Navalcarnero', 'AD Navalcarnero', 'Club Deportivo Agrupación Navalcarnero');
UPDATE alineaciones SET equipo = 'RSD Alcalá' WHERE equipo IN ('Alcalá', 'Real Sociedad Deportiva Alcalá', 'RS Deportiva Alcalá');
UPDATE alineaciones SET equipo = 'Atlético de Madrid C' WHERE equipo IN ('Atlético Madrid C', 'Atlético de Madrid III', 'Atlético Madrid III', 'Club Atlético de Madrid C');

-- Grupo de Segunda RFEF (el de clubs.js): se corrige en los partidos que lo tengan
-- vacío o distinto.
UPDATE results SET grupo = 'Grupo 1'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('Club Portugalete', 'Club Marino de Luanco') OR equipo_visitante IN ('Club Portugalete', 'Club Marino de Luanco'))
  AND (grupo IS NULL OR grupo <> 'Grupo 1');
UPDATE results SET grupo = 'Grupo 2'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('Atlético Osasuna B') OR equipo_visitante IN ('Atlético Osasuna B'))
  AND (grupo IS NULL OR grupo <> 'Grupo 2');
UPDATE results SET grupo = 'Grupo 3'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('SCR Peña Deportiva', 'CD Minera') OR equipo_visitante IN ('SCR Peña Deportiva', 'CD Minera'))
  AND (grupo IS NULL OR grupo <> 'Grupo 3');
UPDATE results SET grupo = 'Grupo 5'
WHERE competicion = 'segunda_federacion'
  AND (equipo_local IN ('CDA Navalcarnero', 'RSD Alcalá', 'Atlético de Madrid C') OR equipo_visitante IN ('CDA Navalcarnero', 'RSD Alcalá', 'Atlético de Madrid C'))
  AND (grupo IS NULL OR grupo <> 'Grupo 5');
