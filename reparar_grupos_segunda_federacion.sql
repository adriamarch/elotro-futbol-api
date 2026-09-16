-- ============================================================================
-- Reparación: partidos de Segunda Federación guardados sin "grupo"
-- ============================================================================
-- Motivo del problema (ver explicación completa en el chat): el backend
-- pisaba SIEMPRE el campo "grupo" de estos partidos con un cálculo
-- automático que solo reconocía 7 de los 90 equipos de Segunda Federación
-- (los de Grupo 4 y Grupo 5). Para cualquier partido con equipos de Grupo 1,
-- 2 o 3, ese cálculo devolvía NULL y lo guardaba así, borrando lo que se
-- hubiera puesto a mano en el panel. Esto ya está arreglado en el código
-- (worker/src/index.js y worker-secondary/src/index.js); este script repara
-- los datos que quedaron mal ANTES del arreglo.
--
-- CÓMO EJECUTARLO (elige el que uses):
--
--   A) Cloudflare D1 (producción actual):
--      wrangler d1 execute elotrofutbol --remote --file=reparar_grupos_segunda_federacion.sql
--
--   B) Si prefieres probarlo primero sin tocar producción, quita "--remote"
--      para ejecutarlo contra la base local de desarrollo:
--      wrangler d1 execute elotrofutbol --file=reparar_grupos_segunda_federacion.sql
--
-- El script es idempotente y seguro de re-ejecutar: solo toca filas de
-- competicion = 'segunda_federacion' cuyo grupo esté vacío (NULL o ''), y
-- solo si reconoce a alguno de los dos equipos. Los partidos cuyo grupo ya
-- esté bien puesto NO se tocan. Los partidos con equipos que este script no
-- reconozca (nombre distinto, club nuevo no listado, etc.) se quedan igual
-- que estaban y aparecen listados al final para revisarlos a mano.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 0 (solo diagnóstico, no cambia nada): cuántos partidos están afectados
-- ahora mismo, para poder comparar antes/después.
-- ----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_partidos_segunda_federacion_sin_grupo
FROM results
WHERE competicion = 'segunda_federacion'
  AND (grupo IS NULL OR TRIM(grupo) = '');


-- ----------------------------------------------------------------------------
-- PASO 1: tabla temporal con el mapa oficial equipo -> grupo (temporada
-- 2026/27, 90 equipos). Misma lista que TODOS_LOS_CLUBES_SEGUNDA_FEDERACION
-- en public/js/clubs.js y que el backend (worker/src/index.js).
-- ----------------------------------------------------------------------------
-- (No se usa CREATE TEMP TABLE: D1 en remoto puede rechazarlo con
-- "not authorized: SQLITE_AUTH". Se usa una tabla normal en su lugar,
-- que se borra al final del script.)
DROP TABLE IF EXISTS _tmp_grupo_por_equipo;
CREATE TABLE _tmp_grupo_por_equipo (
  equipo TEXT PRIMARY KEY,
  grupo TEXT NOT NULL
);

