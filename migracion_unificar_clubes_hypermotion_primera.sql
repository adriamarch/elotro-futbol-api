-- Unifica los nombres de equipo que llegan de TheSportsDB (relleno
-- automático de partidos) con los nombres "oficiales" que usa
-- public/js/clubs.js, para LaLiga Hypermotion (alias que faltaban) y
-- Primera Federación (no tenía ninguno todavía). Sin esto, los
-- partidos SÍ se guardaban (nombreInternoEquipo cae al nombre externo
-- tal cual si no lo reconoce), pero el nombre no coincidía con la
-- clave exacta que usa getEscudoUrl en clubs.js, así que el escudo no
-- se pintaba.
--
-- A partir de este despliegue, nombreInternoEquipo también reconoce
-- por "núcleo de nombre" (sin tildes/siglas) contra TODOS_LOS_CLUBES,
-- así que la mayoría de estas filas son ahora redundantes -pero se
-- dejan como alias explícitos igualmente, por si algún día aparece una
-- variante con un núcleo distinto (abreviatura rara, etc.) que sí
-- necesite esta tabla como red de seguridad.
--
-- Es seguro repetir esta migración (INSERT OR IGNORE + UPDATE
-- idempotente).

INSERT OR IGNORE INTO equipo_alias_externo (nombre_externo, nombre_interno) VALUES
  -- LaLiga Hypermotion (faltaban estos dos frente a
  -- alias_equipos_hypermotion.sql)
  ('Andorra', 'FC Andorra'),
  ('Oviedo', 'Real Oviedo'),

  -- Primera Federación · Grupo 1
  ('Merida', 'AD Mérida'),
  ('Arenas Club', 'Arenas Club'),
  ('Arenas', 'Arenas Club'),
  ('Bilbao Athletic', 'Bilbao Athletic'),
  ('Athletic Bilbao B', 'Bilbao Athletic'),
  ('Barakaldo', 'Barakaldo CF'),
  ('Coria', 'CD Coria'),
  ('Extremadura', 'CD Extremadura'),
  ('Extremadura UD', 'CD Extremadura'),
  ('Lugo', 'CD Lugo'),
  ('Mirandés', 'CD Mirandés'),
  ('Cacereño', 'CP Cacereño'),
  ('Cultural Leonesa', 'Cultural Leonesa'),
  ('Pontevedra', 'Pontevedra CF'),
  ('Racing Ferrol', 'Racing Club Ferrol'),
  ('Racing de Ferrol', 'Racing Club Ferrol'),
  ('Racing Club de Ferrol', 'Racing Club Ferrol'),
  ('Deportivo Fabril', 'RC Deportivo Fabril'),
  ('Deportivo B', 'RC Deportivo Fabril'),
  ('Aviles', 'Real Avilés Industrial'),
  ('Real Aviles', 'Real Avilés Industrial'),
  ('Real Unión', 'Real Unión Club'),
  ('Ponferradina', 'SD Ponferradina'),
  ('Logrones', 'UD Logroñés'),
  ('Ourense', 'UD Ourense'),
  ('Unionistas', 'Unionistas de Salamanca CF'),
  ('Unionistas Salamanca', 'Unionistas de Salamanca CF'),
  ('Unionistas de Salamanca', 'Unionistas de Salamanca CF'),
  ('Zamora', 'Zamora CF'),

  -- Primera Federación · Grupo 2
  ('Alcorcon', 'AD Alcorcón'),
  ('Aguilas', 'Águilas FC'),
  ('Algeciras', 'Algeciras CF'),
  ('Antequera', 'Antequera CF'),
  ('Atletico Madrileno', 'Atlético Madrileño'),
  ('Atletico Madrid B', 'Atlético Madrileño'),
  ('Teruel', 'CD Teruel'),
  ('Europa', 'CE Europa'),
  ('Rayo Majadahonda', 'CF Rayo Majadahonda'),
  ('Cartagena', 'FC Cartagena'),
  ('Gimnastic Tarragona', 'Gimnàstic de Tarragona'),
  ('Gimnastic', 'Gimnàstic de Tarragona'),
  ('Nastic', 'Gimnàstic de Tarragona'),
  ('Hercules', 'Hércules CF'),
  ('Juventud Torremolinos', 'Juventud Torremolinos CF'),
  ('Torremolinos', 'Juventud Torremolinos CF'),
  ('Jaen', 'Real Jaén CF'),
  ('Real Madrid Castilla', 'Real Madrid Castilla'),
  ('Real Madrid B', 'Real Madrid Castilla'),
  ('Murcia', 'Real Murcia CF'),
  ('Zaragoza', 'Real Zaragoza'),
  ('Huesca', 'SD Huesca'),
  ('Ibiza', 'UD Ibiza'),
  ('Sant Andreu', 'UE Sant Andreu'),
  ('Villarreal B', 'Villarreal CF B'),
  ('Villarreal CF B', 'Villarreal CF B');

