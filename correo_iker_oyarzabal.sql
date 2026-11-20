-- Pone el correo al usuario iker_oyarzabal (#101, fotógrafo) para que le lleguen los correos.
-- Sirve igual en D1 y en PostgreSQL (misma tabla users y misma columna email).
--
-- Aplicar en D1 (worker principal):
--   wrangler d1 execute elotrofutbol --remote --file=./correo_iker_oyarzabal.sql
-- Aplicar en PostgreSQL (worker secundario / Railway):
--   psql "$DATABASE_URL" -f correo_iker_oyarzabal.sql
--
-- Conviene ejecutarlo en las DOS bases de datos para que el correo no falte
-- si el worker principal cae y trabaja solo el secundario.
UPDATE users
SET email = 'oooyyyaaarrr20@gmail.com'
WHERE id = 101 AND username = 'iker_oyarzabal';

-- Comprobación
SELECT id, username, nombre, rol, email, primer_acceso_at FROM users WHERE id = 101;
