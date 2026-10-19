-- Mejoras de la tienda del panel: stock por producto y galería de imágenes.
--
--   stock    -> total de unidades del producto. NULL = sin límite (como hasta
--               ahora). Las unidades disponibles se calculan restando los
--               pedidos no cancelados, así que cancelar o borrar un pedido
--               devuelve la unidad automáticamente.
--   imagenes -> array JSON de URLs extra para la galería de la ficha
--               ('["https://...","https://..."]'). La imagen principal sigue
--               siendo imagen_url.
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_tienda_mejoras.sql
--
-- Si `--file` falla con "fetch failed" (la subida del fichero a la URL firmada de D1
-- no sale por tu red) o ya aplicaste parte y da "duplicate column name", usa el script
-- idempotente, que va sentencia a sentencia y reintenta:
--   cd worker && npm run migrar:tienda
ALTER TABLE tienda_productos ADD COLUMN stock INTEGER;
ALTER TABLE tienda_productos ADD COLUMN imagenes TEXT;
