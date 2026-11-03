-- Primer acceso de los usuarios (D1).
-- Antes "Sin primer acceso" = el usuario no tenía correo. Ahora el correo se
-- guarda al crear la cuenta, así que el primer inicio de sesión tiene su
-- propia columna: NULL = nunca ha iniciado sesión.
--
-- OJO: el worker también la crea solo (migración automática en
-- asegurarColumnaPrimerAcceso), así que si ya ha entrado alguien con el worker
-- nuevo desplegado, el ALTER dará "duplicate column name": es inofensivo,
-- ejecuta solo el UPDATE de abajo.
ALTER TABLE users ADD COLUMN primer_acceso_at TEXT;

-- Quien ya tenga alguna sesión registrada ya había entrado: primer acceso = su
-- sesión más antigua.
UPDATE users
SET primer_acceso_at = (SELECT MIN(s.created_at) FROM sessions s WHERE s.user_id = users.id)
WHERE primer_acceso_at IS NULL;
