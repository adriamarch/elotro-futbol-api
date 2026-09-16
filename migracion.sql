-- Migración: traduce columnas y valores de catalán a castellano
-- SOLO ejecutar si la base de datos YA tenía datos (con schema.sql antiguo).
-- Si es una base de datos nueva, ignora este archivo y usa schema.sql directamente.

-- ---------- users ----------
ALTER TABLE users RENAME COLUMN nom TO nombre;
ALTER TABLE users RENAME COLUMN actiu TO activo;

-- ---------- articles ----------
ALTER TABLE articles RENAME COLUMN titol TO titulo;
ALTER TABLE articles RENAME COLUMN subtitol TO subtitulo;
ALTER TABLE articles RENAME COLUMN contingut TO contenido;
ALTER TABLE articles RENAME COLUMN tipus TO tipo;
ALTER TABLE articles RENAME COLUMN imatge_url TO imagen_url;
ALTER TABLE articles RENAME COLUMN autor_nom TO autor_nombre;
ALTER TABLE articles RENAME COLUMN destacat TO destacado;
ALTER TABLE articles RENAME COLUMN publicat TO publicado;
ALTER TABLE articles RENAME COLUMN data_publicacio TO fecha_publicacion;

UPDATE articles SET categoria = 'primera_federacion' WHERE categoria = 'primera_federacio';
UPDATE articles SET categoria = 'segunda_federacion' WHERE categoria = 'segona_federacio';
UPDATE articles SET tipo = 'opinion' WHERE tipo = 'opinio';

-- ---------- results ----------
ALTER TABLE results RENAME COLUMN competicio TO competicion;
ALTER TABLE results RENAME COLUMN grup TO grupo;
ALTER TABLE results RENAME COLUMN equip_local TO equipo_local;
ALTER TABLE results RENAME COLUMN equip_visitant TO equipo_visitante;
ALTER TABLE results RENAME COLUMN gols_local TO goles_local;
ALTER TABLE results RENAME COLUMN gols_visitant TO goles_visitante;
ALTER TABLE results RENAME COLUMN data_partit TO fecha_partido;
ALTER TABLE results RENAME COLUMN estat TO estado;

UPDATE results SET competicion = 'primera_federacion' WHERE competicion = 'primera_federacio';
UPDATE results SET competicion = 'segunda_federacion' WHERE competicion = 'segona_federacio';
UPDATE results SET estado = 'programado' WHERE estado = 'programat';
UPDATE results SET estado = 'en_juego' WHERE estado = 'en_joc';
UPDATE results SET estado = 'finalizado' WHERE estado = 'finalitzat';
