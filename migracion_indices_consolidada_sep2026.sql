-- ============================================================================
-- MIGRACIÓN CONSOLIDADA DE ÍNDICES (5 sept 2026)
-- ============================================================================
-- Contexto: el panel de Cloudflare D1 (Analíticas > Queries) que has
-- compartido HOY sigue mostrando exactamente los mismos síntomas que ya
-- se habían diagnosticado y "arreglado" en el código en dos migraciones
-- anteriores:
--
--   - migracion_optimizacion_lecturas_d1.sql  (2 sept 2026)
--   - migracion_indices_d1_consumo.sql        (2 sept 2026)
--
-- Ambas están en el repo y sus índices SÍ existen en schema.sql, pero los
-- números del panel (p.ej. "tipo, COUNT(*)... GROUP BY tipo" con ratio
-- 112 filas leídas por fila devuelta, o "articles WHERE resultado_id"
-- con ratio 23) son IDÉNTICOS a los que motivaron esas migraciones.
-- Eso es la huella de que los CREATE INDEX se escribieron pero nunca se
-- ejecutaron contra la base REMOTA (con wrangler d1 execute, sin --remote
-- solo tocan la réplica local de desarrollo).
--
-- Este fichero no inventa índices nuevos "por si acaso": es la UNIÓN de
-- los que ya se diseñaron en las dos migraciones anteriores (todas con
-- IF NOT EXISTS, así que si alguna ya se aplicó no pasa nada) más 3
-- añadidos genuinamente nuevos para los picos que aparecen en tu captura
-- de hoy y que aún no tenían índice dedicado (ver bloque final).
--
-- CÓMO EJECUTAR (IMPORTANTE, el --remote es lo que faltaba):
--   cd worker
--   wrangler d1 execute elotrofutbol --remote --file=migracion_indices_consolidada_sep2026.sql
--
-- Después, en el panel de Cloudflare D1 > Queries, los ratios de
-- "rows read / rows returned" de las queries de abajo deberían bajar a
-- 1-5 en la próxima hora de tráfico. Si NO bajan, es señal de que sigue
-- sin haberse aplicado en remoto (revisar que el nombre de la base sea
-- el correcto con "wrangler d1 list").
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOQUE A: re-aplicación segura (IF NOT EXISTS) de lo ya diseñado antes
-- ---------------------------------------------------------------------------

-- articles.resultado_id: crónica/ficha de un partido (ratio visto hoy: 23,
-- antes 1600k filas leídas / 9517 ejecuciones). La tabla más grande del
-- sitio, así que es el índice de mayor impacto en RAM/CPU de todo el lote.
CREATE INDEX IF NOT EXISTS idx_articles_resultado_id
  ON articles(resultado_id, publicado, fecha_publicacion DESC);

-- results.fecha_partido: listado de partidos ordenado (varias variantes de
-- "SELECT * FROM results ... ORDER BY fecha_partido DESC LIMIT n" en tu
-- captura de hoy, con hasta 426.5k filas leídas para pocas devueltas).
CREATE INDEX IF NOT EXISTS idx_results_fecha_partido
  ON results(fecha_partido DESC);

-- articles: contar publicaciones por autor/coautor (nivel de redactor).
-- Sigue apareciendo en tu captura con ratio 112 -> es la prueba más clara
-- de que este bloque no llegó a producción.
CREATE INDEX IF NOT EXISTS idx_articles_autor_publicado
  ON articles(autor_id, publicado);
CREATE INDEX IF NOT EXISTS idx_articles_coautor_publicado
  ON articles(coautor_id, publicado);

-- results.estado: usado por el cron cada minuto y por el panel en_juego.
CREATE INDEX IF NOT EXISTS idx_results_estado
  ON results(estado);

-- articles: cron de publicación programada (solo sobre no publicados,
-- índice parcial mucho más barato de mantener).
CREATE INDEX IF NOT EXISTS idx_articles_programado_para
  ON articles(programado_para) WHERE publicado = 0;

-- article_views / article_reading: compuestos (fecha, articulo) para que
-- el JOIN de analíticas por rango de fechas no escanee la tabla entera.
CREATE INDEX IF NOT EXISTS idx_article_views_created_article
  ON article_views(created_at, article_id);
