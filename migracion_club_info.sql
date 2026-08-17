-- Ficha informativa de cada club (entrenador, estadio, año de
-- fundación...), que se muestra como recuadro en la página del equipo
-- (categoria.html?club=...&cat=...). Se identifica por el NOMBRE del
-- club tal cual se guarda en articles.club / results.equipo_local, sea
-- un club fijo de public/js/clubs.js o uno de custom_clubs: así no hace
-- falta duplicar ni sincronizar ninguna lista de equipos ya existente.
-- Se rellena a mano desde el panel ("Ajustes del medio" -> "Equipos");
-- si un club no tiene fila aquí, sencillamente no se muestra el
-- recuadro en su página.
DROP TABLE IF EXISTS club_info;
CREATE TABLE club_info (
  club TEXT PRIMARY KEY,
  entrenador TEXT,
  estadio TEXT,
  fundacion INTEGER, -- año de fundación, p.ej. 1913
  ciudad TEXT,
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id)
);
