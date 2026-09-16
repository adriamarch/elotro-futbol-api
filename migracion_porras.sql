-- ============================================================
-- Sistema de Porras — Fase 1: tabla de predicciones
-- ============================================================
-- Cada fila es la predicción de UN lector para UN partido concreto
-- (resultado_id, de la tabla "results" ya existente). No se guarda
-- competicion/grupo/jornada aquí: esos datos ya viven en "results" y
-- se obtienen con un JOIN, para que nunca puedan desincronizarse si
-- un redactor corrige la jornada o el grupo de un partido después de
-- que alguien ya haya hecho su porra.
--
-- Los puntos (puntos_obtenidos) SÍ se guardan aquí, aunque en teoría
-- se podrían recalcular siempre al vuelo comparando con goles_local/
-- goles_visitante de "results": se persisten para que consultar el
-- histórico de puntos de un lector (ranking, "mis porras pasadas") no
-- tenga que recalcular sobre todos sus partidos jugados en cada
-- petición, y para poder congelar el punto exacto con el que se
-- resolvió un partido aunque más adelante se recalculase el sistema
-- de puntuación (ver notas de negocio más abajo).
CREATE TABLE IF NOT EXISTS porras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  resultado_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  goles_local_predicho INTEGER NOT NULL,
  goles_visitante_predicho INTEGER NOT NULL,
  -- NULL mientras el partido no está "finalizado". Se rellena en el
  -- momento en que se PIDE esa porra (GET) y el partido ya está
  -- finalizado, no mediante un cron aparte: así no hace falta ningún
  -- job periódico ni engancharse a los 3 sitios distintos del código
  -- donde un partido puede pasar a "finalizado" (panel normal, Minuto
  -- a Minuto, cierre automático al minuto 90). Ver
  -- calcularYPersistirPuntosPendientes() en el Worker.
  puntos_obtenidos INTEGER,
  -- 'pendiente' | 'exacto' | 'acierto' | 'fallo'. Igual que
  -- puntos_obtenidos, se congela en el momento de resolver, en vez de
  -- derivarse cada vez de los puntos (por si el baremo de puntos
  -- cambia de temporada en temporada, el TIPO de acierto de una porra
  -- ya jugada no debería cambiar retroactivamente).
  resultado_acierto TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un lector solo puede tener UNA predicción activa por partido:
  -- "guardar de nuevo" es siempre editar la existente (mientras el
  -- partido lo permita), nunca crear una fila duplicada.
  UNIQUE (reader_id, resultado_id)
);

-- Consulta más habitual: "todas las porras de este lector para estos
-- partidos" (se resuelve con un IN sobre resultado_id) y "todas las
-- porras de este lector" (para su historial/estadísticas propias).
CREATE INDEX IF NOT EXISTS idx_porras_reader ON porras(reader_id);
CREATE INDEX IF NOT EXISTS idx_porras_resultado ON porras(resultado_id);

-- ------------------------------------------------------------
-- Notas de negocio (baremo de puntos), documentadas aquí porque el
-- Worker las aplica en tiempo de resolución y conviene que el criterio
-- viva junto al esquema que lo guarda:
--   - 3 puntos: acierto EXACTO del marcador (ej. predices 2-1, acaba 2-1).
--   - 1 punto: acierto del RESULTADO (signo: victoria local / empate /
--     victoria visitante) sin acertar el marcador exacto.
--   - 0 puntos: fallo del signo.
-- Este baremo vive como constantes en el Worker (PUNTOS_ACIERTO_EXACTO,
-- PUNTOS_ACIERTO_SIGNO), no en la base de datos, para poder ajustarlo
-- sin migración; lo que si se congela por fila es el resultado YA
-- calculado con el baremo vigente en el momento de resolverla.
-- ------------------------------------------------------------