-- Corrige los partidos YA guardados por el relleno automático (fuente
-- 'auto_api_football') con nombre corto/sin traducir, para que también
-- carguen el escudo con este mismo cambio, no solo los nuevos.
UPDATE results SET equipo_local = 'FC Andorra' WHERE fuente = 'auto_api_football' AND equipo_local = 'Andorra';
UPDATE results SET equipo_visitante = 'FC Andorra' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Andorra';
UPDATE results SET equipo_local = 'Real Oviedo' WHERE fuente = 'auto_api_football' AND equipo_local = 'Oviedo';
UPDATE results SET equipo_visitante = 'Real Oviedo' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Oviedo';

UPDATE results SET equipo_local = 'AD Mérida' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Merida', 'Mérida');
UPDATE results SET equipo_visitante = 'AD Mérida' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Merida', 'Mérida');
UPDATE results SET equipo_local = 'Barakaldo CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Barakaldo';
UPDATE results SET equipo_visitante = 'Barakaldo CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Barakaldo';
UPDATE results SET equipo_local = 'CD Coria' WHERE fuente = 'auto_api_football' AND equipo_local = 'Coria';
UPDATE results SET equipo_visitante = 'CD Coria' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Coria';
UPDATE results SET equipo_local = 'CD Extremadura' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Extremadura', 'Extremadura UD');
UPDATE results SET equipo_visitante = 'CD Extremadura' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Extremadura', 'Extremadura UD');
UPDATE results SET equipo_local = 'CD Lugo' WHERE fuente = 'auto_api_football' AND equipo_local = 'Lugo';
UPDATE results SET equipo_visitante = 'CD Lugo' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Lugo';
UPDATE results SET equipo_local = 'CD Mirandés' WHERE fuente = 'auto_api_football' AND equipo_local = 'Mirandes';
UPDATE results SET equipo_visitante = 'CD Mirandés' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Mirandes';
UPDATE results SET equipo_local = 'CP Cacereño' WHERE fuente = 'auto_api_football' AND equipo_local = 'Cacereno';
UPDATE results SET equipo_visitante = 'CP Cacereño' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Cacereno';
UPDATE results SET equipo_local = 'Pontevedra CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Pontevedra';
UPDATE results SET equipo_visitante = 'Pontevedra CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Pontevedra';
UPDATE results SET equipo_local = 'Racing Club Ferrol' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Racing Ferrol', 'Racing de Ferrol');
UPDATE results SET equipo_visitante = 'Racing Club Ferrol' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Racing Ferrol', 'Racing de Ferrol');
UPDATE results SET equipo_local = 'RC Deportivo Fabril' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Deportivo Fabril', 'Deportivo B');
UPDATE results SET equipo_visitante = 'RC Deportivo Fabril' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Deportivo Fabril', 'Deportivo B');
UPDATE results SET equipo_local = 'Real Avilés Industrial' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Aviles', 'Real Aviles');
UPDATE results SET equipo_visitante = 'Real Avilés Industrial' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Aviles', 'Real Aviles');
UPDATE results SET equipo_local = 'Real Unión Club' WHERE fuente = 'auto_api_football' AND equipo_local = 'Real Union';
UPDATE results SET equipo_visitante = 'Real Unión Club' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Real Union';
UPDATE results SET equipo_local = 'SD Ponferradina' WHERE fuente = 'auto_api_football' AND equipo_local = 'Ponferradina';
UPDATE results SET equipo_visitante = 'SD Ponferradina' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Ponferradina';
UPDATE results SET equipo_local = 'UD Logroñés' WHERE fuente = 'auto_api_football' AND equipo_local = 'Logrones';
UPDATE results SET equipo_visitante = 'UD Logroñés' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Logrones';
UPDATE results SET equipo_local = 'UD Ourense' WHERE fuente = 'auto_api_football' AND equipo_local = 'Ourense';
UPDATE results SET equipo_visitante = 'UD Ourense' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Ourense';
UPDATE results SET equipo_local = 'Unionistas de Salamanca CF' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Unionistas', 'Unionistas Salamanca');
UPDATE results SET equipo_visitante = 'Unionistas de Salamanca CF' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Unionistas', 'Unionistas Salamanca');
UPDATE results SET equipo_local = 'Zamora CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Zamora';
UPDATE results SET equipo_visitante = 'Zamora CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Zamora';

