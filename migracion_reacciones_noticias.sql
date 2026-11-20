-- Reacciones de los lectores a una noticia ("Útil" y "Me gusta").
--
-- Misma idea que comment_votes: cualquier visitante puede reaccionar a una
-- noticia publicada; se guarda un registro por "votante" (id anónimo generado
-- en el navegador, el mismo de los votos de comentarios) y por tipo, para que
-- no se pueda reaccionar dos veces desde el mismo navegador y para poder quitar
-- la reacción. Una persona puede marcar a la vez "Útil" y "Me gusta".
-- Solo-inserción/borrado (nunca se actualiza una fila): el sincronizador D1 -> PG
-- la trata como "immutable" por created_at.
CREATE TABLE IF NOT EXISTS article_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  votante_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('util', 'me_gusta')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, votante_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_article_reactions_article ON article_reactions(article_id, tipo);
