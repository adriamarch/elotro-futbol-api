-- Añade la columna bajar_gol a match_events: solo se usa en eventos de
-- tipo "gol_var" (gol anulado por el VAR) para saber si ese gol anulado
-- ya se había sumado antes al marcador (y por tanto hay que restarlo) o
-- si se registra directamente sin haber llegado a sumar. El redactor lo
-- marca a mano con el checkbox "Bajar 1 gol al marcador" del panel de
-- Minuto a Minuto. Por defecto 0 (no resta), para no cambiar el
-- comportamiento de eventos ya existentes creados antes de esta
-- migración.
ALTER TABLE match_events ADD COLUMN bajar_gol INTEGER NOT NULL DEFAULT 0;
