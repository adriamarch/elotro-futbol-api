-- Migración: permisos de edición por autor + solicitudes + "Última hora"
--
-- Resume los tres cambios de negocio:
--  1) Cada redactor solo puede editar/borrar SUS PROPIAS noticias,
--     crónicas, artículos de opinión, entrevistas y resultados. Un
--     admin puede editar/borrar cualquier cosa, siempre.
--  2) Si un redactor quiere tocar algo de otra persona, tiene que
--     "solicitarlo": se crea una fila en edit_requests, y la puede
--     aprobar tanto un admin como el autor original. Al aprobarse, el
--     solicitante puede editar ese artículo/resultado concreto durante
--     un tiempo limitado (ver EDIT_GRANT_MINUTOS en el worker).
--  3) Los redactores YA NO pueden publicar directamente noticias,
--     crónicas, opinión ni entrevistas: se guardan siempre como
--     borrador, salvo que usen "Última hora" con su contraseña de 4
--     dígitos (distinta para cada redactor, la asigna/cambia un admin).
--     Los admins sí pueden seguir publicando directamente.

-- 1) Autor en resultados (antes no lo tenía; hace falta para poder
--    restringir su edición por autor igual que en articles).
ALTER TABLE results ADD COLUMN autor_id INTEGER REFERENCES users(id);
ALTER TABLE results ADD COLUMN autor_nombre TEXT;

-- 2) Contraseña de "Última hora": 4 dígitos, propia de cada redactor,
--    que solo puede ver/cambiar un admin. Se guarda con hash (no en
--    claro) igual que la contraseña de acceso, con su propia sal.
ALTER TABLE users ADD COLUMN ultima_hora_hash TEXT;
ALTER TABLE users ADD COLUMN ultima_hora_salt TEXT;

-- 3) Solicitudes de edición de contenido ajeno.
CREATE TABLE IF NOT EXISTS edit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_entidad TEXT NOT NULL,        -- 'articulo' o 'resultado'
  entidad_id INTEGER NOT NULL,       -- id del articles.id o results.id
  solicitante_id INTEGER NOT NULL,   -- redactor que pide editar
  autor_id INTEGER,                  -- autor original en el momento de pedirlo (puede ser NULL)
  motivo TEXT,                       -- nota opcional del solicitante
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente, aprobada, rechazada, caducada
  resuelta_por_id INTEGER,           -- quién la aprobó/rechazó (admin o autor original)
  resuelta_at TEXT,
  -- Ventana de tiempo durante la que el solicitante puede editar esa
  -- entidad concreta una vez aprobada la solicitud (ver EDIT_GRANT_MINUTOS
  -- en el worker). NULL hasta que se aprueba.
  permiso_expira_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES users(id),
  FOREIGN KEY (autor_id) REFERENCES users(id),
  FOREIGN KEY (resuelta_por_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_edit_requests_entidad ON edit_requests(tipo_entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_edit_requests_solicitante ON edit_requests(solicitante_id, estado);
CREATE INDEX IF NOT EXISTS idx_edit_requests_estado ON edit_requests(estado);
