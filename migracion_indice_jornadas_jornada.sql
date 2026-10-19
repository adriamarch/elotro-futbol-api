-- jornadas_calendario: el índice existente (competicion, grupo, fecha_inicio,
-- fecha_fin) no cubre la búsqueda por número de jornada, que es la que usan
-- las consultas "WHERE competicion = ? AND grupo IS ? AND jornada = ?"
-- (ratio de lectura/devolución 9 en las estadísticas de consultas).
CREATE INDEX IF NOT EXISTS idx_jornadas_calendario_jornada
  ON jornadas_calendario(competicion, grupo, jornada);
