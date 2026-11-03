-- Índices para las lecturas públicas de partidos (clasificación, calendario,
-- resultados, ficha de equipo, portada). Antes solo existían índices por
-- estado, fecha y (competicion, jornada); las consultas filtran por
-- competicion + grupo + desde_fecha y ordenan por fecha_partido DESC, o por
-- equipo_local / equipo_visitante (ficha de club), y acababan escaneando.
-- Seguro de repetir (IF NOT EXISTS). Aplicar en D1:
--   wrangler d1 execute <BASE> --remote --file=worker/migracion_indices_results.sql
CREATE INDEX IF NOT EXISTS idx_results_comp_grupo_fecha ON results(competicion, grupo, fecha_partido DESC);
CREATE INDEX IF NOT EXISTS idx_results_estado_fecha ON results(estado, fecha_partido DESC);
CREATE INDEX IF NOT EXISTS idx_results_equipo_local ON results(equipo_local);
CREATE INDEX IF NOT EXISTS idx_results_equipo_visitante ON results(equipo_visitante);
PRAGMA optimize;
