-- Migración: sistema de niveles y recompensas para colaboradores
--
-- Resume el modelo de negocio (ver documento "Sistema de niveles y
-- recompensas"):
--  1) Cada colaborador tiene un nivel (1-4) que determina qué puede
--     hacer: desde 1 (todo su contenido se revisa antes de publicar)
--     hasta 4 (revisa a otros, puede optar a redes sociales, consejo
--     de administración, coordinaciones...).
--  2) El nivel NO sube solo; los admins evalúan la trayectoria de la
--     persona una vez cumple las cifras mínimas. Por eso se guarda
--     quién lo cambió, cuándo y por qué (nivel_historial), igual que
--     ya se hace con la actividad general en activity_log.
--  3) Las cifras que hacen falta para cada nivel (30 noticias, 15
--     crónicas... para Nivel 2, etc.) NO se guardan en la base de
--     datos: se calculan siempre contando articles.tipo/autor_id, así
--     que si el número de noticias publicadas cambia (se borra una,
--     se reasigna el autor...) el progreso se recalcula solo y nunca
--     queda desincronizado.

-- 1) Nivel actual del colaborador. Empieza en 1 (Principiante) para
--    todos los usuarios existentes y los que se creen a partir de
--    ahora. Los admins no tienen "nivel" a efectos de restricciones
--    (siempre publican directamente, revisan todo, etc.), pero se les
--    deja igualmente en 1 por defecto para no complicar la columna con
--    NULLs; la lógica de permisos en el Worker sigue mirando primero
--    el rol antes que el nivel.
ALTER TABLE users ADD COLUMN nivel INTEGER NOT NULL DEFAULT 1;

-- 2) Nota opcional que puede dejar un admin sobre el nivel actual de
--    una persona (p. ej. por qué se le ha subido o bajado, o por qué
--    todavía no se le sube aunque cumpla las cifras). Se muestra en
--    "Mi progreso" y en el panel de Usuarios.
ALTER TABLE users ADD COLUMN nivel_nota TEXT;

-- 3) Historial de cambios de nivel (ascensos y descensos), para poder
--    ver la trayectoria completa de un colaborador y quién decidió
--    cada cambio. Igual que edit_requests/activity_log, referencia a
--    users pero guarda también el nombre por si el usuario se borra
--    más adelante.
CREATE TABLE IF NOT EXISTS nivel_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  usuario_nombre TEXT NOT NULL,
  nivel_anterior INTEGER NOT NULL,
  nivel_nuevo INTEGER NOT NULL,
  motivo TEXT,                        -- nota del admin al hacer el cambio
  cambiado_por_id INTEGER,
  cambiado_por_nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES users(id),
  FOREIGN KEY (cambiado_por_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_nivel_historial_usuario ON nivel_historial(usuario_id);
