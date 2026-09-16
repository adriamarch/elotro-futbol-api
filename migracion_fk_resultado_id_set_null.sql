-- Arregla el bug que impide borrar un resultado cuando tiene una noticia/
-- crónica vinculada (articles.resultado_id): la FK original no tenía
-- ON DELETE CASCADE ni ON DELETE SET NULL, así que DELETE FROM results
-- fallaba con SQLITE_CONSTRAINT_FOREIGNKEY (500) en vez de completarse.
--
-- SQLite no permite modificar una FOREIGN KEY con ALTER TABLE, así que se
-- recrea la tabla entera con la FK corregida (ON DELETE SET NULL: al
-- borrar el resultado, la noticia se queda sin partido vinculado en vez
-- de bloquear el borrado ni desaparecer ella misma).
--
-- Ejecutar en AMBAS bases: D1 (primaria) y Postgres/Railway (secundaria).
-- En Postgres la sintaxis de recreación de tabla es distinta: ver nota al
-- final de este archivo.

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

ALTER TABLE articles RENAME TO articles_old;

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  titulo TEXT NOT NULL,
  subtitulo TEXT,
  contenido TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'noticia',
  categoria TEXT NOT NULL DEFAULT 'hypermotion',
  categorias_adicionales TEXT,
  club TEXT,
  imagen_url TEXT,
  imagenes TEXT,
  resultado_id INTEGER,
  autor_id INTEGER,
  autor_nombre TEXT,
  coautor_id INTEGER,
  coautor_nombre TEXT,
  destacado INTEGER NOT NULL DEFAULT 0,
  publicado INTEGER NOT NULL DEFAULT 1,
  estado_borrador TEXT,
  programado_para TEXT,
  slug_congelado INTEGER NOT NULL DEFAULT 0,
  fecha_publicacion TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  titulo_eu TEXT, subtitulo_eu TEXT, contenido_eu TEXT,
  titulo_ca TEXT, subtitulo_ca TEXT, contenido_ca TEXT,
  titulo_gl TEXT, subtitulo_gl TEXT, contenido_gl TEXT,
  titulo_en TEXT, subtitulo_en TEXT, contenido_en TEXT,
  imagen_post_url TEXT,
  ficha_tecnica TEXT,
  FOREIGN KEY (autor_id) REFERENCES users(id),
  FOREIGN KEY (coautor_id) REFERENCES users(id),
  FOREIGN KEY (resultado_id) REFERENCES results(id) ON DELETE SET NULL
);

INSERT INTO articles SELECT * FROM articles_old;

DROP TABLE articles_old;

COMMIT;

PRAGMA foreign_keys=ON;

-- ---------------------------------------------------------------------
-- NOTA PARA POSTGRES (worker-secondary / Railway):
-- Ahí la FK se cambia sin recrear toda la tabla:
--
--   ALTER TABLE articles DROP CONSTRAINT articles_resultado_id_fkey;
--   ALTER TABLE articles
--     ADD CONSTRAINT articles_resultado_id_fkey
--     FOREIGN KEY (resultado_id) REFERENCES results(id) ON DELETE SET NULL;
--
-- (el nombre exacto de la constraint puede variar: comprobar antes con
--  \d articles en psql, o consultando information_schema.table_constraints)
-- ---------------------------------------------------------------------
