-- Votaciones internas del equipo (panel de redacción).
--
-- Un admin crea una votación con una pregunta y varias opciones tipo test;
-- el resto de colaboradores (admin, redactor y fotógrafo) votan desde la
-- pestaña "Votaciones" del panel.
--
--   multiple             -> 0 = una sola opción, 1 = se pueden marcar varias.
--   anonima              -> 1 = no se muestran nombres de quien vota.
--   resultados_visibles  -> 'siempre' | 'tras_votar' | 'al_cerrar'.
--   cierra_en            -> fecha límite opcional (UTC, 'YYYY-MM-DD HH:MM:SS').
--                           Pasada esa fecha la votación cuenta como cerrada
--                           aunque nadie pulse "Cerrar" (se calcula al leer).
--   estado               -> 'abierta' | 'cerrada' (cierre manual).
--
-- Los votos viven en una tabla aparte, una fila por opción marcada, con
-- UNIQUE(opcion_id, usuario_id) para que nadie vote dos veces lo mismo.
-- Cambiar el voto = borrar las filas del usuario en esa votación y volver a
-- insertar (ver POST /api/votaciones/:id/votar en worker/src/index.js).
--
-- Ejecutar UNA sola vez con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_votaciones_internas.sql

CREATE TABLE IF NOT EXISTS votaciones_internas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  multiple INTEGER NOT NULL DEFAULT 0,
  anonima INTEGER NOT NULL DEFAULT 0,
  resultados_visibles TEXT NOT NULL DEFAULT 'tras_votar',
  cierra_en TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta',
  creado_por INTEGER REFERENCES users(id),
  creado_por_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cerrada_en TEXT
);

CREATE TABLE IF NOT EXISTS votaciones_internas_opciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS votaciones_internas_votos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  opcion_id INTEGER NOT NULL REFERENCES votaciones_internas_opciones(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(opcion_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_votint_opciones_votacion ON votaciones_internas_opciones(votacion_id);
CREATE INDEX IF NOT EXISTS idx_votint_votos_votacion ON votaciones_internas_votos(votacion_id);
CREATE INDEX IF NOT EXISTS idx_votint_votos_usuario ON votaciones_internas_votos(usuario_id, votacion_id);
