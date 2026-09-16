-- Índices para reducir el consumo de "rows read" en D1, identificados
-- a partir del panel de queries de Cloudflare (2 sept 2026).
--
-- 1. articles WHERE resultado_id = ? ORDER BY fecha_publicacion DESC LIMIT 5
--    → 1.6M rows read / 9517 ejecuciones (la peor en volumen absoluto:
--    resultado_id no tenía ningún índice, así que cada llamada escaneaba
--    buena parte de la tabla articles, la más grande del sitio).
CREATE INDEX IF NOT EXISTS idx_articles_resultado_id ON articles(resultado_id, publicado, fecha_publicacion DESC);

-- 2. results WHERE 1=1 [filtros opcionales] ORDER BY fecha_partido DESC LIMIT n
--    → 840.83k rows read / 3 devueltas por ejecución (ratio ~280.000:1).
--    fecha_partido no tenía índice: SQLite escaneaba toda la tabla results
--    para poder ordenarla antes de aplicar el LIMIT.
CREATE INDEX IF NOT EXISTS idx_results_fecha_partido ON results(fecha_partido DESC);

-- 3. articles WHERE (autor_id = ? OR coautor_id = ?) AND publicado = 1
--    GROUP BY tipo (contarPublicacionesPorTipo, cálculo de nivel de redactor)
--    → 548.6k rows read / 2974 ejecuciones. El OR entre dos columnas
--    distintas no puede usar un único índice B-tree, así que escaneaba.
--    Se añaden dos índices — SQLite elegirá el que aplique a cada mitad
--    del OR (esto no colapsa el escaneo a coste cero, pero evita el full
--    table scan que había antes).
CREATE INDEX IF NOT EXISTS idx_articles_autor_publicado ON articles(autor_id, publicado);
CREATE INDEX IF NOT EXISTS idx_articles_coautor_publicado ON articles(coautor_id, publicado);

-- 4. /api/results: cron y páginas de resultado por estado (results.estado)
--    Aunque no aparece con volumen alto en el panel de esta captura, ya
--    se había detectado en la sesión anterior que el cron (cada minuto)
--    consulta por estado sin índice. Se incluye aquí por si esa migración
--    no llegó a aplicarse (no estaba en el zip revisado esta sesión).
CREATE INDEX IF NOT EXISTS idx_results_estado ON results(estado);

-- 5. Cron cada minuto: publicarArticulosProgramados hace
--    WHERE publicado = 0 AND programado_para <= datetime('now'). El índice
--    existente idx_articles_publicado es (publicado, fecha_publicacion), que
--    no cubre programado_para. Como casi todos los artículos tienen
--    publicado = 1, este índice parcial (solo sobre los no publicados) es
--    mucho más barato de mantener y de usar para este filtro concreto.
CREATE INDEX IF NOT EXISTS idx_articles_programado_para ON articles(programado_para) WHERE publicado = 0;