CREATE INDEX IF NOT EXISTS idx_article_reading_created_article
  ON article_reading(created_at, article_id);

-- articles: listado de administración (incluye borradores) y sus filtros
-- más comunes combinados con el orden por fecha.
CREATE INDEX IF NOT EXISTS idx_articles_fecha_publicacion
  ON articles(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_categoria_fecha
  ON articles(categoria, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_club_fecha
  ON articles(club, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_tipo_fecha
  ON articles(tipo, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_autor_fecha
  ON articles(autor_id, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_articles_autor_nombre
  ON articles(autor_nombre);


-- ---------------------------------------------------------------------------
-- BLOQUE B: nuevos, para picos concretos de tu captura de HOY que aún no
-- tenían índice dedicado en ninguna migración anterior
-- ---------------------------------------------------------------------------

-- "SELECT id, fecha_partido FROM results WHERE estado = 'programado' AND
--  fecha_partido IS NOT NULL AND length(fecha_partido) = 16" (cron cada
-- minuto, iniciarPartidosProgramadosCuyaHoraHaLlegado): 303.66k filas
-- leídas / 1431 ejecuciones. length(...) es una función y SQLite no puede
-- indexarla directamente, pero un índice sobre "estado" ya reduce el
-- barrido a solo los partidos "programado" antes de evaluar length() fila
-- a fila; con solo unos pocos partidos programados a la vez frente a miles
-- de resultados totales, el ahorro es grande. Ya cubierto por
-- idx_results_estado del bloque A: no hace falta nada más aquí, se deja
-- la nota para que quede documentado por qué esa query concreta mejora.

-- "SELECT id, last_seen_at FROM sessions WHERE id = ? AND user_id = ? AND
--  revoked_at IS NULL" (verificación de sesión en CADA petición autenticada:
-- 7579 ejecuciones, 1.2 sec, ratio normal por id pero conviene el índice
-- compuesto para no depender solo del índice de user_id).
CREATE INDEX IF NOT EXISTS idx_sessions_id_user_revoked
  ON sessions(id, user_id, revoked_at);

-- "SELECT * FROM sessions ORDER BY id ASC LIMIT ?" (listado/paginación de
-- sesiones en el panel de administración): sin índice en id como clave de
-- orden explícita más allá de la PK implícita, D1 puede acabar leyendo la
-- tabla entera si hay borrados/huecos. Este índice es barato y cubre
-- también el "SELECT * FROM sessions;" plano.
CREATE INDEX IF NOT EXISTS idx_sessions_id
  ON sessions(id);

-- "SELECT * FROM users ORDER BY id ASC LIMIT ?" / "SELECT * FROM users;":
-- mismo motivo que sessions, tabla pequeña pero con 635-2092 ejecuciones
-- vistas hoy; el índice evita depender de que SQLite decida escanear en
-- orden de rowid por casualidad.
CREATE INDEX IF NOT EXISTS idx_users_id
  ON users(id);


-- ---------------------------------------------------------------------------
-- NOTA sobre queries de tu captura que NO llevan índice nuevo (a propósito)
-- ---------------------------------------------------------------------------
-- - "SELECT * FROM results WHERE id = ?" (19993 ejecuciones, ratio 1):
--   ya usa la clave primaria, ratio perfecto. Pesa por VOLUMEN de
--   llamadas (se llama en bucle en varios sitios), no por falta de
--   índice: no hay índice que arregle "se llama demasiadas veces", eso
--   es trabajo de código (cachear el resultado dentro de la misma
--   petición en vez de re-consultar).
-- - "SELECT * FROM results;" / "SELECT * FROM settings;" / "SELECT * FROM
--   users;" (sin WHERE ni LIMIT): ratio 1, son "traer todo" a propósito
--   (paneles de administración). Ningún índice reduce el coste de leer
--   una tabla entera cuando la query pide la tabla entera; si esto pesa
--   demasiado, la solución es paginar esas rutas, no indexarlas.
-- - "SELECT id FROM match_events;" / "SELECT id FROM articles;": mismo
--   caso, listar todos los ids es un escaneo completo por diseño.
-- ============================================================================
