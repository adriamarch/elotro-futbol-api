-- Repara el "bug 12": crónicas/previas que no salen en la página de
-- NINGUNO de los dos equipos del partido.
--
-- Causa: desde que existe resolverClubArticulo() (ver worker/src/
-- index.js), el campo "club" de una previa/crónica se recalcula SIEMPRE
-- a partir de los dos equipos del resultado vinculado, guardándose como
-- el array JSON '["Equipo local","Equipo visitante"]'. Los endpoints
-- de listado (/api/articles?club=...) buscan tanto ese club como
-- clave única (club = ?) como dentro del array JSON (club LIKE
-- '%"Equipo"%').
--
-- Pero esa lógica solo se aplica al CREAR o EDITAR el artículo desde el
-- panel. Cualquier crónica/previa que ya existiera en la base de datos
-- de antes de este cambio (o cuyo "club" se quedara desactualizado por
-- algún bug ya corregido) se quedó con el valor viejo en "club" -un
-- solo nombre, vacío, o un JSON con nombres distintos a los del
-- resultado actual-, así que al filtrar por CUALQUIERA de los dos
-- equipos reales del partido no aparece: no coincide ni como valor
-- exacto ni como elemento del array JSON.
--
-- Esta migración recalcula "club" (y de paso "categoria", que también
-- se deriva siempre del resultado) para TODAS las previas/crónicas que
-- tengan un resultado_id válido, dejándolas con el mismo valor que
-- generaría hoy resolverClubArticulo() para ese resultado. Es idempotente:
-- se puede ejecutar varias veces sin cambiar nada si ya está todo bien.

UPDATE articles
SET
  club = (
    SELECT '["' || REPLACE(r.equipo_local, '"', '\"') || '","' || REPLACE(r.equipo_visitante, '"', '\"') || '"]'
    FROM results r
    WHERE r.id = articles.resultado_id
  ),
  categoria = (
    SELECT r.competicion
    FROM results r
    WHERE r.id = articles.resultado_id
  ),
  updated_at = datetime('now')
WHERE tipo IN ('previa', 'cronica')
  AND resultado_id IS NOT NULL
  AND resultado_id IN (
    SELECT id FROM results WHERE equipo_local IS NOT NULL AND equipo_visitante IS NOT NULL AND competicion IS NOT NULL
  )
  AND (
    -- Solo toca las filas que de verdad estén mal (no coinciden ya con
    -- lo que generaría resolverClubArticulo para su resultado), para no
    -- pisar fecha de updated_at de artículos que ya estaban correctos.
    club IS NOT (
      SELECT '["' || REPLACE(r.equipo_local, '"', '\"') || '","' || REPLACE(r.equipo_visitante, '"', '\"') || '"]'
      FROM results r WHERE r.id = articles.resultado_id
    )
    OR categoria IS NOT (
      SELECT r.competicion FROM results r WHERE r.id = articles.resultado_id
    )
  );

-- Después de ejecutar esto, comprueba cuántas filas quedaron sin poder
-- repararse (previas/crónicas con resultado_id que ya no existe, o que
-- apunta a un resultado sin ambos equipos/competición definidos):
--
-- SELECT id, slug, titulo, tipo, resultado_id, club, categoria
-- FROM articles
-- WHERE tipo IN ('previa', 'cronica')
--   AND (
--     resultado_id IS NULL
--     OR resultado_id NOT IN (
--       SELECT id FROM results WHERE equipo_local IS NOT NULL AND equipo_visitante IS NOT NULL AND competicion IS NOT NULL
--     )
--   );
--
-- Esas hay que revisarlas a mano desde el panel (reasignar el resultado
-- vinculado, o completar el resultado si le faltan datos).
