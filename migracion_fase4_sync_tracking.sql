-- FASE 4 — Migración y sincronización D1 -> PostgreSQL
--
-- Estas tablas se modifican con UPDATEs a lo largo de src/index.js pero no
-- tenían ninguna columna que registrara CUÁNDO se modificó por última vez
-- (a diferencia de articles/alineaciones/club_info/settings, que ya tienen
-- "updated_at"). Sin eso, el sincronizador incremental no puede saber qué
-- filas cambiaron desde la última pasada sin releer la tabla entera.
--
-- Se añade "updated_at" + un trigger AFTER UPDATE que lo refresca solo.
-- No se toca ningún endpoint, ninguna consulta existente ni el
-- comportamiento de la API: las columnas nuevas son NOT NULL DEFAULT
-- (datetime('now')) y el trigger actúa de forma transparente sobre
-- cualquier UPDATE, sin que el Worker tenga que enterarse ni cambiar una
-- sola línea de src/index.js.
--
-- Tablas cubiertas: users, results, sessions, edit_requests, comments,
-- club_info_solicitudes.
--
-- (match_events, custom_clubs, article_slug_redirects, activity_log y
-- nivel_historial son de solo-inserción -> con created_at basta. Ver
-- SINCRONIZACION-INCREMENTAL.md para el análisis completo tabla a tabla.)

ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE results ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE edit_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE comments ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE club_info_solicitudes ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- Inicializar updated_at = created_at en filas existentes (si no, todas
-- las filas antiguas quedarían con el mismo "now" del ALTER TABLE, lo cual
-- las marcaría a todas como "recién cambiadas" en la primera pasada
-- incremental; no es incorrecto -por idempotencia no duplica nada- pero
-- es más ruidoso de lo necesario).
UPDATE users SET updated_at = created_at;
UPDATE results SET updated_at = created_at;
UPDATE sessions SET updated_at = created_at;
UPDATE edit_requests SET updated_at = created_at;
UPDATE comments SET updated_at = created_at;
UPDATE club_info_solicitudes SET updated_at = created_at;

DROP TRIGGER IF EXISTS trg_users_updated_at;
CREATE TRIGGER trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_results_updated_at;
CREATE TRIGGER trg_results_updated_at
AFTER UPDATE ON results
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE results SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_sessions_updated_at;
CREATE TRIGGER trg_sessions_updated_at
AFTER UPDATE ON sessions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE sessions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_edit_requests_updated_at;
CREATE TRIGGER trg_edit_requests_updated_at
AFTER UPDATE ON edit_requests
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE edit_requests SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_comments_updated_at;
CREATE TRIGGER trg_comments_updated_at
AFTER UPDATE ON comments
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE comments SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_club_info_solicitudes_updated_at;
CREATE TRIGGER trg_club_info_solicitudes_updated_at
AFTER UPDATE ON club_info_solicitudes
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE club_info_solicitudes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Índices para que el sincronizador pueda filtrar "WHERE updated_at > ?"
-- de forma eficiente en tablas con muchas filas.
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
CREATE INDEX IF NOT EXISTS idx_results_updated_at ON results(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_edit_requests_updated_at ON edit_requests(updated_at);
CREATE INDEX IF NOT EXISTS idx_comments_updated_at ON comments(updated_at);
CREATE INDEX IF NOT EXISTS idx_club_info_solicitudes_updated_at ON club_info_solicitudes(updated_at);
