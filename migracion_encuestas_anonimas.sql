-- Migración: encuestas libres (votar sin cuenta ni sesión).
--
-- Hasta ahora poll_votes exigía reader_id NOT NULL (solo votaban lectores
-- con cuenta verificada). Ahora vota cualquiera: quien vota se identifica
-- por voter_hash, un hash no reversible de IP + User-Agent + id de
-- encuesta + secreto del servidor (ver hashVotanteEncuesta en
-- worker/src/index.js). reader_id pasa a ser opcional y se conserva solo
-- para los votos antiguos hechos cuando votar exigía cuenta.
--
-- SQLite/D1 no permite quitar el NOT NULL de una columna con ALTER TABLE,
-- así que se reconstruye la tabla. Los votos existentes se conservan con
-- sus mismos id (importante: el sync a Postgres usa id como clave).
-- Ejecutar UNA sola vez:
--   wrangler d1 execute <BASE_DE_DATOS> --remote --file=migracion_encuestas_anonimas.sql

CREATE TABLE poll_votes_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  reader_id INTEGER REFERENCES readers(id),
  voter_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un voto por lector con cuenta (votos antiguos) y encuesta...
  UNIQUE(poll_id, reader_id),
  -- ...y un voto por visitante anónimo y encuesta. Los NULL no chocan
  -- entre sí en SQLite: los votos antiguos (voter_hash NULL) y los
  -- nuevos (reader_id NULL) conviven sin problema.
  UNIQUE(poll_id, voter_hash)
);

INSERT INTO poll_votes_nueva (id, poll_id, option_id, reader_id, created_at)
  SELECT id, poll_id, option_id, reader_id, created_at FROM poll_votes;

-- Conserva el contador de AUTOINCREMENT de la tabla antigua. Sin esto, si
-- los últimos votos se habían borrado, la tabla nueva reutilizaría sus id,
-- y el sync a Postgres (que usa id como clave y no detecta borrados de
-- poll_votes) podría confundir un voto nuevo con uno viejo. Si D1 rechazara
-- estas dos sentencias sobre sqlite_sequence, se pueden quitar: solo evitan
-- ese caso límite.
DELETE FROM sqlite_sequence WHERE name = 'poll_votes_nueva';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'poll_votes_nueva', seq FROM sqlite_sequence WHERE name = 'poll_votes';

DROP TABLE poll_votes;
ALTER TABLE poll_votes_nueva RENAME TO poll_votes;

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes(option_id);
