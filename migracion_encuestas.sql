-- Migración: encuestas para lectores.
--
-- Solo pueden votar lectores con cuenta (tabla "readers"), logueados
-- (sesión válida, igual que para comentar) y con el email verificado
-- (email_verificado = 1) — el mismo requisito que ya existe para poder
-- comentar una noticia, reutilizando por tanto requireReaderAuth().
--
-- Una encuesta puede:
--   - Estar ligada a una noticia (article_id) y/o
--   - Destacarse en portada (en_portada = 1)
-- Ambas cosas son independientes: puede vivir solo en una noticia, solo
-- en portada, o en ambos sitios a la vez. article_id puede ser NULL
-- (encuesta "suelta", solo en portada).
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pregunta TEXT NOT NULL,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  en_portada INTEGER NOT NULL DEFAULT 0,
  -- Orden de aparición cuando hay varias encuestas en portada a la vez
  -- (la de menor "orden_portada" se muestra primero).
  orden_portada INTEGER NOT NULL DEFAULT 0,
  -- abierta: acepta votos. cerrada: solo muestra resultados, ya no se
  -- puede votar (cierre manual desde el panel, o automático si
  -- cierra_en ya pasó).
  estado TEXT NOT NULL DEFAULT 'abierta',
  cierra_en TEXT,
  autor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_polls_article ON polls(article_id);
CREATE INDEX IF NOT EXISTS idx_polls_portada ON polls(en_portada, orden_portada);
CREATE INDEX IF NOT EXISTS idx_polls_estado ON polls(estado);

CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);

-- Un voto por lector y encuesta (no por opción: cambiar de opción
-- mueve este mismo registro, no crea uno nuevo). Ligado a "readers",
-- nunca a comentarios sueltos ni a nadie sin cuenta verificada.
CREATE TABLE IF NOT EXISTS poll_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  reader_id INTEGER NOT NULL REFERENCES readers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(poll_id, reader_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes(option_id);
