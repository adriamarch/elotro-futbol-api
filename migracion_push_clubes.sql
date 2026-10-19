-- "Avisarme de mi equipo": push solo de los clubes que elija cada persona.
-- Ejecutar UNA vez sobre la D1 ya desplegada (antes de desplegar el worker):
--   npx wrangler d1 execute elotrofutbol --remote --file=migracion_push_clubes.sql
-- Si la base de datos es nueva, esto ya esta en schema.sql.
-- (SQLite no admite ADD COLUMN IF NOT EXISTS: si falla con "duplicate column
--  name: solo_clubes", la columna ya existia y se puede ignorar ese error.)
ALTER TABLE push_subscriptions ADD COLUMN solo_clubes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS push_subscription_clubs (
  subscription_id INTEGER NOT NULL,
  club TEXT NOT NULL,
  PRIMARY KEY (subscription_id, club)
);
CREATE INDEX IF NOT EXISTS idx_push_clubs_club ON push_subscription_clubs(club);
