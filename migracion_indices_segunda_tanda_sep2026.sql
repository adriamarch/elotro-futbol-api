-- ============================================================================
-- MIGRACIÓN — SEGUNDA TANDA DE ÍNDICES (5 sept 2026, parte 2)
-- ============================================================================
-- Tras revisar TODAS las queries del código (no solo las que salían en el
-- panel de hoy), estos son los huecos genuinos que quedaban sin índice.
-- No repite nada de:
--   - migracion_optimizacion_lecturas_d1.sql
--   - migracion_indices_d1_consumo.sql
--   - migracion_indices_consolidada_sep2026.sql
--
-- IMPORTANTE — por qué no hay más que esto:
-- Añadir un índice a una columna que YA usa su clave primaria o que YA
-- tiene un índice que la cubre no reduce "rows read": lo que hace es
-- gastar más RAM/CPU en cada escritura de esa tabla, porque SQLite tiene
-- que actualizar también el índice nuevo en cada INSERT/UPDATE. Tablas
-- como match_events, article_reading o results se escriben constantemente
-- (minuto a minuto, lecturas de artículos), así que indexar de más ahí
-- es contraproducente. Por eso este fichero solo añade las 6 columnas de
-- abajo, que sí aparecen en el código sin ningún índice que las cubra.
--
-- Ejecutar igual que las anteriores, contra REMOTO:
--   wrangler d1 execute elotrofutbol --remote --file=migracion_indices_segunda_tanda_sep2026.sql
-- ============================================================================

-- 1) Recuperación de contraseña de USUARIOS del panel (redactores/
--    administradores). "username" YA es UNIQUE en schema.sql (SQLite le
--    crea índice automático propio, así que NO se repite aquí -hacerlo
--    sería un índice duplicado, puro gasto de escritura sin beneficio).
--    Lo que sí faltaba es "reset_token", usado en cada intento de
--    restablecer contraseña y sin índice propio.
CREATE INDEX IF NOT EXISTS idx_users_reset_token
  ON users(reset_token) WHERE reset_token IS NOT NULL;

-- 2) Verificación de email y recuperación de contraseña de LECTORES
--    (público general, no del panel). "email" YA es UNIQUE en
--    schema.sql y además ya tiene idx_readers_email explícito -no se
--    repite-. Lo que faltaba es "verificacion_token" (confirmación de
--    cuenta) y "reset_token" (restablecer contraseña), sin índice.
CREATE INDEX IF NOT EXISTS idx_readers_verificacion_token
  ON readers(verificacion_token) WHERE verificacion_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readers_reset_token
  ON readers(reset_token) WHERE reset_token IS NOT NULL;

-- 3) match_events: durante un partido en vivo se consulta repetidamente
--    "WHERE resultado_id = ? AND tipo = 'inicio_partido'/'descanso'/
--    'fin_partido'/IN (...)" para saber si ya existe un evento de cierto
--    tipo antes de insertarlo. Solo había índice por resultado_id (no por
--    tipo), así que cada comprobación leía TODOS los eventos de ese
--    partido para filtrar tipo en memoria. Con muchos partidos en juego a
--    la vez y eventos por minuto, esto se nota.
CREATE INDEX IF NOT EXISTS idx_match_events_resultado_tipo
  ON match_events(resultado_id, tipo);

-- 4) reader_sessions: verificación de sesión de lector en cada petición
--    autenticada del público (equivalente a lo que ya se hizo para
--    sessions de usuarios del panel). Sin este índice compuesto, la
--    comprobación "id = ? AND reader_id = ? AND revoked_at IS NULL"
--    dependía solo del índice de reader_id.
CREATE INDEX IF NOT EXISTS idx_reader_sessions_id_reader_revoked
  ON reader_sessions(id, reader_id, revoked_at);

-- 5) poll_votes: comprobar si un lector ya votó una encuesta concreta
--    ("WHERE poll_id = ? AND reader_id = ?") se hace en cada intento de
--    voto, y solo había índices de poll_id y option_id por separado.
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_reader
  ON poll_votes(poll_id, reader_id);

-- 6) tienda_productos: catálogo de la tienda, "WHERE activo = 1 ORDER BY
--    orden ASC, id ASC" en cada carga de la tienda pública. Tabla
--    pequeña pero sin ningún índice propio hasta ahora.
CREATE INDEX IF NOT EXISTS idx_tienda_productos_activo_orden
  ON tienda_productos(activo, orden);
