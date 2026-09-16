-- Normalización de nombres de equipo de Segunda Federación en la tabla
-- results, para que equipo_local/equipo_visitante coincidan EXACTAMENTE
-- con los nombres oficiales de public/js/clubs.js
-- (TODOS_LOS_CLUBES_SEGUNDA_FEDERACION). Generado a partir de la lista
-- real de equipo_local devuelta por:
--   wrangler d1 execute elotrofutbol --remote --command "SELECT DISTINCT equipo_local FROM results WHERE competicion='segunda_federacion'"
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_normalizar_nombres_segunda_federacion.sql

-- Tabla results: equipo_local
UPDATE results SET equipo_local = 'RSD Alcalá' WHERE equipo_local = 'Alcalá';
UPDATE results SET equipo_local = 'CD Alcoyano' WHERE equipo_local = 'Alcoyano';
UPDATE results SET equipo_local = 'SD Amorebieta' WHERE equipo_local = 'Amorebieta';
UPDATE results SET equipo_local = 'CD Arnedo' WHERE equipo_local = 'Arnedo';
UPDATE results SET equipo_local = 'Arosa SC' WHERE equipo_local = 'Arosa';
UPDATE results SET equipo_local = 'Atlético de Madrid C' WHERE equipo_local = 'Atlético Madrid C';
UPDATE results SET equipo_local = 'CD Atlético Paso' WHERE equipo_local = 'Atlético Paso';
UPDATE results SET equipo_local = 'UD Barbastro' WHERE equipo_local = 'Barbastro';
UPDATE results SET equipo_local = 'FC Barcelona Atlètic' WHERE equipo_local = 'Barcelona Atlètic';
UPDATE results SET equipo_local = 'UD Castellonense' WHERE equipo_local = 'Castellonense';
UPDATE results SET equipo_local = 'CD Castellón B' WHERE equipo_local = 'Castellón B';
UPDATE results SET equipo_local = 'SD Compostela' WHERE equipo_local = 'Compostela';
UPDATE results SET equipo_local = 'CD Minera' WHERE equipo_local = 'Deportiva Minera';
UPDATE results SET equipo_local = 'CD Don Benito' WHERE equipo_local = 'Don Benito';
UPDATE results SET equipo_local = 'CD Ebro' WHERE equipo_local = 'Ebro';
UPDATE results SET equipo_local = 'SD Eibar B' WHERE equipo_local = 'Eibar B';
UPDATE results SET equipo_local = 'CD Estepona' WHERE equipo_local = 'Estepona';
UPDATE results SET equipo_local = 'SD Gernika' WHERE equipo_local = 'Gernika';
UPDATE results SET equipo_local = 'RS Gimnástica de Torrelavega' WHERE equipo_local = 'Gimnástica de Torrelavega';
UPDATE results SET equipo_local = 'CF Intercity' WHERE equipo_local = 'Intercity';
UPDATE results SET equipo_local = 'CF La Nucía' WHERE equipo_local = 'La Nucía';
UPDATE results SET equipo_local = 'CF Lorca Deportiva' WHERE equipo_local = 'Lorca Deportiva';
UPDATE results SET equipo_local = 'CE Manresa' WHERE equipo_local = 'Manresa';
UPDATE results SET equipo_local = 'Marbella FC' WHERE equipo_local = 'Marbella';
UPDATE results SET equipo_local = 'Club Marino de Luanco' WHERE equipo_local = 'Marino de Luanco';
UPDATE results SET equipo_local = 'CDA Navalcarnero' WHERE equipo_local = 'Navalcarnero';
UPDATE results SET equipo_local = 'UE Olot' WHERE equipo_local = 'Olot';
UPDATE results SET equipo_local = 'Orihuela CF' WHERE equipo_local = 'Orihuela';
UPDATE results SET equipo_local = 'Atlético Osasuna B' WHERE equipo_local = 'Osasuna B';
UPDATE results SET equipo_local = 'UD Poblense' WHERE equipo_local = 'Poblense';
UPDATE results SET equipo_local = 'Club Portugalete' WHERE equipo_local = 'Portugalete';
UPDATE results SET equipo_local = 'Salerm Cosmetics Puente Genil' WHERE equipo_local = 'Puente Genil';
UPDATE results SET equipo_local = 'UD San Sebastián de los Reyes' WHERE equipo_local = 'San Sebastián de los Reyes';
UPDATE results SET equipo_local = 'UD Tamaraceite' WHERE equipo_local = 'Tamaraceite';
UPDATE results SET equipo_local = 'CD Tudelano' WHERE equipo_local = 'Tudelano';
UPDATE results SET equipo_local = 'Xerez CD' WHERE equipo_local = 'Xerez';