UPDATE results SET equipo_local = 'AD Alcorcón' WHERE fuente = 'auto_api_football' AND equipo_local = 'Alcorcon';
UPDATE results SET equipo_visitante = 'AD Alcorcón' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Alcorcon';
UPDATE results SET equipo_local = 'Águilas FC' WHERE fuente = 'auto_api_football' AND equipo_local = 'Aguilas';
UPDATE results SET equipo_visitante = 'Águilas FC' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Aguilas';
UPDATE results SET equipo_local = 'Algeciras CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Algeciras';
UPDATE results SET equipo_visitante = 'Algeciras CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Algeciras';
UPDATE results SET equipo_local = 'Antequera CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Antequera';
UPDATE results SET equipo_visitante = 'Antequera CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Antequera';
UPDATE results SET equipo_local = 'Atlético Madrileño' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Atletico Madrileno', 'Atletico Madrid B');
UPDATE results SET equipo_visitante = 'Atlético Madrileño' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Atletico Madrileno', 'Atletico Madrid B');
UPDATE results SET equipo_local = 'CD Teruel' WHERE fuente = 'auto_api_football' AND equipo_local = 'Teruel';
UPDATE results SET equipo_visitante = 'CD Teruel' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Teruel';
UPDATE results SET equipo_local = 'CE Europa' WHERE fuente = 'auto_api_football' AND equipo_local = 'Europa';
UPDATE results SET equipo_visitante = 'CE Europa' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Europa';
UPDATE results SET equipo_local = 'CF Rayo Majadahonda' WHERE fuente = 'auto_api_football' AND equipo_local = 'Rayo Majadahonda';
UPDATE results SET equipo_visitante = 'CF Rayo Majadahonda' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Rayo Majadahonda';
UPDATE results SET equipo_local = 'FC Cartagena' WHERE fuente = 'auto_api_football' AND equipo_local = 'Cartagena';
UPDATE results SET equipo_visitante = 'FC Cartagena' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Cartagena';
UPDATE results SET equipo_local = 'Gimnàstic de Tarragona' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Gimnastic Tarragona', 'Gimnastic', 'Nastic');
UPDATE results SET equipo_visitante = 'Gimnàstic de Tarragona' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Gimnastic Tarragona', 'Gimnastic', 'Nastic');
UPDATE results SET equipo_local = 'Hércules CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Hercules';
UPDATE results SET equipo_visitante = 'Hércules CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Hercules';
UPDATE results SET equipo_local = 'Juventud Torremolinos CF' WHERE fuente = 'auto_api_football' AND equipo_local IN ('Juventud Torremolinos', 'Torremolinos');
UPDATE results SET equipo_visitante = 'Juventud Torremolinos CF' WHERE fuente = 'auto_api_football' AND equipo_visitante IN ('Juventud Torremolinos', 'Torremolinos');
UPDATE results SET equipo_local = 'Real Jaén CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Jaen';
UPDATE results SET equipo_visitante = 'Real Jaén CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Jaen';
UPDATE results SET equipo_local = 'Real Madrid Castilla' WHERE fuente = 'auto_api_football' AND equipo_local = 'Real Madrid B';
UPDATE results SET equipo_visitante = 'Real Madrid Castilla' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Real Madrid B';
UPDATE results SET equipo_local = 'Real Murcia CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Murcia';
UPDATE results SET equipo_visitante = 'Real Murcia CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Murcia';
UPDATE results SET equipo_local = 'Real Zaragoza' WHERE fuente = 'auto_api_football' AND equipo_local = 'Zaragoza';
UPDATE results SET equipo_visitante = 'Real Zaragoza' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Zaragoza';
UPDATE results SET equipo_local = 'SD Huesca' WHERE fuente = 'auto_api_football' AND equipo_local = 'Huesca';
UPDATE results SET equipo_visitante = 'SD Huesca' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Huesca';
UPDATE results SET equipo_local = 'UD Ibiza' WHERE fuente = 'auto_api_football' AND equipo_local = 'Ibiza';
UPDATE results SET equipo_visitante = 'UD Ibiza' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Ibiza';
UPDATE results SET equipo_local = 'UE Sant Andreu' WHERE fuente = 'auto_api_football' AND equipo_local = 'Sant Andreu';
UPDATE results SET equipo_visitante = 'UE Sant Andreu' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Sant Andreu';
UPDATE results SET equipo_local = 'Villarreal CF B' WHERE fuente = 'auto_api_football' AND equipo_local = 'Villarreal B';
UPDATE results SET equipo_visitante = 'Villarreal CF B' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Villarreal B';

