-- Normalización (lote 3) de nombres de equipo de Segunda Federación en la
-- tabla results, para que equipo_local/equipo_visitante coincidan
-- EXACTAMENTE con los nombres oficiales de public/js/clubs.js.
-- Detectado al añadir el formato de importación "ESPN": estos 5 nombres
-- cortos que trae ESPN no se resolvían bien y se habían quedado guardados
-- tal cual venían en el texto pegado (ver ALIAS_NOMBRES_EQUIPO en
-- public/admin/js/importacion-rapida.js, ya corregido para futuras
-- importaciones; este script repara lo que ya estaba mal en la BD).
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_normalizar_nombres_segunda_federacion_3.sql

-- Tabla results: equipo_local
UPDATE results SET equipo_local = 'CF Calamocha' WHERE equipo_local = 'Calamocha';
UPDATE results SET equipo_local = 'Atlético Osasuna B' WHERE equipo_local = 'Osasuna Promesas';
UPDATE results SET equipo_local = 'SCR Peña Deportiva' WHERE equipo_local = 'Penya Deportiva';
UPDATE results SET equipo_local = 'Calvo Sotelo Puertollano' WHERE equipo_local = 'CS Puertollano';
UPDATE results SET equipo_local = 'UD San Sebastián de los Reyes' WHERE equipo_local = 'UD Sanse';

-- Tabla results: equipo_visitante (mismo mapeo, por si el nombre corto
-- aparece también como visitante)
UPDATE results SET equipo_visitante = 'CF Calamocha' WHERE equipo_visitante = 'Calamocha';
UPDATE results SET equipo_visitante = 'Atlético Osasuna B' WHERE equipo_visitante = 'Osasuna Promesas';
UPDATE results SET equipo_visitante = 'SCR Peña Deportiva' WHERE equipo_visitante = 'Penya Deportiva';
UPDATE results SET equipo_visitante = 'Calvo Sotelo Puertollano' WHERE equipo_visitante = 'CS Puertollano';
UPDATE results SET equipo_visitante = 'UD San Sebastián de los Reyes' WHERE equipo_visitante = 'UD Sanse';

-- Tabla alineaciones: equipo (alineaciones publicadas con el nombre corto)
UPDATE alineaciones SET equipo = 'CF Calamocha' WHERE equipo = 'Calamocha';
UPDATE alineaciones SET equipo = 'Atlético Osasuna B' WHERE equipo = 'Osasuna Promesas';
UPDATE alineaciones SET equipo = 'SCR Peña Deportiva' WHERE equipo = 'Penya Deportiva';
UPDATE alineaciones SET equipo = 'Calvo Sotelo Puertollano' WHERE equipo = 'CS Puertollano';
UPDATE alineaciones SET equipo = 'UD San Sebastián de los Reyes' WHERE equipo = 'UD Sanse';