-- Tabla results: equipo_visitante (mismo mapeo, por si el nombre corto
-- aparece también como visitante)
UPDATE results SET equipo_visitante = 'RSD Alcalá' WHERE equipo_visitante = 'Alcalá';
UPDATE results SET equipo_visitante = 'CD Alcoyano' WHERE equipo_visitante = 'Alcoyano';
UPDATE results SET equipo_visitante = 'SD Amorebieta' WHERE equipo_visitante = 'Amorebieta';
UPDATE results SET equipo_visitante = 'CD Arnedo' WHERE equipo_visitante = 'Arnedo';
UPDATE results SET equipo_visitante = 'Arosa SC' WHERE equipo_visitante = 'Arosa';
UPDATE results SET equipo_visitante = 'Atlético de Madrid C' WHERE equipo_visitante = 'Atlético Madrid C';
UPDATE results SET equipo_visitante = 'CD Atlético Paso' WHERE equipo_visitante = 'Atlético Paso';
UPDATE results SET equipo_visitante = 'UD Barbastro' WHERE equipo_visitante = 'Barbastro';
UPDATE results SET equipo_visitante = 'FC Barcelona Atlètic' WHERE equipo_visitante = 'Barcelona Atlètic';
UPDATE results SET equipo_visitante = 'UD Castellonense' WHERE equipo_visitante = 'Castellonense';
UPDATE results SET equipo_visitante = 'CD Castellón B' WHERE equipo_visitante = 'Castellón B';
UPDATE results SET equipo_visitante = 'SD Compostela' WHERE equipo_visitante = 'Compostela';
UPDATE results SET equipo_visitante = 'CD Minera' WHERE equipo_visitante = 'Deportiva Minera';
UPDATE results SET equipo_visitante = 'CD Don Benito' WHERE equipo_visitante = 'Don Benito';
UPDATE results SET equipo_visitante = 'CD Ebro' WHERE equipo_visitante = 'Ebro';
UPDATE results SET equipo_visitante = 'SD Eibar B' WHERE equipo_visitante = 'Eibar B';
UPDATE results SET equipo_visitante = 'CD Estepona' WHERE equipo_visitante = 'Estepona';
UPDATE results SET equipo_visitante = 'SD Gernika' WHERE equipo_visitante = 'Gernika';
UPDATE results SET equipo_visitante = 'RS Gimnástica de Torrelavega' WHERE equipo_visitante = 'Gimnástica de Torrelavega';
UPDATE results SET equipo_visitante = 'CF Intercity' WHERE equipo_visitante = 'Intercity';
UPDATE results SET equipo_visitante = 'CF La Nucía' WHERE equipo_visitante = 'La Nucía';
UPDATE results SET equipo_visitante = 'CF Lorca Deportiva' WHERE equipo_visitante = 'Lorca Deportiva';
UPDATE results SET equipo_visitante = 'CE Manresa' WHERE equipo_visitante = 'Manresa';
UPDATE results SET equipo_visitante = 'Marbella FC' WHERE equipo_visitante = 'Marbella';
UPDATE results SET equipo_visitante = 'Club Marino de Luanco' WHERE equipo_visitante = 'Marino de Luanco';
UPDATE results SET equipo_visitante = 'CDA Navalcarnero' WHERE equipo_visitante = 'Navalcarnero';
UPDATE results SET equipo_visitante = 'UE Olot' WHERE equipo_visitante = 'Olot';
UPDATE results SET equipo_visitante = 'Orihuela CF' WHERE equipo_visitante = 'Orihuela';
UPDATE results SET equipo_visitante = 'Atlético Osasuna B' WHERE equipo_visitante = 'Osasuna B';
UPDATE results SET equipo_visitante = 'UD Poblense' WHERE equipo_visitante = 'Poblense';
UPDATE results SET equipo_visitante = 'Club Portugalete' WHERE equipo_visitante = 'Portugalete';
UPDATE results SET equipo_visitante = 'Salerm Cosmetics Puente Genil' WHERE equipo_visitante = 'Puente Genil';
UPDATE results SET equipo_visitante = 'UD San Sebastián de los Reyes' WHERE equipo_visitante = 'San Sebastián de los Reyes';
UPDATE results SET equipo_visitante = 'UD Tamaraceite' WHERE equipo_visitante = 'Tamaraceite';
UPDATE results SET equipo_visitante = 'CD Tudelano' WHERE equipo_visitante = 'Tudelano';
UPDATE results SET equipo_visitante = 'Xerez CD' WHERE equipo_visitante = 'Xerez';

