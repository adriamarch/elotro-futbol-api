-- Sobre-escritura manual de jornada por competición/grupo + rango de
-- fechas.
--
-- TheSportsDB da bien los partidos (equipos, marcador, fecha) pero a
-- menudo se equivoca en "intRound" (el número de jornada), sobre todo
-- en Primera/Segunda RFEF. En vez de fiarnos de ese campo, se define
-- aquí un calendario propio: "estos partidos, jugados entre estas dos
-- fechas, en esta competición/grupo, son la jornada N". El valor de
-- intRound se sigue usando tal cual solo cuando NINGÚN rango de esta
-- tabla cubre la fecha del partido (mejor una jornada probablemente
-- correcta de la API que ninguna).
--
-- "grupo" sigue el mismo convenio que en la tabla "results": NULL para
-- hypermotion (no tiene grupos), "Grupo 1".."Grupo 5" para
-- primera/segunda_federacion.
CREATE TABLE IF NOT EXISTS jornadas_calendario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competicion TEXT NOT NULL,
  grupo TEXT,
  jornada INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL, -- "YYYY-MM-DD", inclusive
  fecha_fin TEXT NOT NULL,    -- "YYYY-MM-DD", inclusive
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Búsqueda principal: "¿qué jornada corresponde a esta
-- competición/grupo en esta fecha?" (ver jornadaSobrescrita en
-- src/index.js).
CREATE INDEX IF NOT EXISTS idx_jornadas_calendario_busqueda
  ON jornadas_calendario(competicion, grupo, fecha_inicio, fecha_fin);

DROP TRIGGER IF EXISTS trg_jornadas_calendario_updated_at;
CREATE TRIGGER trg_jornadas_calendario_updated_at
AFTER UPDATE ON jornadas_calendario
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE jornadas_calendario SET updated_at = datetime('now') WHERE id = NEW.id;
END;
