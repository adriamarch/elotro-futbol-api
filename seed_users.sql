-- ElOtroFútbol - Usuarios de redacción (actualización, NO borra nada)
-- Ejecutar sobre una DB que ya tiene el seed_users.sql original aplicado.
-- No usa DELETE: actualiza los 5 usuarios existentes (conserva su id, para no romper
-- la foreign key de articles.autor_id) e inserta los 18 nuevos.

-- 1) Actualizar usuarios existentes
UPDATE users SET username = 'adria', password_hash = 'd9314adba9c2bd3abf649d17fa61b00620010240e81abef27f1f5b99a3681105', salt = '95615014854c0d4977aaf5464bbd7092', nombre = 'Adrià', rol = 'admin' WHERE username = 'adria';
UPDATE users SET username = 'miguel_tgz', password_hash = 'bd46710f22761e252156b6fa4823d372d88c8c7938a4025b66b77c14950a436e', salt = '099fe8e9c429f187efab4515c07910a0', nombre = 'Miguel', rol = 'admin' WHERE username = 'miguel';
UPDATE users SET username = 'jorge', password_hash = 'fbf18a27359b55b691c0136f7534790013cd8d78f205d4fd7801e1af77e446b3', salt = '2fc1fd02e429a6b8da6da063d7c48e33', nombre = 'Jorge', rol = 'admin' WHERE username = 'jorge';
UPDATE users SET username = 'joaquin', password_hash = 'c90598b11c09e00811b7872cc57196a221f7d00da4b501a9de3c77f513c8015e', salt = 'dc5e47e85d2213ed04a20bf94db86d89', nombre = 'Joaquín', rol = 'admin' WHERE username = 'joaquin';
UPDATE users SET username = 'kiko', password_hash = '65de4c2c993f90f282e3bc8da9dd495594d126996d091b8097780ec5d137acb4', salt = 'e46f71769a2385aaccfebe3472ab82f6', nombre = 'Kiko', rol = 'redactor' WHERE username = 'kiko';

-- 2) Insertar usuarios nuevos
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('benat', 'e6c7551a13612b4a3bdefa7e46aa7c260716958e0ca122cb82df76fbe2bb1c55', '57b1246c97d24ad17ff0630ebc61a075', 'Beñat', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('christian_zurita', '252e7cd944ebbd75458ea73c4d607412ba6939e18a21a7ed70f5406ef651c566', '0cddcc35f28901036bad6b61b231efbd', 'Christian Zurita', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('dani_alcorcon', 'bd65efd939bcee7f7dcdb35d730c97ca452cab009c32be6142a532d1111a83b5', '8fa053774b7c48d12dc25b9e0a5cbb12', 'Dani', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('dani_ponferradina', '8ac828c29acf5a095f2f41ab6590e07436b538a4e6e6f4b488f54e4f5bcba7b5', '019f60491942478786d7651fa7c42be1', 'Dani', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('jaime', '8c9a3bb52092a642b1fd8265b896129bbdf9d8cdc4d0f9cd1e2230298fe26807', 'd6075e7abd802d203eb57c0b52decc8a', 'Jaime', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('jesus', '93d09abec4da546b5af780a0315ffdf77318420c046d3e54883fde276e9cc651', 'f103b8e028c17af90764ea8c32745b1f', 'Jesús', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('jose_alberto_guirao', '0fe443d36987735e78ccc821750a934c58c5d6551c6b06a50a9a03a250a9eefd', 'c62be705a0f532be88e339b5ba69cb4a', 'José Alberto Guirao', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('jose_luis', '6c6bb4c9fa24bb276da8facae5771e7b47a4bd2f1474944177e8fb0ba2c295a4', 'c3ba8d387b85f6c8fc31ce1377fd2bf4', 'Jose Luis', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('jose_manuel_castano', 'd738dd749a74d192ae605c072e9debd93aa157001714f435ef8e868633c87d01', 'e56be868f02a085c44b8c0ea01995124', 'Jose Manuel Castaño', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('manuel_jesus', '332fcf990e393f87dfce30228274508fbddfe7046c6bc2e4bd72da5aba6a6009', 'e1bc416e332c8fec51de0bb9492c3850', 'Manuel Jesús', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('marcos', 'fc91ac679c7d26bcbfa613c7218221c2e186e83f28a2b682a56c885d5359b9d7', 'ab41b2b6251f34945ddf4f7087e9ed29', 'Marcos', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('miguel_majadahonda', 'c0924c0d08844aa7b1e9d01267763ecad4219837ff1af98b28b7753fd5660af1', '5a2fd6d8a8dd7e8e3c72e81c34c8217b', 'Miguel', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('miguel_linares', 'e216638970d14db4e31eee25c9b864011b35f5e86d0f44955fbef8568c415542', '05fd80aaa8fd6bddb0b187f9e820fc6c', 'Miguel', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('raul', '087d3fe03bc75d5763dba04d75066063366b37608374aac9ee87b0dd7ba94ac1', 'c33acf2baff3ecd715909f104d835d92', 'Raúl', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('rodrigo', 'a5978b75dc251b7222e73d9c1ed52f4d9dab36a3a03c7f5212d3614b7ab48e86', '3d274c1513e9e9f3f9d84036a5276eea', 'Rodrigo', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('salva', 'ae2621142d92aa6a31434f1c62a22534eec20d13642795195a023678377c0a89', '08d646ed4e02c112c86135ef6063a950', 'Salva', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('victor_huelva', '82d590a438d5d15447b41ba34284dd683bbb84a251ba6c5458191553b998c529', '4358b66b0bfe2367c790974271b882c0', 'Víctor', 'redactor');
INSERT INTO users (username, password_hash, salt, nombre, rol) VALUES ('victor_conquense', '879f50da20d59be6812cc52d6b865eff33c65ce2a6ce1a2da45f510be797ce29', '9292df779ce547184fd9def50c321931', 'Victor', 'redactor');
