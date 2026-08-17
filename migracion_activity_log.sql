-- Historial de acciones (auditoría) - solo visible para admins desde el panel.
-- Registra quién ha hecho qué, cuándo y sobre qué elemento, para poder
-- revisar la actividad de cada persona del equipo con todo detalle.

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_nombre TEXT NOT NULL,
  usuario_rol TEXT NOT NULL,
  accion TEXT NOT NULL,       -- p.ej. 'crear_noticia', 'eliminar_usuario', 'login'...
  entidad TEXT,               -- 'articulo', 'usuario', 'resultado', 'media', 'settings', 'sesion'
  entidad_id TEXT,            -- id o slug del elemento afectado (texto para admitir ambos)
  descripcion TEXT NOT NULL,  -- frase legible: "Ha publicado la noticia \"X\""
  detalle TEXT,               -- JSON opcional con datos extra (cambios, ip, etc.)
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_usuario ON activity_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_activity_accion ON activity_log(accion);
CREATE INDEX IF NOT EXISTS idx_activity_entidad ON activity_log(entidad, entidad_id);
