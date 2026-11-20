-- Papelera: borrado recuperable de noticias y archivos de la mediateca.
-- Al eliminar una noticia o un archivo desde el panel se guarda aquí una copia
-- completa (JSON) antes de quitar la fila, junto con lo que el borrado arrastraba
-- por ON DELETE CASCADE (comentarios, alineaciones, galerías, enlaces...).
-- Se puede restaurar durante 30 días (purgar_despues); después la vacía el cron y,
-- en los archivos, solo entonces se destruye el original en Cloudinary.
--   tipo: articulo | media        subtipo: tipo de noticia / foto | video
--   created_at = momento en que se eliminó
-- APLICAR ANTES de desplegar el Worker: sin esta tabla, borrar noticias o archivos
-- da error a propósito (no se borra nada si no se puede guardar la copia).
CREATE TABLE IF NOT EXISTS papelera (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  subtipo TEXT,
  entidad_id INTEGER NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  miniatura TEXT,
  datos TEXT NOT NULL,
  relacionados TEXT,
  cloudinary_public_id TEXT,
  cloudinary_resource_type TEXT,
  cloud_name TEXT,
  eliminado_por_id INTEGER,
  eliminado_por_nombre TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  purgar_despues TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_papelera_creada ON papelera(created_at);
CREATE INDEX IF NOT EXISTS idx_papelera_purga ON papelera(purgar_despues);
CREATE INDEX IF NOT EXISTS idx_papelera_usuario ON papelera(eliminado_por_id);