-- Refuerzo: variantes CON tilde/nombre completo que TheSportsDB está
-- usando de verdad para estos partidos (confirmado por los enlaces
-- rotos en producción: "Cacereño", "Mirandés", "Racing Club de
-- Ferrol", "Athletic Bilbao B", "Real Unión", "Unionistas de
-- Salamanca"). Las filas de UPDATE de más arriba solo cubrían variantes
-- SIN tilde/abreviadas, así que estas filas ya guardadas en la BD con
-- estas grafías concretas no se habían corregido todavía.
UPDATE results SET equipo_local = 'CP Cacereño' WHERE fuente = 'auto_api_football' AND equipo_local = 'Cacereño';
UPDATE results SET equipo_visitante = 'CP Cacereño' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Cacereño';
UPDATE results SET equipo_local = 'CD Mirandés' WHERE fuente = 'auto_api_football' AND equipo_local = 'Mirandés';
UPDATE results SET equipo_visitante = 'CD Mirandés' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Mirandés';
UPDATE results SET equipo_local = 'Racing Club Ferrol' WHERE fuente = 'auto_api_football' AND equipo_local = 'Racing Club de Ferrol';
UPDATE results SET equipo_visitante = 'Racing Club Ferrol' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Racing Club de Ferrol';
UPDATE results SET equipo_local = 'Bilbao Athletic' WHERE fuente = 'auto_api_football' AND equipo_local = 'Athletic Bilbao B';
UPDATE results SET equipo_visitante = 'Bilbao Athletic' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Athletic Bilbao B';
UPDATE results SET equipo_local = 'Real Unión Club' WHERE fuente = 'auto_api_football' AND equipo_local = 'Real Unión';
UPDATE results SET equipo_visitante = 'Real Unión Club' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Real Unión';
UPDATE results SET equipo_local = 'Unionistas de Salamanca CF' WHERE fuente = 'auto_api_football' AND equipo_local = 'Unionistas de Salamanca';
UPDATE results SET equipo_visitante = 'Unionistas de Salamanca CF' WHERE fuente = 'auto_api_football' AND equipo_visitante = 'Unionistas de Salamanca';
