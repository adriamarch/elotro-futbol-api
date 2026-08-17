-- Migración: sesiones activas por usuario
--
-- Permite que cada persona vea desde "Ajustes de cuenta -> Sesiones" en
-- qué dispositivos/navegadores tiene la sesión iniciada actualmente
-- (con IP, dispositivo aproximado y última vez que se ha usado) y pueda
-- cerrar cualquiera de ellas en remoto (por ejemplo si se dejó la sesión
-- abierta en un ordenador compartido), sin tener que esperar a que
-- caduque sola.
--
-- El JWT ya no basta por sí solo para autenticar: ahora lleva un "sid"
-- (id de esta tabla) y, en cada petición, se comprueba además que esa
-- fila siga existiendo y no esté revocada. Así, cerrar una sesión desde
-- aquí la invalida al momento aunque el JWT en sí no haya caducado.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, -- id aleatorio (no autoincremental, para no filtrar cuántas sesiones hay en total)
  user_id INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
