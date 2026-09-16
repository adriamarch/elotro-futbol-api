-- ============================================================================
-- Reparación: rellenar el campo "ubicacion" (estadio) de los partidos ya
-- guardados de Segunda Federación, a partir de ESTADIO_POR_CLUB en
-- public/js/clubs.js (los 90 clubes de los 5 grupos).
-- ============================================================================
-- Motivo: la importación rápida solo autorellena "ubicacion" a partir del
-- estadio del equipo LOCAL en el momento de importar. Los partidos que se
-- guardaron ANTES de que ESTADIO_POR_CLUB tuviera el estadio de ese club (o
-- que se guardaron por otra vía sin ubicación) se quedaron con el campo
-- vacío y no se corrigen solos.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/rellenar_ubicaciones_segunda_federacion.sql
--
-- El script es idempotente y seguro de re-ejecutar: SOLO toca partidos de
-- competicion = 'segunda_federacion' cuya ubicacion esté vacía (NULL o '').
-- Un partido que ya tenga ubicación puesta a mano (incluida una distinta al
-- estadio "habitual" del club, por ejemplo un derbi jugado en campo neutral)
-- NUNCA se sobrescribe. Se toma siempre el estadio del equipo LOCAL, nunca
-- el del visitante, igual que hace la importación rápida.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 0 (solo diagnóstico, no cambia nada): cuántos partidos están afectados
-- ahora mismo.
-- ----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_partidos_segunda_federacion_sin_ubicacion
FROM results
WHERE competicion = 'segunda_federacion'
  AND (ubicacion IS NULL OR TRIM(ubicacion) = '');


-- ----------------------------------------------------------------------------
-- PASO 1: tabla temporal con el mapa oficial equipo -> estadio (los 90
-- clubes de Segunda Federación). Misma fuente que ESTADIO_POR_CLUB en
-- public/js/clubs.js.
-- ----------------------------------------------------------------------------
-- (No se usa CREATE TEMP TABLE: D1 en remoto puede rechazarlo con
-- "not authorized: SQLITE_AUTH". Se usa una tabla normal en su lugar,
-- que se borra al final del script.)
DROP TABLE IF EXISTS _tmp_estadio_por_equipo;
CREATE TABLE _tmp_estadio_por_equipo (
  equipo TEXT PRIMARY KEY,
  estadio TEXT NOT NULL
);

