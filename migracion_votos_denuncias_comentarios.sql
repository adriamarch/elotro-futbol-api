-- Votos (like/dislike) y denuncias de comentarios de lectores.
--
-- Votos: cualquier visitante puede votar un comentario ya aprobado como
-- útil o no. Se guarda un registro por "votante" (identificado por una
-- cookie/id anónimo generado en el navegador, ver `comment_votes.votante_id`)
-- para poder impedir votos duplicados y permitir cambiar/quitar el voto.
-- Los contadores agregados se guardan también en `comments` para no tener
-- que hacer COUNT(*) en cada carga de la noticia.
ALTER TABLE comments ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;

-- Denuncias: cuando un lector denuncia un comentario se guarda un registro
-- para que un admin lo revise manualmente en el panel. Si un mismo
-- comentario acumula varias denuncias se oculta automáticamente de la web
-- (sin borrarlo ni cambiar su `estado` de moderación) hasta que un admin
-- lo revise: puede volver a mostrarlo o borrarlo directamente.
ALTER TABLE comments ADD COLUMN denuncias INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN oculto_por_denuncia INTEGER NOT NULL DEFAULT 0;

CREATE TABLE comment_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  -- id anónimo generado en el navegador (localStorage), no identifica a
  -- una persona real: solo sirve para no dejar votar dos veces desde el
  -- mismo navegador y para poder cambiar/quitar el voto ya emitido.
  votante_id TEXT NOT NULL,
  -- 1 = like, -1 = dislike
  valor INTEGER NOT NULL CHECK (valor IN (1, -1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (comment_id, votante_id)
);
CREATE INDEX idx_comment_votes_comment ON comment_votes(comment_id);

CREATE TABLE comment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  -- mismo id anónimo que en comment_votes, para no permitir que el mismo
  -- navegador denuncie el mismo comentario varias veces.
  denunciante_id TEXT NOT NULL,
  motivo TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- revisado: un admin ya lo ha mirado en el panel (se marque como se
  -- marque el comentario en sí: se conserva para llevar registro).
  revisado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (comment_id, denunciante_id)
);
CREATE INDEX idx_comment_reports_comment ON comment_reports(comment_id);
CREATE INDEX idx_comment_reports_revisado ON comment_reports(revisado, created_at);
