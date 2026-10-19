-- Tiempo añadido ANUNCIADO en directo (panel de Minuto a Minuto).
--
-- Hasta ahora el añadido solo se preguntaba al pitar el descanso / el final,
-- así que la gente no lo veía mientras se jugaba. Con estas dos columnas el
-- redactor puede anunciarlo en cuanto el árbitro lo indica; la web pública lo
-- enseña ("+3") y el cron para el reloj solo al terminar ese añadido
-- (descanso al 45+N, final al 90+N).
--
--   anadido_minutos: minutos de añadido anunciados (NULL = nada anunciado).
--   anadido_parte:   1 = añadido de la 1ª parte, 2 = añadido de la 2ª.
--
-- Solo hay un añadido activo a la vez: se borra al empezar la 2ª parte y al
-- (re)arrancar el partido desde 0.
--
--   wrangler d1 execute elotrofutbol --remote --file=migracion_anadido_anunciado.sql
ALTER TABLE results ADD COLUMN anadido_minutos INTEGER;
ALTER TABLE results ADD COLUMN anadido_parte INTEGER;
