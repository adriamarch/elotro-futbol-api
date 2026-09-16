-- Añade la columna que evita mandar el aviso de "partido desatendido"
-- una y otra vez cada minuto mientras nadie lo soluciona: una vez
-- enviado para un partido, se marca a 1 y no se vuelve a mandar hasta
-- que alguien retome el minuto a minuto (evento nuevo, pausa/reanudar,
-- ajuste de minuto...) o el partido se cierre.
ALTER TABLE results ADD COLUMN aviso_desatendido_enviado INTEGER NOT NULL DEFAULT 0;
