-- Migración: cuentas de lectores (distintas de "users", que es solo
-- para redactores/admin del panel).
--
-- Un lector se registra con nombre + email + contraseña para poder
-- comentar las noticias con su nombre real en vez de tener que escribir
-- nombre y email sueltos en cada comentario. La cuenta se activa
-- verificando el correo (se manda un enlace de un solo uso al
-- registrarse, igual que el de "recuperar contraseña" de los
-- redactores); hasta que no se verifica, no puede comentar.
--
-- Separada de "users" a propósito: son roles distintos (lector vs.
-- redactor/admin), con su propio login/registro público y sin acceso
-- al panel de administración.

CREATE TABLE IF NOT EXISTS readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  -- Un lector no puede comentar hasta que verifica su correo (evita
  -- registros con emails ajenos o inventados suplantando a otra
  -- persona en los comentarios).
  email_verificado INTEGER NOT NULL DEFAULT 0,
  -- Token de un solo uso para verificar el email al registrarse, y
  -- también reutilizado para "recuperar contraseña" (mismo mecanismo,
  -- caduca a los 30 minutos, se borra en cuanto se usa o caduca).
  verificacion_token TEXT,
  verificacion_token_expira TEXT,
  reset_token TEXT,
  reset_token_expira TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readers_email ON readers(email);

-- Sesiones de lectores (mismo patrón que "sessions" para redactores):
-- permite invalidar el JWT emitido con solo borrar/revocar esta fila,
-- sin esperar a que caduque por sí solo, y en el futuro poder listar
-- "tus dispositivos" igual que ya existe para el panel.
CREATE TABLE IF NOT EXISTS reader_sessions (
  id TEXT PRIMARY KEY,
  reader_id INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (reader_id) REFERENCES readers(id)
);
CREATE INDEX IF NOT EXISTS idx_reader_sessions_reader ON reader_sessions(reader_id);

-- Vincula cada comentario con la cuenta de lector que lo escribió (si
-- se envió habiendo iniciado sesión). NULL para comentarios antiguos o
-- de quien comenta sin registrarse (sigue permitido: el registro no es
-- obligatorio para comentar, solo una opción para firmar con tu nombre
-- de forma reutilizable y con una insignia de "verificado").
ALTER TABLE comments ADD COLUMN reader_id INTEGER REFERENCES readers(id);
CREATE INDEX IF NOT EXISTS idx_comments_reader ON comments(reader_id);