INSERT INTO _tmp_estadio_por_equipo (equipo, estadio) VALUES
  ('Deportivo Alavés B', 'José Luis Compañón - Ibaia'),
  ('Atlético Astorga', 'La Eragudina'),
  ('Arosa SC', 'A Lomba'),
  ('Bergantiños', 'As Eiroas'),
  ('CD Basconia', 'Artunduaga'),
  ('Coruxo', 'O Vao'),
  ('SD Eibar B', 'Unbe'),
  ('Club Portugalete', 'La Florida'),
  ('SD Gernika', 'Urbieta'),
  ('Ourense CF', 'O Couto'),
  ('RS Gimnástica de Torrelavega', 'El Malecón'),
  ('Rayo Cantabria', 'La Planchada'),
  ('Real Oviedo Vetusta', 'El Requexón'),
  ('SD Amorebieta', 'Urritxe'),
  ('Sestao River', 'Las Llanas'),
  ('SD Compostela', 'Verónica Boquete de San Lázaro'),
  ('UD Llanera', 'Pepe Quimarán'),
  ('Club Marino de Luanco', 'Miramar'),
  ('CD Arnedo', 'Sendero'),
  ('CE Manresa', 'Vilanova - Manresa'),
  ('FC Barcelona Atlètic', 'Johan Cruyff'),
  ('Náxara', 'Isaac Peña'),
  ('UE Olot', 'Municipal d''Olot'),
  ('CD Ebro', 'Pedro Sancho'),
  ('Peña Sport', 'San Francisco (Tafalla)'),
  ('Utebo', 'Municipal de Utebo'),
  ('Reus FC Reddis', 'Municipal de Reus'),
  ('Atlético Osasuna B', 'Tajonar'),
  ('SD Logroñés', 'Pradoviejo'),
  ('RCD Espanyol B', 'Ciutat Esportiva Dani Jarque'),
  ('CF Calamocha', 'Pedro Sancho'),
  ('Terrassa', 'Estadi Olímpic de Terrassa'),
  ('CD Tudelano', 'Ciudad de Tudela'),
  ('UD Logroñés B', 'Ciudad Deportiva UD Logroñés'),
  ('UD Barbastro', 'Municipal de Deportes de Barbastro'),
  ('Girona FC B', 'Municipal de Riudarenes'),
  ('CD Alcoyano', 'El Collao'),
  ('CD Cieza', 'La Arboleja'),
  ('UD Castellonense', 'Eliseo Pla Ramírez'),
  ('UCAM Murcia', 'BeSoccer La Condomina'),
  ('CF La Nucía', 'Olímpic Camilo Cano'),
  ('UD Poblense', 'Municipal de Sa Pobla'),
  ('CF Lorca Deportiva', 'Francisco Artés Carrasco'),
  ('Elche Ilicitano', 'José Díez Iborra'),
  ('CD Minera', 'Ángel Celdrán'),
  ('SCR Peña Deportiva', 'Estadi Balear'),
  ('Real Murcia Imperial', 'Nueva Condomina'),
  ('Orihuela CF', 'Los Arcos'),
  ('CD Castellón B', 'Gaetà Huguet'),
  ('CF Intercity', 'Antonio Solana'),
  ('Valencia Mestalla', 'Antonio Puchades'),
  ('RCD Mallorca B', 'Son Bibiloni'),
  ('Yeclano Deportivo', 'La Constitución'),
  ('CD Atlético Baleares', 'Balear'),
  ('Atlético Antoniano', 'Municipal de Lebrija'),
  ('CD Don Benito', 'Vicente Sanz'),
  ('Salerm Cosmetics Puente Genil', 'Manuel Polinario'),
  ('CP Mijas Las Lagunas', 'Las Lagunas'),
  ('CD Badajoz', 'Nuevo Vivero'),
  ('CD Tenerife B', 'Ciudad Deportiva Javier Pérez'),
  ('Atlético Central', 'Nuevo Estadio Ciudad de Alcalá'),
  ('Recreativo de Huelva', 'Nuevo Colombino'),
  ('CD Estepona', 'Francisco Muñoz Pérez'),
  ('Xerez CD', 'Municipal de Chapín'),
  ('Linares Deportivo', 'Linarejos'),
  ('CD Ciudad de Lucena', 'Ciudad de Lucena'),
  ('Las Palmas Atlético', 'Anexo Estadio Gran Canaria'),
  ('Betis Deportivo', 'Luis del Sol'),
  ('Marbella FC', 'Dama de Noche - Banús Football Center'),
  ('Atlético Sanluqueño', 'El Palmar'),
  ('UD Tamaraceite', 'Juan Guedes'),
  ('Sevilla Atlético', 'Jesús Navas'),
  ('Real Madrid C', 'Ciudad Real Madrid'),
  ('Atlético Albacete', 'Ciudad Deportiva Andrés Iniesta'),
  ('Atlético de Madrid C', 'Cerro del Espino'),
  ('Real Ávila', 'Adolfo Suárez'),
  ('CD Atlético Paso', 'Municipal El Paso'),
  ('CD Numancia', 'Los Pajaritos'),
  ('CD Guadalajara', 'Pedro Escartín'),
  ('Salamanca UDS', 'El Helmántico'),
  ('Calvo Sotelo Puertollano', 'Municipal Ciudad de Puertollano'),
  ('Gimnástica Segoviana', 'La Albuera'),
  ('RSD Alcalá', 'El Val'),
  ('CF Talavera de la Reina', 'El Prado'),
  ('Real Valladolid Promesas', 'Anexos Estadio José Zorrilla'),
  ('CDA Navalcarnero', 'Municipal Mariano González'),
  ('Atlético Tordesillas', 'Municipal Las Salinas'),
  ('UD San Sebastián de los Reyes', 'José Luis de la Hoz - Matapiñonera'),
  ('UB Conquense', 'La Fuensanta'),
  ('Getafe B', 'Ciudad Deportiva Getafe CF');


-- ----------------------------------------------------------------------------
-- PASO 2 (diagnóstico): vista previa de lo que se va a rellenar, ANTES de
-- tocar nada.
-- ----------------------------------------------------------------------------
SELECT
  r.id,
  r.jornada,
  r.equipo_local,
  r.equipo_visitante,
  r.fecha_partido,
  e.estadio AS ubicacion_que_se_le_va_a_poner
FROM results r
JOIN _tmp_estadio_por_equipo e ON e.equipo = r.equipo_local
WHERE r.competicion = 'segunda_federacion'
  AND (r.ubicacion IS NULL OR TRIM(r.ubicacion) = '')
ORDER BY r.fecha_partido;


-- ----------------------------------------------------------------------------
-- PASO 3: la corrección en sí. Solo actualiza filas de segunda_federacion
-- con ubicación vacía Y cuyo equipo local se reconoce en el mapa.
-- ----------------------------------------------------------------------------
UPDATE results
SET ubicacion = (
  SELECT estadio FROM _tmp_estadio_por_equipo WHERE equipo = results.equipo_local
)
WHERE competicion = 'segunda_federacion'
  AND (ubicacion IS NULL OR TRIM(ubicacion) = '')
  AND equipo_local IN (SELECT equipo FROM _tmp_estadio_por_equipo);


-- ----------------------------------------------------------------------------
-- PASO 4 (diagnóstico final): partidos que SIGUEN sin ubicación después del
-- UPDATE -- el equipo local no se reconoce en ESTADIO_POR_CLUB (nombre
-- distinto al oficial: ejecuta primero las migraciones de normalización de
-- nombres) o falta añadirlo a esa lista. Revisar a mano desde el panel.
-- ----------------------------------------------------------------------------
SELECT
  id, jornada, equipo_local, equipo_visitante, fecha_partido, estado
FROM results
WHERE competicion = 'segunda_federacion'
  AND (ubicacion IS NULL OR TRIM(ubicacion) = '')
ORDER BY fecha_partido;

DROP TABLE IF EXISTS _tmp_estadio_por_equipo;
