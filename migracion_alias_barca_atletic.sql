-- Alias de TheSportsDB -> nombre "oficial" (el de public/js/clubs.js) para
-- el FC Barcelona Atlètic. TheSportsDB usa el nombre corto/comercial "Barça
-- Atlètic" para este equipo, que no coincide con la clave exacta que usa
-- getEscudoUrl en clubs.js ("FC Barcelona Atlètic"), así que el escudo no
-- se pinta y el nombre sale mal en la ficha del club.
--
-- Mismo patrón que migracion_alias_segunda_federacion.sql: si tras
-- ejecutar esta migración el escudo sigue sin aparecer, comprueba el
-- campo "strHomeTeam"/"strAwayTeam" real en el diagnóstico
-- (/api/admin/relleno-automatico/diagnostico) y corrige la fila con:
--   UPDATE equipo_alias_externo SET nombre_externo = '<nombre real>' WHERE nombre_interno = 'FC Barcelona Atlètic';
INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  ('Barça Atlètic', 'FC Barcelona Atlètic'),
  ('Barca Atletic', 'FC Barcelona Atlètic'),
  ('Barcelona Atletic', 'FC Barcelona Atlètic');

-- Los partidos que YA se hayan guardado con el nombre corto de
-- TheSportsDB (antes de dar de alta este alias) se corrigen aquí para
-- que el escudo se pinte también en los partidos ya sincronizados.
UPDATE results SET equipo_local = 'FC Barcelona Atlètic'
  WHERE competicion = 'segunda_federacion' AND equipo_local IN ('Barça Atlètic', 'Barca Atletic', 'Barcelona Atletic');
UPDATE results SET equipo_visitante = 'FC Barcelona Atlètic'
  WHERE competicion = 'segunda_federacion' AND equipo_visitante IN ('Barça Atlètic', 'Barca Atletic', 'Barcelona Atletic');
