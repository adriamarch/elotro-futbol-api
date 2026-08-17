-- Migración: escudo personalizado para equipos "externos" (que no están
-- en la lista de clubs.js) en un resultado.
--
-- Cuando el equipo local/visitante está en la lista de clubs.js, su
-- escudo se resuelve automáticamente en el frontend a partir del nombre
-- (ver public/js/clubs.js -> getEscudoUrl). Estas columnas solo se
-- rellenan cuando, desde el panel, se elige "Otro equipo (no está en la
-- lista)" y se sube un PNG de su escudo a Cloudinary: entonces se guarda
-- aquí la URL para que la web pública la pinte en vez de intentar
-- adivinar un archivo local que no existe.
--
-- Solo hace falta ejecutar esto si la base de datos D1 ya estaba
-- desplegada ANTES de esta función. Si la base de datos es nueva,
-- ignora este archivo: schema.sql ya incluye estas columnas.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_escudos_resultado.sql

ALTER TABLE results ADD COLUMN escudo_local_url TEXT;
ALTER TABLE results ADD COLUMN escudo_visitante_url TEXT;
