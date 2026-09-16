-- ============================================================
-- Cambiar el nombre público de las cuentas de Aimar y Ekaitz a
-- "TxuriBeltz Maitea" (las dos comparten literalmente el mismo
-- nombre público, a partir de ahora y también en lo ya publicado).
-- ============================================================
-- CÓMO USARLO
--  1) Sustituye 'aimar' y 'ekaitz' de la primera consulta por los
--     valores REALES de la columna username de esos dos usuarios
--     (o de "nombre" si prefieres localizarlos así -- ver la
--     consulta de comprobación al final del todo).
--  2) Ejecuta este archivo contra la base de datos que corresponda:
--       - D1 (worker principal):      wrangler d1 execute <NOMBRE_DB> --file=renombrar_txuribeltz_maitea.sql
--       - Postgres (worker-secondary): psql "$DATABASE_URL" -f renombrar_txuribeltz_maitea.sql
--     Los dos usan sintaxis SQL estándar, este script no usa nada
--     específico de un motor u otro.
--  3) Recuerda ejecutarlo en AMBAS bases (D1 y Postgres/Railway) para
--     que el cambio también se refleje si el sitio conmuta a
--     Railway durante un failover; sync/incremental.mjs replica la
--     tabla "users" de D1 -> Postgres, pero solo de los cambios que
--     pasen por el propio D1: ejecutar esto solo en D1 y esperar a
--     que el sync lo replique también vale, pero es más lento y
--     depende de que el sync esté corriendo en ese momento.
--
-- IMPORTANTE: esto NO cambia username, contraseña, email ni el rol
-- de las cuentas -- solo el nombre que ven los lectores (columna
-- "nombre" en "users" y las columnas "autor_nombre"/"coautor_nombre"
-- ya guardadas en el resto de tablas). Ambas cuentas siguen siendo
-- independientes para iniciar sesión, permisos, etc.


-- 1) El nombre público de la cuenta en sí (perfil de autor, firma de
--    noticias nuevas a partir de ahora, desplegable de autor, etc.)
UPDATE users
SET nombre = 'TxuriBeltz Maitea'
WHERE username IN ('aimar', 'ekaitz');

-- 2) Histórico ya publicado: se actualiza por autor_id (no por texto
--    de nombre), así no hace falta saber cómo estaba escrito antes
--    ("Aimar", "aimar", "Aimar Etxeberria"...) y no hay riesgo de
--    tocar a nadie más por coincidencia de nombre.

-- Noticias/crónicas (autor principal)
UPDATE articles
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Noticias/crónicas (coautor, cuando uno de los dos firma como
-- segundo nombre de una noticia de otro redactor)
UPDATE articles
SET coautor_nombre = 'TxuriBeltz Maitea'
WHERE coautor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Partidos/resultados (el redactor asignado a cubrir el partido)
UPDATE results
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Fotos/vídeos subidos a la mediateca
UPDATE media
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Clubes personalizados que hayan creado
UPDATE custom_clubs
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Alineaciones que hayan publicado
UPDATE alineaciones
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Fichas de club que hayan editado
UPDATE club_info
SET autor_nombre = 'TxuriBeltz Maitea'
WHERE autor_id IN (SELECT id FROM users WHERE username IN ('aimar', 'ekaitz'));

-- Nota: "edit_requests" y "polls" también tienen autor_id, pero son
-- datos internos del panel (solicitudes de permiso, encuestas), no
-- una firma que vea el lector, así que no hace falta tocarlos aquí.
-- Si en algún momento se muestra públicamente el autor de una
-- encuesta, el mismo patrón de arriba (UPDATE ... WHERE autor_id IN
-- (SELECT id FROM users WHERE username IN ('aimar','ekaitz'))) vale
-- igual.


-- ------------------------------------------------------------
-- Comprobación posterior (ejecutar aparte, no como parte del cambio):
--
-- SELECT username, nombre FROM users WHERE username IN ('aimar','ekaitz');
--
-- SELECT 'articles' AS tabla, COUNT(*) FROM articles WHERE autor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'articles_coautor', COUNT(*) FROM articles WHERE coautor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'results', COUNT(*) FROM results WHERE autor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'media', COUNT(*) FROM media WHERE autor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'custom_clubs', COUNT(*) FROM custom_clubs WHERE autor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'alineaciones', COUNT(*) FROM alineaciones WHERE autor_nombre = 'TxuriBeltz Maitea'
-- UNION ALL SELECT 'club_info', COUNT(*) FROM club_info WHERE autor_nombre = 'TxuriBeltz Maitea';
-- ------------------------------------------------------------
