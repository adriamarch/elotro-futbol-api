-- Limpieza: las noticias ya publicadas no deben conservar etiqueta de carrusel/individual.
UPDATE articles SET redes_destino = NULL WHERE publicado = 1 AND redes_destino IS NOT NULL;
