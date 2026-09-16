-- Migración: foto de perfil para cuentas de lectores.
--
-- Mismo campo que "avatar_url" en redactores (users), pero aquí no se
-- replica "avatar_foco": esa columna no existe en ninguna tabla del
-- proyecto (en redactores solo se lee, nunca se guarda), así que no hay
-- nada real que clonar para lectores.

ALTER TABLE readers ADD COLUMN avatar_url TEXT;
