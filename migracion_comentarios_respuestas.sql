-- Comentarios más ricos: respuestas (hilos de un nivel) y avisos por correo.
--
-- Respuestas:
--   parent_id     = comentario "raíz" del hilo (siempre uno sin padre). Si alguien
--                   responde a una respuesta, parent_id sigue siendo la raíz.
--   responde_a_id = comentario concreto al que se contesta (puede ser una
--                   respuesta). De ahí sale el "en respuesta a <nombre>" y a quién
--                   se avisa por correo.
--   Al borrar el comentario raíz se borran sus respuestas (ON DELETE CASCADE).
--
-- Avisos por correo (solo a lectores con cuenta verificada; nunca a quien
-- comentó sin cuenta, porque su email no está verificado):
--   aviso_aprobado    = ya se avisó a su autor de que el comentario se publicó.
--   respuesta_avisada = ya se avisó al autor del comentario contestado.
--   Las dos evitan correos duplicados si un admin aprueba/desaprueba varias veces.
--   readers.avisos_comentarios = 0 si la persona se da de baja de estos avisos
--   (desde "Mi cuenta" o desde el enlace de baja del propio correo).
ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN responde_a_id INTEGER REFERENCES comments(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN aviso_aprobado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN respuesta_avisada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE readers ADD COLUMN avisos_comentarios INTEGER NOT NULL DEFAULT 1;

-- Los comentarios que ya existen NO deben generar correos si un admin
-- cambia su estado ahora: se marcan como ya avisados.
UPDATE comments SET aviso_aprobado = 1, respuesta_avisada = 1;

CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
