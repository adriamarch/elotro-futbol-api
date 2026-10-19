-- Tienda: número de pedido, método de pago guardado y forma de entrega.
--
--   codigo          -> número de pedido (EOF-0042), el mismo para todas las
--                      unidades de una misma compra. Es el concepto que se pone
--                      en el Bizum/PayPal.
--   metodo_pago     -> 'bizum' | 'paypal' (antes solo iba como prefijo de la
--                      referencia).
--   entrega         -> 'mano' | 'envio' (NULL = pedido anterior, a coordinar).
--   direccion_envio -> dirección y teléfono cuando entrega = 'envio'.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_tienda_pedido_codigo.sql
--
-- Si `--file` falla con "fetch failed" (la subida del fichero a la URL firmada de D1
-- no sale por tu red) o ya aplicaste parte y da "duplicate column name", usa el script
-- idempotente, que va sentencia a sentencia y reintenta:
--   cd worker && npm run migrar:tienda
ALTER TABLE tienda_pedidos ADD COLUMN codigo TEXT;
ALTER TABLE tienda_pedidos ADD COLUMN metodo_pago TEXT;
ALTER TABLE tienda_pedidos ADD COLUMN entrega TEXT;
ALTER TABLE tienda_pedidos ADD COLUMN direccion_envio TEXT;

-- Pedidos anteriores: cada fila recibe su propio número y el método se
-- recupera del prefijo "[Bizum]" / "[PayPal]" de la referencia.
UPDATE tienda_pedidos SET codigo = 'EOF-' || printf('%04d', id) WHERE codigo IS NULL;
UPDATE tienda_pedidos SET metodo_pago = 'paypal' WHERE metodo_pago IS NULL AND referencia_pago LIKE '[PayPal]%';
UPDATE tienda_pedidos SET metodo_pago = 'bizum' WHERE metodo_pago IS NULL AND referencia_pago LIKE '[Bizum]%';

CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_codigo ON tienda_pedidos(codigo);
