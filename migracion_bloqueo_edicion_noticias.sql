-- Bloqueo de edición simultánea de noticias.
-- Una fila por noticia que alguien tiene abierta en el panel. El navegador la renueva cada 25 s
-- (heartbeat_at / expires_at); si se cierra o pierde la conexión, expira sola a los 90 s.
-- OPCIONAL: el Worker crea esta tabla en caliente la primera vez que se usa (CREATE TABLE IF NOT EXISTS),
-- así que no hace falta aplicarla antes de desplegar. Se deja aquí para tener el esquema documentado.
--   session_id: identificador de la pestaña (la misma persona en dos pestañas también cuenta como simultánea)
--   fechas: ISO-8601 en TEXT (se comparan como cadenas)
CREATE TABLE IF NOT EXISTS article_edit_locks (
  article_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
