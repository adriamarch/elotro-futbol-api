-- Votaciones internas: VOTO SECRETO DE VERDAD.
--
-- Problema anterior: en las votaciones "anónimas" el servidor solo ocultaba
-- los nombres al mostrarlos, pero la base de datos seguía guardando
-- (usuario_id, opcion_id, created_at). Quien tuviera acceso a la BD, a un
-- export o a una copia de seguridad podía saber qué votó cada persona.
--
-- Diseño nuevo (urna separada de la lista de participación):
--
--   votaciones_internas_participacion
--       QUIÉN ha votado (votacion_id, usuario_id). Sirve para impedir el
--       doble voto y para mostrar "X de Y han votado". NO guarda opción,
--       NO guarda fecha/hora y es WITHOUT ROWID (ordenada por clave, no por
--       orden de llegada), así que no se puede deducir el orden de voto.
--
--   votaciones_internas_urna
--       QUÉ se ha votado en votaciones secretas (votacion_id, opcion_id).
--       NO guarda usuario, NO guarda fecha/hora, la clave es un token
--       aleatorio y es WITHOUT ROWID: no hay forma de emparejar una papeleta
--       con una persona, ni siquiera por orden de inserción.
--
--   votaciones_internas_votos (existente)
--       Se sigue usando SOLO en votaciones nominales (no anónimas), donde
--       el nombre es público a propósito y se puede cambiar el voto.
--
-- Esta migración también SANEA las votaciones anónimas que ya existían:
-- mueve sus votos a la urna (sin usuario, sin fecha, barajados) y los borra
-- de la tabla nominal.
--
-- Ejecutar UNA sola vez:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_votaciones_privadas.sql

CREATE TABLE IF NOT EXISTS votaciones_internas_participacion (
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  usuario_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (votacion_id, usuario_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS votaciones_internas_urna (
  token       TEXT PRIMARY KEY,
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  opcion_id   INTEGER NOT NULL REFERENCES votaciones_internas_opciones(id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_votint_urna_votacion ON votaciones_internas_urna(votacion_id, opcion_id);

-- 1) Participación de TODAS las votaciones ya existentes (sin opción ni fecha).
INSERT OR IGNORE INTO votaciones_internas_participacion (votacion_id, usuario_id)
  SELECT DISTINCT votacion_id, usuario_id FROM votaciones_internas_votos;

-- 2) Votaciones anónimas antiguas -> urna, con token aleatorio y en orden
--    aleatorio, sin usuario ni fecha.
INSERT INTO votaciones_internas_urna (token, votacion_id, opcion_id)
  SELECT lower(hex(randomblob(16))), v.votacion_id, v.opcion_id
  FROM votaciones_internas_votos v
  JOIN votaciones_internas vi ON vi.id = v.votacion_id
  WHERE vi.anonima = 1
  ORDER BY random();

-- 3) Se elimina el vínculo persona -> opción de esas votaciones anónimas.
DELETE FROM votaciones_internas_votos
  WHERE votacion_id IN (SELECT id FROM votaciones_internas WHERE anonima = 1);

-- 4) Las votaciones anónimas pasan a mostrar resultados solo al cerrar:
--    si los recuentos se ven en directo, cada voto nuevo delata a quien
--    acaba de votar (el contador sube justo cuando esa persona vota).
UPDATE votaciones_internas SET resultados_visibles = 'al_cerrar' WHERE anonima = 1;
