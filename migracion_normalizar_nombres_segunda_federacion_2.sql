-- Normalización (lote 2) de nombres de equipo de Segunda Federación
-- en la tabla results, para que equipo_local/equipo_visitante coincidan
-- EXACTAMENTE con los nombres oficiales de public/js/clubs.js.
-- Detectado tras la primera pasada de normalización: estos 9 clubes
-- seguían sin escudo porque su nombre en la BD era distinto al oficial.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_normalizar_nombres_segunda_federacion_2.sql

-- Tabla results: equipo_local
UPDATE results SET equipo_local = 'UD Llanera' WHERE equipo_local = 'Llanera';
UPDATE results SET equipo_local = 'CD Basconia' WHERE equipo_local = 'Basconia';
UPDATE results SET equipo_local = 'Girona FC B' WHERE equipo_local = 'Girona B';
UPDATE results SET equipo_local = 'RCD Espanyol B' WHERE equipo_local = 'Espanyol B';
UPDATE results SET equipo_local = 'CD Cieza' WHERE equipo_local = 'Cieza';
UPDATE results SET equipo_local = 'RCD Mallorca B' WHERE equipo_local = 'Mallorca B';
UPDATE results SET equipo_local = 'SCR Peña Deportiva' WHERE equipo_local = 'Peña Deportiva';
UPDATE results SET equipo_local = 'CD Atlético Baleares' WHERE equipo_local = 'Atlético Baleares';
UPDATE results SET equipo_local = 'CP Mijas Las Lagunas' WHERE equipo_local = 'Mijas-Las Lagunas';

-- Tabla results: equipo_visitante
UPDATE results SET equipo_visitante = 'UD Llanera' WHERE equipo_visitante = 'Llanera';
UPDATE results SET equipo_visitante = 'CD Basconia' WHERE equipo_visitante = 'Basconia';
UPDATE results SET equipo_visitante = 'Girona FC B' WHERE equipo_visitante = 'Girona B';
UPDATE results SET equipo_visitante = 'RCD Espanyol B' WHERE equipo_visitante = 'Espanyol B';
UPDATE results SET equipo_visitante = 'CD Cieza' WHERE equipo_visitante = 'Cieza';
UPDATE results SET equipo_visitante = 'RCD Mallorca B' WHERE equipo_visitante = 'Mallorca B';
UPDATE results SET equipo_visitante = 'SCR Peña Deportiva' WHERE equipo_visitante = 'Peña Deportiva';
UPDATE results SET equipo_visitante = 'CD Atlético Baleares' WHERE equipo_visitante = 'Atlético Baleares';
UPDATE results SET equipo_visitante = 'CP Mijas Las Lagunas' WHERE equipo_visitante = 'Mijas-Las Lagunas';

-- Tabla alineaciones: equipo
UPDATE alineaciones SET equipo = 'UD Llanera' WHERE equipo = 'Llanera';
UPDATE alineaciones SET equipo = 'CD Basconia' WHERE equipo = 'Basconia';
UPDATE alineaciones SET equipo = 'Girona FC B' WHERE equipo = 'Girona B';
UPDATE alineaciones SET equipo = 'RCD Espanyol B' WHERE equipo = 'Espanyol B';
UPDATE alineaciones SET equipo = 'CD Cieza' WHERE equipo = 'Cieza';
UPDATE alineaciones SET equipo = 'RCD Mallorca B' WHERE equipo = 'Mallorca B';
UPDATE alineaciones SET equipo = 'SCR Peña Deportiva' WHERE equipo = 'Peña Deportiva';
UPDATE alineaciones SET equipo = 'CD Atlético Baleares' WHERE equipo = 'Atlético Baleares';
UPDATE alineaciones SET equipo = 'CP Mijas Las Lagunas' WHERE equipo = 'Mijas-Las Lagunas';
