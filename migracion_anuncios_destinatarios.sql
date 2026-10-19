-- Registro de a quién se ha enviado cada anuncio por correo (Funcionalidades > Anuncios).
-- Permite reanudar un envío interrumpido sin repetirlo a quien ya lo recibió.
-- OPCIONAL: el Worker crea esta tabla solo la primera vez que se envía un anuncio. Si prefieres
-- aplicarla a mano sobre la base D1 ya desplegada:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_anuncios_destinatarios.sql
--
-- estado: 'enviando' (reclamado, en curso) | 'enviado' | 'fallido'

CREATE TABLE IF NOT EXISTS anuncios_email_destinatarios (
  anuncio_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (anuncio_id, email)
);
