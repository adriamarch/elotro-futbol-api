-- Alias de la fuente externa (TheSportsDB / Flashscore) -> nombre "oficial"
-- (el de public/js/clubs.js) para 3 equipos de Primera RFEF cuyo nombre
-- corto no coincide con la clave exacta que usa getEscudoUrl en clubs.js,
-- así que el escudo del equipo no se pinta. Mismo patrón que
-- migracion_alias_segunda_federacion.sql.
--
-- IMPORTANTE: si tras ejecutar esta migración algún escudo TODAVÍA no
-- aparece bien, es porque el nombre real que usa la fuente externa para
-- ese equipo concreto no es el que se ha puesto aquí abajo. En ese caso,
-- mira el campo "strHomeTeam"/"strAwayTeam" de ese partido en el
-- diagnóstico (ver panel de admin) y corrige la fila con el nombre_externo
-- real:
--   UPDATE equipo_alias_externo SET nombre_externo = '<nombre real>' WHERE nombre_interno = '<nombre oficial>';
INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  ('Águilas', 'Águilas FC'),
  ('Alcorcón', 'AD Alcorcón'),
  ('Gimnàstic', 'Gimnàstic de Tarragona'),
  ('Gimnastic', 'Gimnàstic de Tarragona'),
  ('Nàstic', 'Gimnàstic de Tarragona'),
  ('Nastic', 'Gimnàstic de Tarragona');

-- Los partidos de estos equipos que YA se hayan guardado (con el nombre
-- corto de la fuente externa, antes de dar de alta estos alias) se
-- corrigen aquí para que pasen a tener el nombre oficial completo -así el
-- escudo se pinta también en los partidos ya sincronizados, no solo en
-- los nuevos-.
UPDATE results SET equipo_local = 'Águilas FC' WHERE competicion = 'primera_federacion' AND equipo_local = 'Águilas';
UPDATE results SET equipo_visitante = 'Águilas FC' WHERE competicion = 'primera_federacion' AND equipo_visitante = 'Águilas';

UPDATE results SET equipo_local = 'AD Alcorcón' WHERE competicion = 'primera_federacion' AND equipo_local = 'Alcorcón';
UPDATE results SET equipo_visitante = 'AD Alcorcón' WHERE competicion = 'primera_federacion' AND equipo_visitante = 'Alcorcón';

UPDATE results SET equipo_local = 'Gimnàstic de Tarragona' WHERE competicion = 'primera_federacion' AND equipo_local IN ('Gimnàstic', 'Gimnastic', 'Nàstic', 'Nastic');
UPDATE results SET equipo_visitante = 'Gimnàstic de Tarragona' WHERE competicion = 'primera_federacion' AND equipo_visitante IN ('Gimnàstic', 'Gimnastic', 'Nàstic', 'Nastic');
