-- Formulario de incorporación: las listas "Selecciona tu nombre" (redactor y fotógrafo)
-- pasan a salir de los usuarios de la web en vez de una lista fija.
--
--   nombre_red  -> usuarios activos con rol redactor
--   nombre_fot  -> usuarios activos con rol fotógrafo
--
-- Solo añade la propiedad "fuente" a esos dos campos (el resto del formulario y las
-- respuestas ya guardadas no se tocan). La lista fija antigua deja de usarse.
-- Se puede ejecutar más de una vez sin problema.
--
-- Aplicar en D1 con:
--   wrangler d1 execute elotrofutbol --remote --file=./formulario_incorporacion_nombres_desde_usuarios.sql
UPDATE formularios SET
  campos = (
    SELECT json_group_array(json(
      CASE json_extract(value, '$.id')
        WHEN 'nombre_red' THEN json_set(value, '$.fuente', 'usuarios_redactor', '$.opciones', json('[]'))
        WHEN 'nombre_fot' THEN json_set(value, '$.fuente', 'usuarios_fotografo', '$.opciones', json('[]'))
        ELSE value
      END))
    FROM (SELECT key, value FROM json_each(formularios.campos) ORDER BY key)
  ),
  updated_at = datetime('now')
WHERE slug = 'formulario-de-incorporacion-elotrofutbol';
