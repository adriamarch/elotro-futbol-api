-- Migración: rellena la ubicación (estadio) de los resultados ya
-- existentes cuyo equipo local coincide con uno de la base de datos
-- ESTADIO_POR_CLUB (public/js/clubs.js), y que todavía no tenían
-- ubicación guardada (partidos creados antes de que el formulario
-- autorellenase este campo). No toca los resultados que ya tuvieran
-- algo escrito en "ubicacion".

UPDATE results SET ubicacion = 'Alfonso Murube' WHERE equipo_local = 'AD Ceuta FC' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Carlos Belmonte' WHERE equipo_local = 'Albacete Balompié' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Plantío' WHERE equipo_local = 'Burgos CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Mirandilla' WHERE equipo_local = 'Cádiz CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Castalia' WHERE equipo_local = 'CD Castellón' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Pepico Amat' WHERE equipo_local = 'CD Eldense' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Butarque' WHERE equipo_local = 'CD Leganés' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Heliodoro Rodríguez López' WHERE equipo_local = 'CD Tenerife' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nova Creu Alta' WHERE equipo_local = 'CE Sabadell' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'A Madroa' WHERE equipo_local = 'Celta Fortuna' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Arcángel' WHERE equipo_local = 'Córdoba CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Estadi Nacional' WHERE equipo_local = 'FC Andorra' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Montilivi' WHERE equipo_local = 'Girona FC' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Los Cármenes' WHERE equipo_local = 'Granada CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Zubieta' WHERE equipo_local = 'Real Sociedad B' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Son Moix' WHERE equipo_local = 'RCD Mallorca' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Carlos Tartiere' WHERE equipo_local = 'Real Oviedo' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Molinón' WHERE equipo_local = 'Real Sporting' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'José Zorrilla' WHERE equipo_local = 'Real Valladolid CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Ipurua' WHERE equipo_local = 'SD Eibar' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Power Horse Stadium' WHERE equipo_local = 'UD Almería' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Gran Canaria' WHERE equipo_local = 'UD Las Palmas' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Romano' WHERE equipo_local = 'AD Mérida' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Gobela' WHERE equipo_local = 'Arenas Club' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Lezama' WHERE equipo_local = 'Bilbao Athletic' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Lasesarre' WHERE equipo_local = 'Barakaldo CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'La Isla' WHERE equipo_local = 'CD Coria' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Francisco de la Hera' WHERE equipo_local = 'CD Extremadura' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Anxo Carro' WHERE equipo_local = 'CD Lugo' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Anduva' WHERE equipo_local = 'CD Mirandés' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Príncipe Felipe' WHERE equipo_local = 'CP Cacereño' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Reino de León' WHERE equipo_local = 'Cultural Leonesa' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Pasarón' WHERE equipo_local = 'Pontevedra CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'A Malata' WHERE equipo_local = 'Racing Club Ferrol' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Abegondo' WHERE equipo_local = 'RC Deportivo Fabril' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Román Suárez Puerta' WHERE equipo_local = 'Real Avilés Industrial' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Gal' WHERE equipo_local = 'Real Unión Club' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Toralín' WHERE equipo_local = 'SD Ponferradina' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Las Gaunas' WHERE equipo_local = 'UD Logroñés' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'O Couto' WHERE equipo_local = 'UD Ourense' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Reina Sofía' WHERE equipo_local = 'Unionistas de Salamanca CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Ruta de la Plata' WHERE equipo_local = 'Zamora CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Santo Domingo' WHERE equipo_local = 'AD Alcorcón' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Rubial' WHERE equipo_local = 'Águilas FC' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Mirador' WHERE equipo_local = 'Algeciras CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Maulí' WHERE equipo_local = 'Antequera CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Cerro del Espino' WHERE equipo_local = 'Atlético Madrileño' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Pinilla' WHERE equipo_local = 'CD Teruel' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nou Sardenya' WHERE equipo_local = 'CE Europa' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Cerro del Espino' WHERE equipo_local = 'CF Rayo Majadahonda' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Cartagonova' WHERE equipo_local = 'FC Cartagena' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nou Estadi' WHERE equipo_local = 'Gimnàstic de Tarragona' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'José Rico Pérez' WHERE equipo_local = 'Hércules CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Pozuelo' WHERE equipo_local = 'Juventud Torremolinos CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'La Victoria' WHERE equipo_local = 'Real Jaén CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Alfredo Di Stéfano' WHERE equipo_local = 'Real Madrid Castilla' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nueva Condomina' WHERE equipo_local = 'Real Murcia CF' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'La Romareda' WHERE equipo_local = 'Real Zaragoza' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Alcoraz' WHERE equipo_local = 'SD Huesca' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Can Misses' WHERE equipo_local = 'UD Ibiza' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Narcís Sala' WHERE equipo_local = 'UE Sant Andreu' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Ciudad Deportiva del Villarreal' WHERE equipo_local = 'Villarreal CF B' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'La Fuensanta' WHERE equipo_local = 'UB Conquense' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Pedro Escartín' WHERE equipo_local = 'CD Guadalajara' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Linarejos' WHERE equipo_local = 'Linares Deportivo' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Vivero' WHERE equipo_local = 'CD Badajoz' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'El Prado' WHERE equipo_local = 'CF Talavera de la Reina' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Nuevo Colombino' WHERE equipo_local = 'Recreativo de Huelva' AND (ubicacion IS NULL OR ubicacion = '');
UPDATE results SET ubicacion = 'Los Pajaritos' WHERE equipo_local = 'CD Numancia' AND (ubicacion IS NULL OR ubicacion = '');
