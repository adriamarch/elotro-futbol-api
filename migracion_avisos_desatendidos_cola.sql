-- Cola de avisos de "partido posiblemente sin cubrir" pendientes de
-- enviarse en UN solo email resumen (ver revisarPartidosDesatendidos y
-- enviarDigestAvisosDesatendidos en src/index.js).
--
-- POR QUÉ EXISTE: el plan gratuito de Resend limita a 100 emails/día.
-- Antes se mandaba un correo por partido y mitad (redactor + copia a
-- admin), y como el cron corre en los DOS backends (D1 y Postgres), con
-- ~15 partidos sin cubrir se agotaba el cupo y dejaba sin correo al
-- resto de notificaciones (recuperar contraseña, comentarios, boletín).
-- Ahora cada partido desatendido solo se APUNTA aquí, y se manda un
-- único email cuando hay AVISOS_DESATENDIDOS_LOTE (20) partidos, o
-- cuando el aviso más antiguo lleva AVISOS_DESATENDIDOS_ESPERA_MAX_MIN
-- (30) minutos esperando.
--
-- POR QUÉ UNA TABLA PROPIA Y NO `settings`: `settings` está en el
-- sincronizador D1 -> PostgreSQL como tabla "authoritative" con
-- deleteDetection, es decir, cada pasada (cada 60 s) BORRA en PostgreSQL
-- cualquier fila que no exista en D1. Una cola guardada allí se
-- perdería en Railway cada minuto. Esta tabla NO debe añadirse a
-- worker-secondary/sync/tables.mjs: cada backend lleva su propia cola,
-- igual que ya llevan cada uno su propio cron.
--
-- Una fila por partido (resultado_id es la PK): si el mismo partido
-- vuelve a quedarse desatendido en la otra mitad antes de enviarse el
-- lote, se sustituye su fila en lugar de duplicarla.
--
-- encolado_ms guarda el instante en milisegundos desde epoch (INTEGER),
-- calculado en el código, en vez de una fecha en texto: así la antigüedad
-- del aviso se compara igual en D1 (SQLite) y en Postgres sin depender
-- del formato de fecha de cada motor.
--
-- Ejemplo de ejecución con wrangler:
--   wrangler d1 execute elotrofutbol --remote --file=./migracion_avisos_desatendidos_cola.sql
CREATE TABLE IF NOT EXISTS avisos_desatendidos_cola (
  resultado_id INTEGER PRIMARY KEY,
  partido TEXT NOT NULL,
  jornada INTEGER,
  redactor TEXT,
  motivo_corto TEXT NOT NULL,
  encolado_ms INTEGER NOT NULL
);
