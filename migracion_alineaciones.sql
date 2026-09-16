-- Migración: añade la tabla "alineaciones" (once inicial de un equipo,
-- dibujado sobre un campo de fútbol) que se puede vincular tanto a una
-- noticia/crónica (articles) como a un partido (results), de forma
-- independiente: una noticia puede llevar su propia alineación aunque
-- no esté vinculada a ningún resultado, y un resultado puede llevar la
-- suya aunque todavía no se haya escrito ninguna crónica sobre él.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=./worker/migracion_alineaciones.sql

CREATE TABLE IF NOT EXISTS alineaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Exactamente uno de los dos debe estar relleno (se valida en el
  -- Worker, no aquí): a qué noticia o a qué partido pertenece esta
  -- alineación. ON DELETE CASCADE: si se borra la noticia/el partido,
  -- su alineación se borra sola.
  article_id INTEGER,
  result_id INTEGER,
  -- Nombre del equipo (se guarda como texto suelto, igual que
  -- equipo_local/equipo_visitante en results, para admitir tanto clubes
  -- de la lista fija como personalizados).
  equipo TEXT NOT NULL,
  -- Escudo personalizado (si el equipo no está en la lista fija de
  -- public/js/clubs.js); si está vacío, el frontend resuelve el escudo
  -- automáticamente a partir del nombre del equipo.
  escudo_url TEXT,
  -- Formación, en formato "4-3-3", "4-4-2", etc. Puramente informativa
  -- (se muestra como etiqueta); la posición real de cada jugador sobre
  -- el campo la marca "jugadores".
  formacion TEXT NOT NULL DEFAULT '4-3-3',
  -- Once (y suplentes) dibujado sobre el campo: array JSON de objetos
  -- {dorsal, nombre, x, y, titular}, donde x/y son porcentajes (0-100)
  -- de la posición sobre el campo (0,0 = esquina superior izquierda de
  -- la portería propia; 100,100 = esquina inferior derecha de la
  -- portería rival), tal y como los coloca el editor visual del panel.
  -- Los suplentes (titular = false) no llevan x/y y se listan aparte.
  jugadores TEXT NOT NULL DEFAULT '[]',
  -- Quién creó/gestiona esta alineación (mismo criterio de permisos de
  -- edición que articles/results, ver tabla edit_requests).
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alineaciones_article ON alineaciones(article_id);
CREATE INDEX IF NOT EXISTS idx_alineaciones_result ON alineaciones(result_id);
