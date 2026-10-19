-- Formulario de incorporación: al enviarlo se crea el usuario (usuario y contraseña) de quien
-- elige su nombre en la lista, con su rol y su(s) equipo(s).
--
--   nombre_red -> se crea un usuario con rol redactor
--   nombre_fot -> se crea un usuario con rol fotógrafo
--
-- Además enlaza a mano las personas que YA tienen usuario con otro nombre, para que no se les
-- cree uno duplicado (y para que al eliminar su usuario se borre su respuesta):
--   "TodosADCeuta — AD Ceuta"  -> ismael_adc
--   "Juanma — Jurisprudencia"  -> juanma
--
-- Solo añade las marcas "alta_usuario" y "alias_usuarios" a esos campos; las listas de nombres,
-- el resto del formulario y las respuestas ya guardadas no se tocan. Se puede ejecutar más de
-- una vez (los alias se van sumando, no se pisan).
--
-- Aplicar en D1 con:
--   wrangler d1 execute elotrofutbol --remote --file=./formulario_incorporacion_alta_usuarios.sql
UPDATE formularios SET
  campos = (
    SELECT json_group_array(json(
      CASE json_extract(value, '$.id')
        WHEN 'nombre_red' THEN json_set(value,
          '$.alta_usuario', 'redactor',
          '$.alias_usuarios', json_patch(
            COALESCE(json_extract(value, '$.alias_usuarios'), '{}'),
            '{"TodosADCeuta — AD Ceuta":"ismael_adc","Juanma — Jurisprudencia":"juanma"}'))
        WHEN 'nombre_fot' THEN json_set(value, '$.alta_usuario', 'fotografo')
        ELSE value
      END))
    FROM (SELECT key, value FROM json_each(formularios.campos) ORDER BY key)
  ),
  updated_at = datetime('now')
WHERE slug = 'formulario-de-incorporacion-elotrofutbol';
