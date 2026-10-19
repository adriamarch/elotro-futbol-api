-- Votaciones internas OBLIGATORIAS.
--
-- Un admin puede marcar una votación como "obligatoria" al crearla. Mientras
-- esté abierta (ni cerrada a mano ni pasada su fecha límite), cada
-- colaborador que aún no haya votado ve al abrir el panel una pantalla que
-- tapa todo y no puede hacer nada más hasta votar (ver
-- public/admin/js/votaciones.js, bloque "Votaciones obligatorias").
--
--   obligatoria -> 0 = normal (se vota desde la pestaña "Votaciones"),
--                  1 = bloquea el panel hasta votar.
--
-- Ejecutar UNA sola vez (SQLite no admite ADD COLUMN IF NOT EXISTS) y ANTES
-- de desplegar el worker nuevo, porque las consultas ya leen esta columna:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_votaciones_obligatorias.sql

ALTER TABLE votaciones_internas ADD COLUMN obligatoria INTEGER NOT NULL DEFAULT 0;
