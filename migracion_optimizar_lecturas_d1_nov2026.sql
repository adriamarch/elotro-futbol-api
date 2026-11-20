-- Optimización de lecturas de D1 (nov-2026).
-- Índices que permiten resolver MAX()/COUNT() con una búsqueda en el índice en vez de recorrer filas.
-- Solo crea índices (IF NOT EXISTS): no cambia ni borra datos. Aplicar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_optimizar_lecturas_d1_nov2026.sql

-- Último acceso de cada colaborador (MAX(created_at) de 'login') y primer evento por partido
-- (haCubiertoPartidoEnDirecto): antes recorrían todo el historial del usuario en activity_log.
CREATE INDEX IF NOT EXISTS idx_activity_usuario_accion_fecha ON activity_log(usuario_id, accion, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_usuario_accion_entidad ON activity_log(usuario_id, accion, entidad_id, created_at);

-- Noticias publicadas por autor (total, últimos 2 meses y última): índice que cubre la consulta entera.
CREATE INDEX IF NOT EXISTS idx_articles_autor_pub_fecha ON articles(autor_id, publicado, fecha_publicacion);
