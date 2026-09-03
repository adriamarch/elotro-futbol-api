-- Tienda de acreditación para redactores: catálogo fijo de 4-5 productos
-- (gorra, camiseta, micro personalizado...) que un redactor puede pedir
-- para ir acreditado al campo con la imagen de ElOtroFutbol. Pago manual
-- por Bizum: no hay pasarela de pago integrada (no somos una empresa),
-- así que el flujo es "el redactor pide y dice que ha pagado" -> "un
-- admin o un redactor con permiso de gestión de tienda lo confirma".
--
-- Ejecutar con:
--   wrangler d1 execute elotrofutbol --remote --file=worker/migracion_tienda.sql

-- Catálogo. Se gestiona a mano (no hay pantalla de "crear producto" en
-- el panel, de momento): para añadir/editar un producto se hace un
-- INSERT/UPDATE directo aquí o por wrangler d1 execute. Son solo 4-5
-- productos fijos, no hace falta un CRUD completo para esto todavía.
CREATE TABLE IF NOT EXISTS tienda_productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  -- Precio en céntimos de euro (evita problemas de redondeo de floats).
  -- 500 = 5,00 €.
  precio_centimos INTEGER NOT NULL,
  imagen_url TEXT,
  -- Variantes disponibles (p.ej. tallas de camiseta), como array JSON de
  -- strings: '["S","M","L","XL"]'. NULL o '[]' si el producto no tiene
  -- variantes (p.ej. el micrófono personalizado, talla única).
  variantes TEXT,
  -- Marca de cara al futuro: cuando se active el requisito de ir
  -- acreditado con material de ElOtroFutbol, esta columna dirá qué
  -- productos cuentan para ello. De momento se deja en 0 para todos:
  -- no se exige nada todavía, solo se prepara el campo.
  requiere_para_acreditacion INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pedidos. Cada fila es UNA unidad de UN producto (con su variante
-- elegida); si alguien pide 3 cosas a la vez, son 3 filas. Así el
-- listado de pedidos a gestionar es más simple: se marca cada línea por
-- separado según vaya llegando el Bizum o se vaya entregando en mano.
CREATE TABLE IF NOT EXISTS tienda_pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  producto_id INTEGER NOT NULL,
  -- Copiados en el momento del pedido (nombre/precio/variante), para que
  -- el pedido conserve lo que se pidió y pagó aunque luego el catálogo
  -- cambie de precio o el producto se desactive.
  producto_nombre TEXT NOT NULL,
  variante TEXT,
  precio_centimos INTEGER NOT NULL,
  -- pendiente_pago: recién creado, el redactor dice que va a pagar/ha
  --   pagado por Bizum pero todavía no se ha confirmado desde el panel.
  -- pagado: un admin o gestor de tienda ha confirmado que el Bizum ha
  --   llegado.
  -- enviado: ya se le ha hecho llegar (entregado en mano, enviado...).
  -- cancelado: pedido anulado (no llegó el pago, se equivocó, etc.).
  estado TEXT NOT NULL DEFAULT 'pendiente_pago',
  -- Lo que el propio redactor escribe al pedir: normalmente el concepto
  -- o referencia que ha puesto en el Bizum, para que quien confirme el
  -- pago pueda localizarlo fácilmente en el móvil.
  referencia_pago TEXT,
  -- Nota interna de quien gestiona el pedido (admin/gestor), no visible
  -- para el redactor que lo pidió más que como parte del estado.
  nota_gestion TEXT,
  gestionado_por INTEGER,
  gestionado_en TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES users(id),
  FOREIGN KEY (producto_id) REFERENCES tienda_productos(id),
  FOREIGN KEY (gestionado_por) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_usuario ON tienda_pedidos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_estado ON tienda_pedidos(estado);

-- Permiso para gestionar la tienda (ver y confirmar pedidos de todo el
-- mundo) sin tener que ser admin: así se puede dar acceso a un redactor
-- de confianza concreto. Los admin siempre pueden gestionar la tienda,
-- tengan o no esta columna a 1 (se comprueba en el backend con
-- "rol === 'admin' || puede_gestionar_tienda === 1").
ALTER TABLE users ADD COLUMN puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- Seed: catálogo inicial de 4-5 productos, precios baratos (a coste o
-- casi, es para que el redactor vaya bien identificado, no un negocio).
-- Ajusta nombres/precios/imágenes a mano según lo que definas con el
-- proveedor; esto es un punto de partida razonable.
-- ---------------------------------------------------------------------
INSERT INTO tienda_productos (nombre, descripcion, precio_centimos, variantes, orden) VALUES
  ('Gorra ElOtroFútbol', 'Gorra oficial bordada con el logo, para ir acreditado en el campo.', 800, NULL, 1),
  ('Camiseta ElOtroFútbol', 'Camiseta técnica con el logo, ideal para grabaciones y directos desde el campo.', 1200, '["S","M","L","XL"]', 2),
  ('Petaca de micrófono personalizada', 'Funda/petaca para micro con el logo de ElOtroFútbol, para que se vea en las entrevistas.', 600, NULL, 3),
  ('Chaleco de prensa ElOtroFútbol', 'Chaleco identificativo de prensa con el logo, para acceso a zona mixta.', 1500, '["S","M","L","XL"]', 4),
  ('Pack acreditación completo', 'Gorra + camiseta + petaca de micro, todo junto con descuento.', 2200, '["S","M","L","XL"]', 5);
