-- Colaborador anónimo: lo que publica esa persona se muestra sin su nombre (ver anonimizarRespuesta).
-- El worker también la crea sola al activar la opción; este archivo es por si prefieres aplicarla a mano.
ALTER TABLE users ADD COLUMN anonimo INTEGER NOT NULL DEFAULT 0;