INSERT INTO _tmp_grupo_por_equipo (equipo, grupo) VALUES
  -- Grupo 1
  ('Deportivo Alavés B', 'Grupo 1'),
  ('Atlético Astorga', 'Grupo 1'),
  ('Arosa SC', 'Grupo 1'),
  ('Bergantiños', 'Grupo 1'),
  ('CD Basconia', 'Grupo 1'),
  ('Coruxo', 'Grupo 1'),
  ('SD Eibar B', 'Grupo 1'),
  ('Club Portugalete', 'Grupo 1'),
  ('SD Gernika', 'Grupo 1'),
  ('Ourense CF', 'Grupo 1'),
  ('RS Gimnástica de Torrelavega', 'Grupo 1'),
  ('Rayo Cantabria', 'Grupo 1'),
  ('Real Oviedo Vetusta', 'Grupo 1'),
  ('SD Amorebieta', 'Grupo 1'),
  ('Sestao River', 'Grupo 1'),
  ('SD Compostela', 'Grupo 1'),
  ('UD Llanera', 'Grupo 1'),
  ('Club Marino de Luanco', 'Grupo 1'),
  -- Grupo 2
  ('CD Arnedo', 'Grupo 2'),
  ('CE Manresa', 'Grupo 2'),
  ('FC Barcelona Atlètic', 'Grupo 2'),
  ('Náxara', 'Grupo 2'),
  ('UE Olot', 'Grupo 2'),
  ('CD Ebro', 'Grupo 2'),
  ('Peña Sport', 'Grupo 2'),
  ('Utebo', 'Grupo 2'),
  ('Reus FC Reddis', 'Grupo 2'),
  ('Atlético Osasuna B', 'Grupo 2'),
  ('SD Logroñés', 'Grupo 2'),
  ('RCD Espanyol B', 'Grupo 2'),
  ('CF Calamocha', 'Grupo 2'),
  ('Terrassa', 'Grupo 2'),
  ('CD Tudelano', 'Grupo 2'),
  ('UD Logroñés B', 'Grupo 2'),
  ('UD Barbastro', 'Grupo 2'),
  ('Girona FC B', 'Grupo 2'),
  -- Grupo 3
  ('CD Alcoyano', 'Grupo 3'),
  ('CD Cieza', 'Grupo 3'),
  ('UD Castellonense', 'Grupo 3'),
  ('UCAM Murcia', 'Grupo 3'),
  ('CF La Nucía', 'Grupo 3'),
  ('UD Poblense', 'Grupo 3'),
  ('CF Lorca Deportiva', 'Grupo 3'),
  ('Elche Ilicitano', 'Grupo 3'),
  ('CD Minera', 'Grupo 3'),
  ('SCR Peña Deportiva', 'Grupo 3'),
  ('Real Murcia Imperial', 'Grupo 3'),
  ('Orihuela CF', 'Grupo 3'),
  ('CD Castellón B', 'Grupo 3'),
  ('CF Intercity', 'Grupo 3'),
  ('Valencia Mestalla', 'Grupo 3'),
  ('RCD Mallorca B', 'Grupo 3'),
  ('Yeclano Deportivo', 'Grupo 3'),
  ('CD Atlético Baleares', 'Grupo 3'),
  -- Grupo 4
  ('Atlético Antoniano', 'Grupo 4'),
  ('CD Don Benito', 'Grupo 4'),
  ('Salerm Cosmetics Puente Genil', 'Grupo 4'),
  ('CP Mijas Las Lagunas', 'Grupo 4'),
  ('CD Badajoz', 'Grupo 4'),
  ('CD Tenerife B', 'Grupo 4'),
  ('Atlético Central', 'Grupo 4'),
  ('Recreativo de Huelva', 'Grupo 4'),
  ('CD Estepona', 'Grupo 4'),
  ('Xerez CD', 'Grupo 4'),
  ('Linares Deportivo', 'Grupo 4'),
  ('CD Ciudad de Lucena', 'Grupo 4'),
  ('Las Palmas Atlético', 'Grupo 4'),
  ('Betis Deportivo', 'Grupo 4'),
  ('Marbella FC', 'Grupo 4'),
  ('Atlético Sanluqueño', 'Grupo 4'),
  ('UD Tamaraceite', 'Grupo 4'),
  ('Sevilla Atlético', 'Grupo 4'),
  -- Grupo 5
  ('Real Madrid C', 'Grupo 5'),
  ('Atlético Albacete', 'Grupo 5'),
  ('Atlético de Madrid C', 'Grupo 5'),
  ('Real Ávila', 'Grupo 5'),
  ('CD Atlético Paso', 'Grupo 5'),
  ('CD Numancia', 'Grupo 5'),
  ('CD Guadalajara', 'Grupo 5'),
  ('Salamanca UDS', 'Grupo 5'),
  ('Calvo Sotelo Puertollano', 'Grupo 5'),
  ('Gimnástica Segoviana', 'Grupo 5'),
  ('RSD Alcalá', 'Grupo 5'),
  ('CF Talavera de la Reina', 'Grupo 5'),
  ('Real Valladolid Promesas', 'Grupo 5'),
  ('CDA Navalcarnero', 'Grupo 5'),
  ('Atlético Tordesillas', 'Grupo 5'),
  ('UD San Sebastián de los Reyes', 'Grupo 5'),
  ('UB Conquense', 'Grupo 5'),
  ('Getafe B', 'Grupo 5');


-- ----------------------------------------------------------------------------
-- PASO 2 (diagnóstico): vista previa de lo que se va a corregir, ANTES de
-- tocar nada. Revisa esta lista si quieres comprobar que tiene sentido antes
-- de seguir al PASO 3.
-- ----------------------------------------------------------------------------
SELECT
  r.id,
  r.jornada,
  r.equipo_local,
  r.equipo_visitante,
  r.fecha_partido,
  r.grupo AS grupo_actual,
  COALESCE(gl.grupo, gv.grupo) AS grupo_que_se_le_va_a_poner
FROM results r
LEFT JOIN _tmp_grupo_por_equipo gl ON gl.equipo = r.equipo_local
LEFT JOIN _tmp_grupo_por_equipo gv ON gv.equipo = r.equipo_visitante
WHERE r.competicion = 'segunda_federacion'
  AND (r.grupo IS NULL OR TRIM(r.grupo) = '')
ORDER BY r.fecha_partido;


-- ----------------------------------------------------------------------------
-- PASO 3: la corrección en sí. Solo actualiza filas de segunda_federacion
-- con grupo vacío Y donde se ha podido identificar el grupo por alguno de
-- los dos equipos. No toca nada más.
-- ----------------------------------------------------------------------------
UPDATE results
SET grupo = COALESCE(
  (SELECT grupo FROM _tmp_grupo_por_equipo WHERE equipo = results.equipo_local),
  (SELECT grupo FROM _tmp_grupo_por_equipo WHERE equipo = results.equipo_visitante)
)
WHERE competicion = 'segunda_federacion'
  AND (grupo IS NULL OR TRIM(grupo) = '')
  AND (
    equipo_local IN (SELECT equipo FROM _tmp_grupo_por_equipo)
    OR equipo_visitante IN (SELECT equipo FROM _tmp_grupo_por_equipo)
  );


-- ----------------------------------------------------------------------------
-- PASO 4 (diagnóstico final): partidos que SIGUEN sin grupo después del
-- UPDATE -- son los que tienen algún nombre de equipo que este script no
-- reconoce (alias distinto al oficial, equipo recién ascendido/descendido no
-- listado, etc.). Estos hay que revisarlos a mano desde el panel.
-- ----------------------------------------------------------------------------
SELECT
  id, jornada, equipo_local, equipo_visitante, fecha_partido, estado
FROM results
WHERE competicion = 'segunda_federacion'
  AND (grupo IS NULL OR TRIM(grupo) = '')
ORDER BY fecha_partido;

DROP TABLE IF EXISTS _tmp_grupo_por_equipo;
