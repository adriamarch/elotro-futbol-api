-- Migración 008: tabla jornadas_calendario (misma migración que
-- worker/migracion_jornadas_calendario.sql en D1, aplicada aquí a
-- Postgres para que el esquema de ambas bases coincida).
--
-- Sobre-escritura manual de jornada por competición/grupo + rango de
-- fechas, para corregir el intRound que a veces da mal TheSportsDB.
-- No forma parte del sincronizador D1<->Postgres incremental (no se
-- ha añadido a sync/tables.mjs): es una tabla de configuración que
-- cada worker (principal y de failover) gestiona y consulta de forma
-- independiente en su propia base, igual que hace cada uno con
-- sync_partidos_auto.

BEGIN;

CREATE TABLE IF NOT EXISTS jornadas_calendario (
  id SERIAL PRIMARY KEY,
  competicion TEXT NOT NULL,
  grupo TEXT,
  jornada INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jornadas_calendario_busqueda
  ON jornadas_calendario(competicion, grupo, fecha_inicio, fecha_fin);

CREATE OR REPLACE FUNCTION trg_jornadas_calendario_updated_at_fn()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jornadas_calendario_updated_at ON jornadas_calendario;
CREATE TRIGGER trg_jornadas_calendario_updated_at
BEFORE UPDATE ON jornadas_calendario
FOR EACH ROW
EXECUTE FUNCTION trg_jornadas_calendario_updated_at_fn();

COMMIT;
