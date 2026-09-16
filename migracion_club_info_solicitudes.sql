-- Migración: aprobación por nivel para las fichas informativas de club
--
-- Resume el cambio de negocio:
--  - Un redactor de Nivel 1 NO aplica directamente los cambios de una
--    ficha de club: se guardan como PROPUESTA pendiente de revisión.
--  - Un redactor de Nivel 2 o 3 aplica directo, igual que un admin
--    (como ya podía hacer cualquier redactor tras el cambio anterior).
--  - Un redactor de Nivel 4 aplica directo Y ADEMÁS puede aprobar o
--    rechazar las propuestas pendientes de Nivel 1, igual que un admin.
--
-- Se guarda en una tabla propia (no en edit_requests) porque aquí hace
-- falta conservar los DATOS propuestos (entrenador, estadio...), no
-- solo un permiso temporal sobre una entidad ya existente.

CREATE TABLE IF NOT EXISTS club_info_solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club TEXT NOT NULL,
  entrenador TEXT,
  estadio TEXT,
  fundacion INTEGER,
  ciudad TEXT,
  solicitante_id INTEGER NOT NULL,
  solicitante_nombre TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente, aprobada, rechazada
  resuelta_por_id INTEGER,
  resuelta_por_nombre TEXT,
  resuelta_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES users(id),
  FOREIGN KEY (resuelta_por_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_club_info_solicitudes_estado ON club_info_solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_club_info_solicitudes_club ON club_info_solicitudes(club);
