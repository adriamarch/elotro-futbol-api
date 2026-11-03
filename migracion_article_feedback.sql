-- Feedback de revisores a redactores: aviso al autor cuando se aprueba,
-- programa o devuelve su pieza (con nota breve del revisor) y observaciones
-- sueltas. article_id puede quedar a NULL si la noticia se borra: por eso
-- se guarda también el título (article_titulo).
--   tipo: aprobada | programada | cambios | observacion
CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  article_titulo TEXT NOT NULL DEFAULT '',
  article_slug TEXT,
  destinatario_id INTEGER NOT NULL,
  autor_feedback_id INTEGER,
  autor_feedback_nombre TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'observacion',
  nota TEXT,
  leido INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_feedback_dest ON article_feedback(destinatario_id, leido, created_at);
CREATE INDEX IF NOT EXISTS idx_article_feedback_updated ON article_feedback(updated_at);
