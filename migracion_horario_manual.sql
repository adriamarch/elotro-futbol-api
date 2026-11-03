-- Aplazados reprogramados a mano: el relleno automático (TheSportsDB) no los toca.
-- Ejecutar una vez:  wrangler d1 execute <BD> --remote --file=migracion_horario_manual.sql
ALTER TABLE results ADD COLUMN horario_manual INTEGER NOT NULL DEFAULT 0;

-- Protege ya los que estén aplazados ahora mismo.
UPDATE results SET horario_manual = 1 WHERE estado = 'retrasado';

-- Para proteger a mano un aplazado que ya reprogramaste (quedó en "programado"/"finalizado"):
--   UPDATE results SET horario_manual = 1 WHERE id IN (123, 456);
-- Para devolverlo al relleno automático:
--   UPDATE results SET horario_manual = 0 WHERE id = 123;
