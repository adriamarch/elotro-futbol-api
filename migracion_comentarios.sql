-- Comentarios de lectores dentro de cada noticia/crónica/opinión/entrevista.
-- Cualquier visitante puede dejar uno (nombre + email + texto, sin
-- necesidad de registro), pero no se muestra en la web hasta que un
-- admin lo aprueba desde el panel ("Comentarios"). El email nunca se
-- expone en el frontend público: solo sirve para que la redacción pueda
-- contactar o identificar a quien comenta si hiciera falta moderar.
DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  texto TEXT NOT NULL,
  -- pendiente: recién enviado, en espera de moderación (no visible).
  -- aprobado: visible públicamente bajo la noticia.
  -- rechazado: revisado y descartado por un admin (no se borra, para
  -- llevar registro de spam/abusos ya vistos).
  estado TEXT NOT NULL DEFAULT 'pendiente',
  -- IP de quien comenta (no se muestra nunca, solo para poder detectar
  -- abuso/spam repetido desde el panel si hiciera falta).
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  moderado_por_id INTEGER,
  moderado_at TEXT,
  FOREIGN KEY (moderado_por_id) REFERENCES users(id)
);
CREATE INDEX idx_comments_article ON comments(article_id, estado);
CREATE INDEX idx_comments_estado ON comments(estado, created_at);
