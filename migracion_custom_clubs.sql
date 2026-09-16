-- Clubes "personalizados": equipos que un redactor/admin ha añadido a
-- mano desde la opción "Otro equipo (no está en la lista)" al crear un
-- resultado o una noticia, con su escudo (si se ha subido). Se guardan
-- aquí para que, a partir de ese momento, aparezcan automáticamente en
-- el desplegable de equipos de esa categoría (tanto en el panel como en
-- la web pública), igual que los que ya vienen fijos en clubs.js.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_custom_clubs.sql

CREATE TABLE IF NOT EXISTS custom_clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  -- Categoría en la que se ha usado este club (hypermotion,
  -- primera_federacion, segunda_federacion). Un mismo nombre de club
  -- puede añadirse en más de una categoría si hace falta.
  categoria TEXT NOT NULL,
  -- Escudo subido a Cloudinary al elegir "Otro equipo"; puede quedar
  -- NULL si no se subió ninguno (se usará el escudo genérico).
  escudo_url TEXT,
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id),
  UNIQUE (nombre, categoria)
);
CREATE INDEX IF NOT EXISTS idx_custom_clubs_categoria ON custom_clubs(categoria);
