-- ============================================================
-- Mapa de desplazamientos — rankings (más estadios / más km)
-- ============================================================
-- Guarda en la propia fila del lector los dos totales que calcula el servidor al guardar
-- (ver src/mapa-estadios-catalogo.js): n_estadios (sin contar su estadio) y km (ida y vuelta).
-- Las filas antiguas se quedan en NULL y el endpoint del ranking las rellena solo la primera vez.
-- Se aplica UNA vez con:  wrangler d1 execute <BD> --remote --file=migracion_mapa_ranking.sql
ALTER TABLE reader_mapa_desplazamientos ADD COLUMN n_estadios INTEGER;
ALTER TABLE reader_mapa_desplazamientos ADD COLUMN km INTEGER;
CREATE INDEX IF NOT EXISTS idx_mapa_desp_n ON reader_mapa_desplazamientos(n_estadios);
CREATE INDEX IF NOT EXISTS idx_mapa_desp_km ON reader_mapa_desplazamientos(km);
