-- Alias de TheSportsDB -> nombre "oficial" (el de public/js/clubs.js) para
-- los 7 equipos de Segunda Federación que cubre ElOtroFútbol. Sin esto, el
-- partido se guarda con el nombre corto de TheSportsDB (p.ej. "Conquense"),
-- que el filtro por núcleo del calendario SÍ reconoce como soportado, pero
-- que no coincide con la clave exacta que usa getEscudoUrl en clubs.js, así
-- que el escudo del equipo no se pinta.
--
-- Confirmado con el endpoint de diagnóstico (/api/admin/relleno-automatico/
-- diagnostico) que TheSportsDB usa "Conquense" a secas para Grupo 5. El
-- resto de nombres de esta lista sigue el mismo patrón (nombre corto, sin
-- la sigla del club delante) tal y como se ve también en otras fuentes de
-- datos deportivos para estos mismos equipos.
--
-- IMPORTANTE: si tras ejecutar esta migración algún escudo TODAVÍA no
-- aparece bien, es porque el nombre real que usa TheSportsDB para ese
-- equipo concreto no es el que se ha puesto aquí abajo. En ese caso, mira
-- el campo "strHomeTeam"/"strAwayTeam" de ese partido en el diagnóstico (ver
-- panel de admin) y corrige la fila con el nombre_externo real:
--   UPDATE equipo_alias_externo SET nombre_externo = '<nombre real>' WHERE nombre_interno = '<nombre oficial>';
INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  ('Conquense', 'UB Conquense'),
  ('Guadalajara', 'CD Guadalajara'),
  ('Linares Deportivo', 'Linares Deportivo'),
  ('Linares', 'Linares Deportivo'),
  ('Badajoz', 'CD Badajoz'),
  ('Talavera de la Reina', 'CF Talavera de la Reina'),
  ('Talavera', 'CF Talavera de la Reina'),
  ('Recreativo Huelva', 'Recreativo de Huelva'),
  ('Recreativo de Huelva', 'Recreativo de Huelva'),
  ('Numancia', 'CD Numancia');

-- Los partidos de estos equipos que YA se hayan guardado (con el nombre
-- corto de TheSportsDB, antes de dar de alta estos alias) se corrigen aquí
-- para que pasen a tener el nombre oficial completo -así el escudo se
-- pinta también en los partidos ya sincronizados, no solo en los nuevos-.
UPDATE results SET equipo_local = 'UB Conquense' WHERE competicion = 'segunda_federacion' AND equipo_local = 'Conquense';
UPDATE results SET equipo_visitante = 'UB Conquense' WHERE competicion = 'segunda_federacion' AND equipo_visitante = 'Conquense';

UPDATE results SET equipo_local = 'CD Guadalajara' WHERE competicion = 'segunda_federacion' AND equipo_local = 'Guadalajara';
UPDATE results SET equipo_visitante = 'CD Guadalajara' WHERE competicion = 'segunda_federacion' AND equipo_visitante = 'Guadalajara';

UPDATE results SET equipo_local = 'CD Badajoz' WHERE competicion = 'segunda_federacion' AND equipo_local = 'Badajoz';
UPDATE results SET equipo_visitante = 'CD Badajoz' WHERE competicion = 'segunda_federacion' AND equipo_visitante = 'Badajoz';

UPDATE results SET equipo_local = 'CF Talavera de la Reina' WHERE competicion = 'segunda_federacion' AND equipo_local IN ('Talavera', 'Talavera de la Reina');
UPDATE results SET equipo_visitante = 'CF Talavera de la Reina' WHERE competicion = 'segunda_federacion' AND equipo_visitante IN ('Talavera', 'Talavera de la Reina');

UPDATE results SET equipo_local = 'Recreativo de Huelva' WHERE competicion = 'segunda_federacion' AND equipo_local = 'Recreativo Huelva';
UPDATE results SET equipo_visitante = 'Recreativo de Huelva' WHERE competicion = 'segunda_federacion' AND equipo_visitante = 'Recreativo Huelva';

UPDATE results SET equipo_local = 'CD Numancia' WHERE competicion = 'segunda_federacion' AND equipo_local = 'Numancia';
UPDATE results SET equipo_visitante = 'CD Numancia' WHERE competicion = 'segunda_federacion' AND equipo_visitante = 'Numancia';
