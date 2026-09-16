-- Migración: corrige "lectores recurrentes" en el panel de analíticas.
--
-- Bug: visitante_hash (ver hashVisitante() en src/index.js) incluye el
-- día en su cálculo a propósito, para deduplicar recargas de la misma
-- persona el mismo día sin inflar "visitas únicas". Pero eso significa
-- que un mismo visitante genera un hash DISTINTO cada día -- así que
-- agrupar por visitante_hash y contar días distintos (como hacía
-- calcularRecurrenciaAnaliticas) nunca podía dar más de 1 día por hash.
-- "Recurrentes" salía a 0 siempre, no por un fallo de query sino porque
-- la columna usada no puede, por diseño, servir para medir esto.
--
-- Fix: se añade visitante_estable, un hash de IP+User-Agent SIN el día
-- (con salt de JWT_SECRET, igual que visitante_hash, para que tampoco
-- sea reversible). Se usa solo para saber si la misma persona ha vuelto
-- en más de un día distinto dentro del rango; nunca para identificarla.
-- visitante_hash se mantiene tal cual para todo lo demás (visitas
-- únicas por artículo, fuentes, etc.), no se toca su comportamiento.

ALTER TABLE article_views ADD COLUMN visitante_estable TEXT;
CREATE INDEX IF NOT EXISTS idx_article_views_visitante_estable ON article_views(visitante_estable, created_at);
