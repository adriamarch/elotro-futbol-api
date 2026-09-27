PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE contadores (
      anio INTEGER PRIMARY KEY,
      ultimo_numero INTEGER NOT NULL DEFAULT 0
    );
INSERT INTO "contadores" ("anio","ultimo_numero") VALUES(2026,80);
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_pedido TEXT NOT NULL UNIQUE,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  nombre_cliente TEXT NOT NULL,
  telefono TEXT NOT NULL,
  direccion TEXT NOT NULL,

  producto_id TEXT NOT NULL,
  producto_nombre TEXT NOT NULL,
  variante TEXT,
  cantidad INTEGER NOT NULL,
  precio_total REAL NOT NULL,

  estado TEXT DEFAULT 'pendiente'
, tracking_number TEXT, actualizado_en TIMESTAMP, factura_url TEXT, numero_factura TEXT, tipus TEXT, color TEXT, jugador TEXT, notas TEXT DEFAULT '', fecha_factura TEXT, articles TEXT, email TEXT, cupo_codigo TEXT, cupo_descuento REAL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(43,'TGN-2026-0052','2026-08-01 13:33:20','Xavier Prió Roca','+34630115570','Av. Roma n.19 12è 1a, Tarragona, 43005, ES','27','"Funda tarragonina"',NULL,1,20,'entregado',NULL,'2026-08-12 10:21:42',NULL,NULL,NULL,NULL,NULL,'',NULL,NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(44,'TGN-2026-0053','2026-08-01 13:34:12','Xavier Prió Roca','+34630115570','Av. Roma n.19 12è 1a, Tarragona, 43005, ES','66','"1886"','60x90cm',1,15,'entregado',NULL,'2026-08-12 10:21:36',NULL,NULL,NULL,NULL,NULL,'',NULL,NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(45,'TGN-2026-0054','2026-08-01 13:35:30','Xavier Prió Roca','+34630115570','Av. Roma n.19 12è 1a, Tarragona, 43005, ES','34','"Match Day Every Day"','L',1,17.5,'entregado',NULL,'2026-08-12 10:21:31','https://pub-803bfa3513c14eefa073b2811a8bfab6.r2.dev/FAC-2026-0024.pdf','FAC-2026-0024',NULL,NULL,NULL,'','2026-08-01T15:03:41.328Z',NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(47,'TGN-2026-0056','2026-08-10 10:46:24','Aroa Liria Royo','+34652254539','Josep Maria Vives i Salas, 3, esc 3, 5-2, Tarragona, 43005, ES','34','"Match Day Every Day"','L',1,17.5,'entregado',NULL,'2026-09-04 23:44:47',NULL,NULL,NULL,NULL,NULL,'',NULL,NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(50,'TGN-2026-0059','2026-09-04 22:18:55','Marina Oteros Cubillo','+346552567','Carrer de la Piscina 2, 2n1r, Picamoixons, 43491, ES','34','"Match Day Every Day"','2XL',1,17.5,'enviado','PQBW6V9810551010143491D','2026-09-13 01:02:23',NULL,NULL,NULL,NULL,NULL,'',NULL,NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(52,'TGN-2026-0061','2026-09-09 20:22:05','David Porta Aguilar','+34660180355','C/ Higini Anglès, n° 10, esc.dreta, 8-1, Tarragona, 43001, ES','8','"Catalunya"','90x150cm',1,12.25,'enviado','CNG00840517589865','2026-09-13 01:01:48','https://pub-803bfa3513c14eefa073b2811a8bfab6.r2.dev/FAC-2026-0026.pdf','FAC-2026-0026',NULL,NULL,NULL,'','2026-09-10T00:04:07.596Z',NULL,NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(61,'TGN-2026-0070','2026-09-10 08:11:19','Ivan Castillo Garriga','676482200','C/Matanzas, 35 Entresol 2a Escala A, Barcelona, 08027, ES','carret-multiple','"Match Day Every Day"',NULL,1,17.5,'enviado','080270000109113733','2026-09-13 01:02:45',NULL,NULL,NULL,NULL,NULL,'',NULL,'[{"nom":"\"Match Day Every Day\"","quantitat":1,"preuUnitari":17.5,"subtotal":17.5,"talla":"L","tipus":null,"jugador":null,"mesures":null,"color":null}]',NULL,NULL,NULL);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(70,'TGN-2026-0079','2026-09-15 05:39:24','Joaquim Sevilla','+34641770124','Carrer Major, 20, Picamoixons, 43491, ES','carret-multiple','4 articles: 1x "Grana fins la mort", 2x "Tarragona", 1x "Orgull Tarragoní"',NULL,4,29.7,'enviado','PHBW6T9812764920143491Q','2026-09-19 11:57:06','https://pub-803bfa3513c14eefa073b2811a8bfab6.r2.dev/FAC-2026-0034.pdf','FAC-2026-0034',NULL,NULL,NULL,'','2026-09-15T05:39:24.454Z','[{"nom":"\"Grana fins la mort\"","quantitat":1,"preuUnitari":8.25,"subtotal":8.25,"talla":null,"tipus":null,"jugador":null,"mesures":"60x90cm","color":null},{"nom":"\"Tarragona\"","quantitat":2,"preuUnitari":8.25,"subtotal":16.5,"talla":null,"tipus":null,"jugador":null,"mesures":"60x90cm","color":null},{"nom":"\"Orgull Tarragoní\"","quantitat":1,"preuUnitari":8.25,"subtotal":8.25,"talla":null,"tipus":null,"jugador":null,"mesures":"60x90cm","color":null}]','fastmenpolls5020@gmail.com','BENVINGUDA10',3.3);
INSERT INTO "pedidos" ("id","numero_pedido","fecha","nombre_cliente","telefono","direccion","producto_id","producto_nombre","variante","cantidad","precio_total","estado","tracking_number","actualizado_en","factura_url","numero_factura","tipus","color","jugador","notas","fecha_factura","articles","email","cupo_codigo","cupo_descuento") VALUES(71,'TGN-2026-0080','2026-09-19 11:51:50','Gerard Palau Martínez','+34640886959','Avinguda de Bofarull 49, Els Pallaresos, 43151, ES','carret-multiple','"Tarragona"',NULL,1,12.25,'pedido_aliexpress',NULL,'2026-09-19 12:07:33','https://pub-803bfa3513c14eefa073b2811a8bfab6.r2.dev/FAC-2026-0035.pdf','FAC-2026-0035',NULL,NULL,NULL,'','2026-09-19T11:51:50.295Z','[{"nom":"\"Tarragona\"","quantitat":1,"preuUnitari":12.25,"subtotal":12.25,"talla":null,"tipus":null,"jugador":null,"mesures":"90x150cm","color":null}]','gerardfortnite2019@gmail.com',NULL,NULL);
CREATE TABLE contadores_factura (
      anio INTEGER PRIMARY KEY,
      ultimo_numero INTEGER NOT NULL DEFAULT 0
    );
INSERT INTO "contadores_factura" ("anio","ultimo_numero") VALUES(2026,35);
CREATE TABLE usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      actualizado_en TEXT
    );
INSERT INTO "usuarios" ("id","username","password_hash","password_salt","actualizado_en") VALUES(1,'adria','28b3d6300a52b1714b7b7f6541c7e1ea3f33287a07d2279027affb95d068d3cf','460572b333a61930c360f9abdb6419d2','2026-07-19 19:05:17');
INSERT INTO "usuarios" ("id","username","password_hash","password_salt","actualizado_en") VALUES(2,'usuari2','82e78aa8f1b03836a3aafe8dd9e99035e2f96f1b5d731d9204ae1d66c8085703','c516af53380b56529413495387af5a1e',NULL);
CREATE TABLE sesiones (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      creado_en TEXT NOT NULL,
      expira_en TEXT NOT NULL
    );
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('f833032a30c415c8b37d1be2e415860a5554690476c407b366aaf95008d24eae',1,'2026-07-19T19:04:03.344Z','2026-07-20T07:04:03.344Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('fd196704d1ab2efb2b87171faec13fdb0a6d844de557c84de3625b5dfb73bc6b',1,'2026-07-19T20:02:28.956Z','2026-07-20T08:02:28.956Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('8cb130446ea29d642034aa651d2e03e251568347a463007310257762ef48f48b',1,'2026-07-19T20:05:35.855Z','2026-07-20T08:05:35.855Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('4a5e18b0006dcaa4a5e55e3e747317286c6fe22192f1d0531a3b236c63d80a10',1,'2026-07-19T20:06:09.767Z','2026-07-20T08:06:09.767Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('b1dabb8525dc83852309446669ff4f844d261da50b9af1513127fc370178ec32',1,'2026-07-19T20:07:51.648Z','2026-07-20T08:07:51.648Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('a8eae87dff2f81c87edb4aa6df03ccf272711e762b4b8c96f8a1c8f32b323743',1,'2026-07-19T20:09:01.834Z','2026-07-20T08:09:01.834Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('1ae3f864c0b2148d8aa6244d5c0cc579a674d8763d0dd34e9c3c925abe13c612',1,'2026-07-19T20:09:24.493Z','2026-07-20T08:09:24.493Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('57e5710ddcc2e08ee12ce6d81fbe3c80545cd7333b09e071931b5a8ca23d4db5',1,'2026-07-19T20:09:29.058Z','2026-07-20T08:09:29.058Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('aaeb5858a18edff8bc31bdfcd7b78c85fc1ea8702393efe19c932ff0d971a6b8',1,'2026-07-19T20:09:33.339Z','2026-07-20T08:09:33.339Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('5bfbdd906676023a645302a0e8008d7fdf9d4ded4a947fe70db699d6d4669fdf',1,'2026-07-19T20:09:50.621Z','2026-07-20T08:09:50.621Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('752af4fbe72b8ee594f778d24bfd474e4565f9a04fa1828a4929d2b431a9f6e8',1,'2026-07-19T20:11:23.162Z','2026-07-20T08:11:23.162Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('bf0e7c119cab134592c578531abad579cb7c6b98241bbcb360cc580f4c9a9912',1,'2026-07-19T20:15:06.542Z','2026-07-20T08:15:06.542Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d9dc427db8923dfcebc863643d72e8393e41a3b0f9fa7c47be569d8ffceea9ae',1,'2026-07-19T20:15:13.928Z','2026-07-20T08:15:13.928Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('eb80d1cab2e384689c0bcdf3b77842aa20168d7b493037e865fffb5266518941',1,'2026-07-19T21:21:01.741Z','2026-07-20T09:21:01.741Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('64efa6ecaf95563868313d326176ac75b714467f5f65ab9807f89e72ceed9e01',1,'2026-07-19T22:56:54.019Z','2026-07-20T10:56:54.019Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('ebf768c09c0f335034a36cc2dd0a4dd3afaa2f41962db04a4e856626bdebd7cf',1,'2026-07-20T15:26:30.773Z','2026-07-21T03:26:30.773Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('5b0d35884a72035af69d01e2bbeb05974f67214941a8db262c14cc2172a4bdd1',1,'2026-07-20T15:26:30.770Z','2026-07-21T03:26:30.770Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('a711936f02f4ebae28b07360997f7dee2bc4c30a363667f98f078636d8f5f1ba',1,'2026-07-20T15:26:30.800Z','2026-07-21T03:26:30.800Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('27984635fc5cee22307bac4131141c1462813a5136eaa8bcf63d1f129d03b722',1,'2026-07-20T23:34:40.087Z','2026-07-21T11:34:40.087Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('9f022e91c481afda435c17972bc7e51810ab6fe9e380790a09fd58644eebb53d',1,'2026-07-22T00:36:07.585Z','2026-07-22T12:36:07.585Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('a2f0daeb57f03ece676b699a9e6b733ae4287942b8ac0a6df338d4274af9b3c9',1,'2026-07-22T00:46:39.103Z','2026-07-22T12:46:39.103Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('1408cd2eaab4bf6ad6f3311b7a16a9d9438cf4540d41f191e3ed3979c51986d1',1,'2026-08-01T13:37:15.346Z','2026-08-02T01:37:15.346Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('08b7c77f1a713e710c686f622fc957448d1a53aae92f9e49564276c0e5b5e397',1,'2026-08-01T14:12:06.087Z','2026-08-02T02:12:06.087Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('e603c1c05e308d5e9e870eb526636000beb84c30bde18fa35ed0bf0a9f685ef6',1,'2026-08-01T14:12:06.116Z','2026-08-02T02:12:06.116Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('88b4bf5a848d67b63d76ce320bdf7e98e05239236c0bddd7da36aa57a4a019ce',1,'2026-08-01T15:00:43.990Z','2026-08-02T03:00:43.990Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('ed4f589f9aa35b2328b0eb5c8bd1376dfbe127c5555ea756856c8735ef983502',1,'2026-08-01T15:02:31.775Z','2026-08-02T03:02:31.775Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('4a748bfe63f238aa2347f40e0756c60bf6088fe0da96e5796f147c13648f3fb0',1,'2026-08-01T15:12:47.402Z','2026-08-02T03:12:47.402Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('558eeb1a0c5e13b14832ce2a94f0de4f36fedf5a3a841277a4f72701601af054',1,'2026-08-01T15:27:01.474Z','2026-08-02T03:27:01.474Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('4b3be3ac494186cf143dc6418ff34bfaa0f3737e8bb06f1826d1c7d04a5dfe89',1,'2026-08-01T15:34:44.562Z','2026-08-02T03:34:44.562Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d1457386e1cdc741dbfeda4504d57203d0e3b31b2a1fcfdaf5c6891b9d83b26c',1,'2026-08-01T15:41:05.396Z','2026-08-02T03:41:05.396Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('75976ac1963ea2888b1eda21219896dd562cc89cc8756533f056b4d121a3b6ae',1,'2026-08-01T16:41:18.706Z','2026-08-02T04:41:18.706Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('166cdb71940028020c6f3018c281dd9cf87c969aff86fb88cc340624a19cd937',1,'2026-08-02T08:25:38.802Z','2026-08-02T20:25:38.802Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('b83f2f98f0b9b9e9cb6d56480917789aabbf4f75cbaff6534886d5b2e1882e90',1,'2026-08-05T20:57:43.078Z','2026-08-06T08:57:43.078Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('9378aa46f3c5c5ed458bab1c12ce373d99e5e0a230bf15523edf81b3fbd130d8',1,'2026-08-12T00:23:05.769Z','2026-08-12T12:23:05.769Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('22274b1ce3292b614d923965b26badab9aa619603433a3d1dcfa263b95aa4f82',1,'2026-08-12T00:25:56.614Z','2026-08-12T12:25:56.614Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('addbce484b6b016b9b41f9fad0705b76f7bba30f43d23354bca4b7aa1273000d',1,'2026-08-12T00:50:47.063Z','2026-08-12T12:50:47.063Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('93a1490854e4dfdae3ad777e25a0acaa463cfee9cc41898d533a03d90ba9675e',1,'2026-08-12T10:16:41.265Z','2026-08-12T22:16:41.265Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('44a8d45758eb1563749b63c61abbd1ce3f7404ed6e20e53e1cbdc1ea38e9979f',1,'2026-08-12T20:15:55.140Z','2026-08-13T08:15:55.140Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('cee9cee73384434bedcf6d6b2afa08f696d9bf655577688ce98f0b716bff78ad',1,'2026-08-17T03:40:11.574Z','2026-08-17T15:40:11.574Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('e0f68aea0e030e269ef176a2c9e9f01348195143e04bc08f8f7e5833e3c0554a',1,'2026-08-18T00:26:29.599Z','2026-08-18T12:26:29.599Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('fed8cda13334646408f7c66ffcce833de08f4f8ad346f700d8e9b77b9232e955',1,'2026-08-19T11:07:23.112Z','2026-08-19T23:07:23.112Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('3cb7ede94f0030d339c85df906aa5febb11912cbf313a6edc281b886e532dbb4',1,'2026-08-29T01:11:33.751Z','2026-08-29T13:11:33.751Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('a777cf2a8af0671ac196b8ab1740631afcbf0edd749bebf39baf78dd0eaa935e',1,'2026-09-01T09:17:41.962Z','2026-09-01T21:17:41.962Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('28f2c3de19a5f9e0c3247e322cd15c2bd871107f2161c01fdef5561971d0bae7',1,'2026-09-02T16:08:27.408Z','2026-09-03T04:08:27.408Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('36ea85fe2b4e6ac0046cee9e7d3f4a4d71a144bd9f77477e05ed568caa8bedc1',1,'2026-09-04T22:13:58.379Z','2026-09-05T10:13:58.379Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('07f5d74b2d4dfd90e53464c2dba0d709a0633ef5ca17bec54b810a0289974963',1,'2026-09-04T22:20:36.108Z','2026-09-05T10:20:36.108Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('7ef6c2d70296d9f3814e7234705dd4a946b87057fe9337c6c898f3722b90bf9d',1,'2026-09-04T23:20:29.416Z','2026-09-05T11:20:29.416Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d147449e5fa1c7207d7d4fe168fa5a2b319d1335cc23731edebd4ecd34119f68',1,'2026-09-04T23:44:24.204Z','2026-09-05T11:44:24.204Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('bab93a7da294324ba58ec9eb83197cc667c9b7a01f48b8af2814618425b26c70',1,'2026-09-09T15:21:29.699Z','2026-09-10T03:21:29.699Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('8c9b998296ba8b2e6b95062bad8034388ef26a1343684a5a5feba683c463c4ce',1,'2026-09-09T20:05:21.692Z','2026-09-10T08:05:21.692Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d1b096754985110ceb73c8b43ff59d87d2b10d313dd84b6daaa407b450884407',1,'2026-09-09T22:26:41.138Z','2026-09-10T10:26:41.138Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('650bf7c0e11d5d9c4a08c18c2eaf6e923116de1affe53a9de113b2c222c4d889',1,'2026-09-09T23:42:36.194Z','2026-09-10T11:42:36.194Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('4cb03c699bb312023cded726ce8d3eec18c9b359b8372d204e460ba6bff3fed4',1,'2026-09-09T23:47:58.317Z','2026-09-10T11:47:58.317Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('f9e194e3e32b73aaffd88d43d5bbb48313f64adcf4ac6b0195266bb225248a0b',1,'2026-09-09T23:53:20.236Z','2026-09-10T11:53:20.236Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('453cb145906a1daaf0765925bb2e5d590d63e84e2676d097501331500250a32e',1,'2026-09-10T00:04:01.804Z','2026-09-10T12:04:01.804Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('7156d11559c516bac41fe323d8dac4806f141f28fb0d0d8a47eed6cb336cf9db',1,'2026-09-10T00:08:22.309Z','2026-09-10T12:08:22.309Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('3a2568c0b977a67768fafcb7a03720b7b66b5ec551f39379028ccb6669e53598',1,'2026-09-10T00:12:38.417Z','2026-09-10T12:12:38.417Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('b0a35a7ee4b39a930539b17c18b43805af838733aea5764d10f2f72b78b7ea2d',1,'2026-09-10T00:33:28.242Z','2026-09-10T12:33:28.242Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('cb020ca24a469e72f9a50923a2718db3c0fb5f324c2675a69f1784f73dc28ddb',1,'2026-09-10T00:46:46.600Z','2026-09-10T12:46:46.600Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('3648eb2f1812529b32e0c3963b4801b0f0c118f9c5932bd104fa427cc78389bb',1,'2026-09-10T05:06:43.309Z','2026-09-10T17:06:43.309Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('4337749314acb086c1a93c3fd013e47775d53e37af123470bde8b8ad1a25ea8f',1,'2026-09-10T05:18:51.543Z','2026-09-10T17:18:51.543Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('bbb48b1184865c1b393eeb7808e55dcfc6364b9183b1d486c0bf21b337e01337',1,'2026-09-10T15:30:02.028Z','2026-09-11T03:30:02.028Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('e2365e5ab7d94b378c277e4dab6e3065c8c4d7e9518c55b175fb6c83b9484300',1,'2026-09-10T15:44:38.469Z','2026-09-11T03:44:38.469Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('c24197b658d756c7661b479d43b428184dfab9fe59faaf1e5af21ab551cb295d',1,'2026-09-10T16:40:40.854Z','2026-09-11T04:40:40.854Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('8e623ca443bc1dc58cde4a7121f736f0f4e4b2b54c3846aef5efcd98ca4a54e8',1,'2026-09-10T16:55:38.704Z','2026-09-11T04:55:38.704Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('0a697454ccd9846c0b7f50c0d2b6aa30794343314b23d1c413f87b2597306859',1,'2026-09-10T17:18:18.391Z','2026-09-11T05:18:18.391Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('6fb39bf97acf695472a7a7426ec68fca52dfe359a0d93ddcedbeb8f790f09650',1,'2026-09-10T17:26:37.108Z','2026-09-11T05:26:37.108Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('3143c862b8cde5dc9ff3fb6ebed795d347440262aaf9f81e16132f5b011b2de7',1,'2026-09-10T17:26:37.293Z','2026-09-11T05:26:37.293Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('f8d38c6f4520685161192a3c94de096324fdf551d8c45c33049ea93b7ab02cba',1,'2026-09-10T17:31:23.333Z','2026-09-11T05:31:23.333Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('864192359524326d5547e7cdef69019d752d851308905b9630944e48072eb690',1,'2026-09-10T17:35:46.349Z','2026-09-11T05:35:46.349Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('7d0b5417ec5aee926c9d85a25a32fd714b2847f879c0fe48e8ba636a7fdf5f78',1,'2026-09-10T17:36:15.354Z','2026-09-11T05:36:15.354Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('674a784764fae071340fd51ad9ed584f2fa4d75356e8d426394370ba6e1886fc',1,'2026-09-10T17:52:46.121Z','2026-09-11T05:52:46.121Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d934104603d10ab8f3f60679c0e16e2c4e662a39fe5919279f2a0fc42267aa97',1,'2026-09-10T18:15:28.237Z','2026-09-11T06:15:28.237Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('9de5c6198f28ea70028cd7671b1c9f3111efa1382786d3306baae385339ad68c',1,'2026-09-10T20:50:52.240Z','2026-09-11T08:50:52.240Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('ab9f879eb3244fc557d717ee69fef5f2fac8ce65e2d742f6e87c04536f9b4744',1,'2026-09-10T20:55:27.524Z','2026-09-11T08:55:27.524Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('6b06addbf701c765cfcd92b4672ecd1dad449c3ba25a34ae287eb3765410941c',1,'2026-09-10T21:27:44.366Z','2026-09-11T09:27:44.366Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('d9070032d11cb5423c93098101bb3fbd954e853cdbe71573fe1706adcdccab33',1,'2026-09-11T00:37:57.579Z','2026-09-11T12:37:57.579Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('fb7e4ea0ad5268c3eda5095256affdb38ae25bbd2749ba70a701f4e89623c0ee',1,'2026-09-13T00:58:57.095Z','2026-09-13T12:58:57.095Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('ad8c8aa5e301f8d413108cb6cc719e45fc5f3c811ef5a3807b4669021fe7d556',1,'2026-09-13T13:09:53.713Z','2026-09-14T01:09:53.713Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('275a147873c9f8ce886d5069b3e9c34a796a3e73f65cd8cd6617538484e9592a',1,'2026-09-13T23:05:18.907Z','2026-09-14T11:05:18.907Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('175e90fd7bd13787b7b745a045099485d61978b2035db704a569cc2801a094d4',1,'2026-09-14T22:50:37.313Z','2026-09-15T10:50:37.313Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('3dbdf774640a58e70782cbbdd637827f8f5daf6c37e2a58f512da312326f4766',1,'2026-09-15T05:19:24.423Z','2026-09-15T17:19:24.423Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('66dc15f62a7fb952f47388b1a4ed151a9d9faa6d469669b23cee5bda24649f8f',1,'2026-09-15T05:41:01.782Z','2026-09-15T17:41:01.782Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('7ab387efeb21afb159896b79f76f7c488b5a892acdf030388ea54456a5528fa0',1,'2026-09-15T13:03:31.899Z','2026-09-16T01:03:31.899Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('0d082244f1ce736292deadb74c9625b458347a4517e4cfd21bb2a35354593b8e',1,'2026-09-15T13:41:35.108Z','2026-09-16T01:41:35.108Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('bc98b2e64c29f5b2f179a2a1ebf17fa73eb923e51ee198b8feea3ff64a0d2814',1,'2026-09-15T22:43:41.826Z','2026-09-16T10:43:41.826Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('af6925382f211ba08ad057ab02828030313c3ab31752204a41460b024866a286',1,'2026-09-19T11:52:43.899Z','2026-09-19T23:52:43.899Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('9e164d55b1b76cfc8d2284e27107438f358d5cc61ead89601b0e176eea4b3db4',1,'2026-09-19T12:04:23.423Z','2026-09-20T00:04:23.423Z');
INSERT INTO "sesiones" ("token","usuario_id","creado_en","expira_en") VALUES('e07f8d00e599f6aecf5756bbdd90ce3cdd1e71a7b744ad2782b095e1186be0f7',1,'2026-09-21T00:04:38.364Z','2026-09-21T12:04:38.364Z');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('pedidos',71);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('usuarios',2);
