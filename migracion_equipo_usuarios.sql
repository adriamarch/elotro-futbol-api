-- Migración: añade a "users" el equipo/club del redactor o admin (el
-- club de fútbol al que sigue o cubre habitualmente). Se muestra en su
-- perfil público (autor.html), en el desplegable de autor al firmar una
-- noticia ("Nombre — Equipo") y en la gestión de usuarios del panel
-- (tanto al crear un usuario nuevo como en la tabla de usuarios ya
-- registrados). Cada persona puede editar el suyo desde "Mis datos"; un
-- admin puede asignárselo o cambiárselo a cualquiera desde "Usuarios".
--
-- Ejecutar SOLO si la base de datos ya existía antes de este cambio
-- (si es una base de datos nueva, usa schema.sql directamente, que ya
-- incluye esta columna).
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_equipo_usuarios.sql

ALTER TABLE users ADD COLUMN equipo TEXT;
