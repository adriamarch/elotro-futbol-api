-- Migración: el PIN de "Última hora" deja de ser uno por redactor
-- (asignado a mano, uno por uno, por un admin) y pasa a ser un único
-- PIN aleatorio de 4 dígitos, compartido por todos los redactores,
-- visible solo para admins desde el panel, y que se regenera solo
-- cada vez que se usa para publicar.

-- Quita las columnas del PIN antiguo por usuario (ya no se usan).
ALTER TABLE users DROP COLUMN ultima_hora_hash;
ALTER TABLE users DROP COLUMN ultima_hora_salt;

-- Crea el PIN global si no existía ya (arranca en un valor de relleno;
-- se regenerará solo al arrancar el worker o la primera vez que se pida).
INSERT OR IGNORE INTO settings (key, value) VALUES ('ultima_hora_pin', '0000');