-- Tabla alineaciones: equipo (alineaciones publicadas con el nombre corto)
UPDATE alineaciones SET equipo = 'RSD Alcalá' WHERE equipo = 'Alcalá';
UPDATE alineaciones SET equipo = 'CD Alcoyano' WHERE equipo = 'Alcoyano';
UPDATE alineaciones SET equipo = 'SD Amorebieta' WHERE equipo = 'Amorebieta';
UPDATE alineaciones SET equipo = 'CD Arnedo' WHERE equipo = 'Arnedo';
UPDATE alineaciones SET equipo = 'Arosa SC' WHERE equipo = 'Arosa';
UPDATE alineaciones SET equipo = 'Atlético de Madrid C' WHERE equipo = 'Atlético Madrid C';
UPDATE alineaciones SET equipo = 'CD Atlético Paso' WHERE equipo = 'Atlético Paso';
UPDATE alineaciones SET equipo = 'UD Barbastro' WHERE equipo = 'Barbastro';
UPDATE alineaciones SET equipo = 'FC Barcelona Atlètic' WHERE equipo = 'Barcelona Atlètic';
UPDATE alineaciones SET equipo = 'UD Castellonense' WHERE equipo = 'Castellonense';
UPDATE alineaciones SET equipo = 'CD Castellón B' WHERE equipo = 'Castellón B';
UPDATE alineaciones SET equipo = 'SD Compostela' WHERE equipo = 'Compostela';
UPDATE alineaciones SET equipo = 'CD Minera' WHERE equipo = 'Deportiva Minera';
UPDATE alineaciones SET equipo = 'CD Don Benito' WHERE equipo = 'Don Benito';
UPDATE alineaciones SET equipo = 'CD Ebro' WHERE equipo = 'Ebro';
UPDATE alineaciones SET equipo = 'SD Eibar B' WHERE equipo = 'Eibar B';
UPDATE alineaciones SET equipo = 'CD Estepona' WHERE equipo = 'Estepona';
UPDATE alineaciones SET equipo = 'SD Gernika' WHERE equipo = 'Gernika';
UPDATE alineaciones SET equipo = 'RS Gimnástica de Torrelavega' WHERE equipo = 'Gimnástica de Torrelavega';
UPDATE alineaciones SET equipo = 'CF Intercity' WHERE equipo = 'Intercity';
UPDATE alineaciones SET equipo = 'CF La Nucía' WHERE equipo = 'La Nucía';
UPDATE alineaciones SET equipo = 'CF Lorca Deportiva' WHERE equipo = 'Lorca Deportiva';
UPDATE alineaciones SET equipo = 'CE Manresa' WHERE equipo = 'Manresa';
UPDATE alineaciones SET equipo = 'Marbella FC' WHERE equipo = 'Marbella';
UPDATE alineaciones SET equipo = 'Club Marino de Luanco' WHERE equipo = 'Marino de Luanco';
UPDATE alineaciones SET equipo = 'CDA Navalcarnero' WHERE equipo = 'Navalcarnero';
UPDATE alineaciones SET equipo = 'UE Olot' WHERE equipo = 'Olot';
UPDATE alineaciones SET equipo = 'Orihuela CF' WHERE equipo = 'Orihuela';
UPDATE alineaciones SET equipo = 'Atlético Osasuna B' WHERE equipo = 'Osasuna B';
UPDATE alineaciones SET equipo = 'UD Poblense' WHERE equipo = 'Poblense';
UPDATE alineaciones SET equipo = 'Club Portugalete' WHERE equipo = 'Portugalete';
UPDATE alineaciones SET equipo = 'Salerm Cosmetics Puente Genil' WHERE equipo = 'Puente Genil';
UPDATE alineaciones SET equipo = 'UD San Sebastián de los Reyes' WHERE equipo = 'San Sebastián de los Reyes';
UPDATE alineaciones SET equipo = 'UD Tamaraceite' WHERE equipo = 'Tamaraceite';
UPDATE alineaciones SET equipo = 'CD Tudelano' WHERE equipo = 'Tudelano';
UPDATE alineaciones SET equipo = 'Xerez CD' WHERE equipo = 'Xerez';
