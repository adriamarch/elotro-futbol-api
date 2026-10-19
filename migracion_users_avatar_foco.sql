-- Migración: guarda el encuadre ("foco") de la foto de perfil de redactores y
-- admins. Formato "X% Y%" (p. ej. "62% 30%"): el punto de la foto que no se
-- debe recortar nunca en el avatar redondo.
--
-- Hasta ahora el panel enviaba "avatar_foco" al guardar el perfil, pero NO
-- existía la columna ni el UPDATE la guardaba: el encuadre elegido se perdía
-- al recargar y los avatares públicos salían siempre centrados.
--
-- NULL = sin encuadre elegido (centro). El Worker sigue funcionando si esta
-- migración aún no se ha ejecutado (guarda el resto del perfil y deja el
-- avatar centrado).
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_users_avatar_foco.sql

ALTER TABLE users ADD COLUMN avatar_foco TEXT;
