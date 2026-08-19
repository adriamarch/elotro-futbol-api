-- ElOtroFútbol - Esquema D1

DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS articles;
DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS media;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'redactor', -- 'admin' o 'redactor'
  activo INTEGER NOT NULL DEFAULT 1,
  -- Correo electrónico del usuario. Se pide obligatoriamente la primera vez
  -- que inicia sesión (queda NULL hasta entonces) y sirve para poder
  -- recuperar la contraseña desde "He olvidado mi contraseña".
  email TEXT,
  -- Perfil público del redactor/admin (se muestra en su página de autor,
  -- enlazada desde el nombre en sus noticias): biografía corta, experiencia
  -- previa, foto y redes sociales propias (JSON con las mismas claves que
  -- las redes del medio: twitter/instagram/tiktok/youtube), todo opcional
  -- y editable por cada persona desde "Ajustes de cuenta" en el panel.
  bio TEXT,
  experiencia TEXT,
  avatar_url TEXT,
  redes_sociales TEXT,
  -- Equipo(s) de futbol que sigue o cubre habitualmente el redactor o
  -- admin: hasta 3 clubes de public/js/clubs.js, guardados como un
  -- array JSON en texto (p. ej. '["Real Madrid","FC Barcelona"]').
  -- Se muestra en su perfil publico y en el desplegable de autor al
  -- firmar una noticia. Solo lo puede asignar o cambiar un admin desde
  -- "Usuarios"; la propia persona lo ve en "Mis datos" pero no puede
  -- editarlo ahi. Opcional (puede no tener ninguno asignado).
  equipo TEXT,
  -- Última vez que la persona ha visto las novedades (campana de
  -- notificaciones) del panel, guardado en el servidor para que no se
  -- pierda si se borran las cookies/datos del navegador.
  notif_visto_at TEXT,
  -- Recuperación de contraseña por email: token de un solo uso (caduca
  -- a los 30 minutos) generado al pedir "He olvidado mi contraseña".
  -- Se borra (vuelve a NULL) en cuanto se usa o al caducar.
  reset_token TEXT,
  reset_token_expira TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  titulo TEXT NOT NULL,
  subtitulo TEXT,
  contenido TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'noticia', -- noticia, cronica, opinion, entrevista
  categoria TEXT NOT NULL DEFAULT 'hypermotion', -- hypermotion, primera_federacion, segunda_federacion, general
  club TEXT,
  imagen_url TEXT,
  -- Fotos adicionales de la noticia/crónica, guardadas como un array JSON
  -- de URLs (p.ej. '["https://...1.jpg","https://...2.jpg"]'). La primera
  -- imagen del array coincide siempre con "imagen_url" (la portada), que
  -- se mantiene por compatibilidad con las tarjetas y la portada.
  imagenes TEXT,
  -- Partido al que hace referencia la noticia/crónica (opcional). Permite
  -- que, una vez finalizado un partido en "Resultados", se enlace su
  -- marcador dentro de la noticia/crónica que se escriba sobre él.
  resultado_id INTEGER,
  autor_id INTEGER,
  autor_nombre TEXT,
  -- Segundo autor opcional (noticia firmada por dos personas). Solo un
  -- nombre extra que se muestra junto al autor principal; el autor
  -- principal (autor_id/autor_nombre) sigue siendo el que manda a
  -- efectos de permisos de edición, autor.html y SEO.
  coautor_id INTEGER,
  coautor_nombre TEXT,
  destacado INTEGER NOT NULL DEFAULT 0,
  publicado INTEGER NOT NULL DEFAULT 1,
  -- Cuando la noticia se guarda como borrador (publicado = 0), indica en
  -- qué punto está: 'terminado' (el redactor considera que ya está lista
  -- para que alguien la revise/publique, así que se avisa por email a la
  -- redacción) o 'en_proceso' (todavía la está escribiendo, así que no se
  -- manda ningún correo para no generar avisos de más). Se pregunta con
  -- una notificación en el panel justo al guardar como borrador. NULL
  -- cuando el artículo está publicado (no aplica).
  estado_borrador TEXT,
  -- Fecha/hora (UTC, formato ISO) en la que un administrador ha programado
  -- que esta noticia se publique sola, sin tener que entrar al panel a esa
  -- hora. Mientras esté rellena y en el futuro, la noticia se guarda con
  -- publicado = 0 (no visible en la web); el disparador programado del
  -- Worker (ver "scheduled" en src/index.js) revisa cada minuto si ya ha
  -- llegado esa hora y, si es así, la publica y limpia esta columna. NULL
  -- cuando la noticia no está programada (se ha publicado directamente, se
  -- ha guardado como borrador normal, o ya se ha publicado la programada).
  programado_para TEXT,
  -- Se pone a 1 en cuanto la noticia se publica por primera vez (a mano o
  -- porque el disparador programado la publica sola). Mientras esté a 0
  -- (borrador o programada, nunca publicada todavía), el slug se
  -- recalcula a partir del título cada vez que se guarda; en cuanto pasa
  -- a 1, el slug queda fijo para siempre y no vuelve a cambiar aunque se
  -- edite el título después (para no romper enlaces ya compartidos). Ver
  -- también la tabla article_slug_redirects más abajo.
  slug_congelado INTEGER NOT NULL DEFAULT 0,
  fecha_publicacion TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Traducciones opcionales del artículo (solo contenido, no interfaz).
  -- Si el redactor no traduce a un idioma, estos campos quedan NULL y esa
  -- noticia se sigue viendo en castellano ahí, avisando de que no está
  -- disponible en ese idioma.
  titulo_eu TEXT, subtitulo_eu TEXT, contenido_eu TEXT,
  titulo_ca TEXT, subtitulo_ca TEXT, contenido_ca TEXT,
  titulo_gl TEXT, subtitulo_gl TEXT, contenido_gl TEXT,
  titulo_en TEXT, subtitulo_en TEXT, contenido_en TEXT,
  -- Columna heredada del antiguo sistema de imagen para redes (ya
  -- retirado); se mantiene sin usar para no forzar una migración
  -- destructiva sobre datos existentes.
  imagen_post_url TEXT,
  FOREIGN KEY (autor_id) REFERENCES users(id),
  FOREIGN KEY (coautor_id) REFERENCES users(id),
  FOREIGN KEY (resultado_id) REFERENCES results(id)
);

CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competicion TEXT NOT NULL, -- hypermotion, primera_federacion, segunda_federacion
  grupo TEXT, -- para Segunda Federación (Grupo 1, Grupo 2...)
  jornada INTEGER NOT NULL,
  equipo_local TEXT NOT NULL,
  equipo_visitante TEXT NOT NULL,
  goles_local INTEGER,
  goles_visitante INTEGER,
  fecha_partido TEXT, -- fecha y, si se conoce, hora del partido ("YYYY-MM-DD" o "YYYY-MM-DDTHH:MM")
  estado TEXT NOT NULL DEFAULT 'programado', -- programado, en_juego, finalizado
  -- Dónde se juega el partido (estadio, ciudad...). Se muestra junto a la
  -- fecha/hora en los partidos que todavía no se han disputado ("Por
  -- jugar"), tanto en la portada como en Resultados.
  ubicacion TEXT,
  -- Enlace a la ficha del partido en Flashscore. Solo tiene sentido (y
  -- solo se muestra en el frontend) para partidos ya finalizados de
  -- Primera Federación, Segunda Federación y LaLiga Hypermotion/LaLiga2.
  flashscore_url TEXT,
  -- Escudo personalizado (subido a Cloudinary) para un equipo "externo"
  -- que no está en la lista de public/js/clubs.js. Si están vacíos, el
  -- frontend resuelve el escudo automáticamente a partir del nombre del
  -- equipo (ver getEscudoUrl en clubs.js).
  escudo_local_url TEXT,
  escudo_visitante_url TEXT,
  -- Quién creó/gestiona este resultado. Igual que en articles, permite
  -- restringir su edición: cada redactor solo edita los suyos salvo que
  -- se le apruebe una solicitud de edición (ver tabla edit_requests).
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Instante (UTC) en que se pulsó "Iniciar partido" en el panel de
  -- Minuto a Minuto; sirve para calcular el cronómetro en vivo. NULL si
  -- el partido nunca se ha iniciado desde el panel.
  inicio_cronometro_at TEXT,
  -- Minuto en el que se congeló el cronómetro (al pulsar "Descanso",
  -- "Pausa de hidratación" o "Fin del partido" en el panel). NULL
  -- mientras corre con normalidad.
  cronometro_pausado_en INTEGER,
  -- Desplazamiento manual (minutos, puede ser negativo) que se suma al
  -- cronómetro calculado a partir de inicio_cronometro_at. Se usa para
  -- "Editar minuto" en el panel y para arrancar el cronómetro ya
  -- avanzado (p.ej. si el redactor marca "En juego" a mano 15 minutos
  -- después de la hora programada). 0 = sin ajuste.
  ajuste_cronometro_minutos INTEGER NOT NULL DEFAULT 0,
  -- Nueva fecha/hora cuando se marca el partido como "retrasado" (se
  -- guarda aparte de fecha_partido para conservar el horario original).
  fecha_partido_retrasado TEXT,
  -- Goles marcados en la tanda de penaltis (partidos eliminatorios
  -- empatados al final de la prórroga/tiempo reglamentario). NULL en
  -- los dos = no hubo tanda; el resultado del tiempo reglamentario
  -- sigue en goles_local/goles_visitante sin tocar. Se recalculan solos
  -- a partir de los eventos "penalti_marcado"/"penalti_fallado_tanda",
  -- igual que el marcador normal (ver recalcularPenaltisDesdeEventos).
  penaltis_local INTEGER,
  penaltis_visitante INTEGER,
  -- Evita repetir el email de "partido desatendido" (ver
  -- revisarPartidosDesatendidos) cada minuto mientras nadie lo
  -- soluciona: guarda qué mitades del partido ya han mandado su aviso
  -- ("primera", "segunda" o "primera_segunda"), como máximo un aviso
  -- por mitad en vez de un único aviso para todo el partido.
  aviso_desatendido_mitad TEXT,
  -- MVP (jugador destacado) del partido, elegido por un redactor desde
  -- el panel de Minuto a Minuto o el panel normal de edición. Texto
  -- libre (mismo formato que "jugador" en match_events: dorsal, nombre
  -- o ambos) + de qué equipo es, para poder pintar su escudo. NULL en
  -- los dos si todavía no se ha elegido.
  mvp_jugador TEXT,
  mvp_equipo TEXT, -- 'local' | 'visitante'
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

-- Eventos de un partido (goles, tarjetas, cambios, descansos...) que se
-- muestran en el detalle al clicar un resultado en resultados.html, y
-- que alimenta el panel de Minuto a Minuto.
CREATE TABLE match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resultado_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- gol, gol_var, gol_pp, amarilla, doble_amarilla, roja, cambio, inicio_partido, descanso, fin_descanso, pausa_hidratacion, fin_pausa_hidratacion, fin_partido, var, penalti_fallado, penalti_marcado, penalti_fallado_tanda, partido_retrasado, partido_anulado, otro
  equipo TEXT NOT NULL, -- 'local' o 'visitante' (o 'ninguno' para eventos sin equipo, como descanso). En "gol_pp" es el equipo del jugador que marca en su propia puerta (el gol cuenta para el rival). En "penalti_marcado"/"penalti_fallado_tanda" es el equipo que tira.
  jugador TEXT,
  jugador_sale TEXT, -- solo para tipo "cambio": jugador que sale (en "jugador" se guarda el que entra)
  jugador_asistencia TEXT, -- solo para tipo "gol": jugador que da la asistencia (opcional)
  minuto INTEGER NOT NULL, -- en "penalti_marcado"/"penalti_fallado_tanda" es el número de orden en la tanda (1, 2, 3...), no un minuto real
  minuto_extra INTEGER, -- minutos de descuento (ej. 45+2 -> minuto=45, minuto_extra=2)
  orden INTEGER NOT NULL DEFAULT 0, -- para desempatar eventos en el mismo minuto
  bajar_gol INTEGER NOT NULL DEFAULT 0, -- solo para tipo "gol_var": si 1, este gol anulado ya se había sumado al marcador y hay que restarlo; si 0, se registra sin tocar el marcador
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_match_events_resultado ON match_events(resultado_id);

-- Ajustes generales del medio (clave/valor). De momento se usa para las
-- redes sociales, guardadas todas juntas como JSON bajo la clave
-- 'redes_sociales' para poder editarlas desde un único sitio (el panel
-- de administración) en vez de tocar el código en varios archivos.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES (
  'redes_sociales',
  '{"twitter":"https://twitter.com/elotrofutbol","instagram":"https://instagram.com/elotrofutbol","tiktok":"https://tiktok.com/@elotrofutbol","youtube":"https://youtube.com/@elotrofutbol"}'
);

-- PIN de 4 dígitos de "Última hora": único y compartido por todos los
-- redactores (no uno por persona). Solo lo puede ver un admin, desde el
-- panel. Se regenera automáticamente cada vez que un redactor lo usa
-- para publicar directamente, así que un PIN filtrado o compartido de
-- más solo sirve para una publicación.
INSERT INTO settings (key, value) VALUES (
  'ultima_hora_pin',
  '0000'
);

-- Contenido multimedia (fotos y vídeos) que suben los redactores desde
-- "Subir contenido". El archivo en sí se guarda en R2 (binding MEDIA) tal
-- cual llega, sin recomprimir; aquí solo se guardan los metadatos y la
-- id/tipo del objeto en Cloudinary para poder descargarlo y borrarlo.
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloudinary_public_id TEXT UNIQUE NOT NULL,
  cloudinary_resource_type TEXT NOT NULL, -- 'image' o 'video' (lo exige la API de Cloudinary para borrar)
  cloudinary_url TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL, -- 'foto' o 'video'
  nombre_archivo TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano_bytes INTEGER NOT NULL,
  autor_id INTEGER,
  autor_nombre TEXT,
  club TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

CREATE INDEX idx_media_created ON media(created_at);

-- Sesiones activas por usuario (ver migracion_sesiones.sql para el
-- detalle): permite listarlas y cerrarlas en remoto desde el panel,
-- en "Ajustes de cuenta -> Sesiones".
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Cuentas de lectores (distintas de "users", solo redactores/admin):
-- ver worker/migracion_readers.sql para la explicación completa.
CREATE TABLE readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  email_verificado INTEGER NOT NULL DEFAULT 0,
  verificacion_token TEXT,
  verificacion_token_expira TEXT,
  reset_token TEXT,
  reset_token_expira TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_readers_email ON readers(email);

CREATE TABLE reader_sessions (
  id TEXT PRIMARY KEY,
  reader_id INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (reader_id) REFERENCES readers(id)
);
CREATE INDEX idx_reader_sessions_reader ON reader_sessions(reader_id);

CREATE INDEX idx_articles_categoria ON articles(categoria);
CREATE INDEX idx_articles_publicado ON articles(publicado, fecha_publicacion);
CREATE INDEX idx_results_competicion ON results(competicion, jornada);

-- Clubes "personalizados": equipos añadidos a mano desde "Otro equipo
-- (no está en la lista)" al crear un resultado o una noticia. Ver
-- migracion_custom_clubs.sql para la explicación completa.
DROP TABLE IF EXISTS custom_clubs;
CREATE TABLE custom_clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  escudo_url TEXT,
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id),
  UNIQUE (nombre, categoria)
);
CREATE INDEX idx_custom_clubs_categoria ON custom_clubs(categoria);

-- Solicitudes de un redactor para poder editar una noticia/crónica/
-- opinión/entrevista o un resultado que no es suyo. La aprueba un admin
-- o el propio autor original; al aprobarse se abre una ventana de tiempo
-- durante la que el solicitante puede editar esa entidad concreta.
DROP TABLE IF EXISTS edit_requests;
CREATE TABLE edit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_entidad TEXT NOT NULL, -- 'articulo' o 'resultado'
  entidad_id INTEGER NOT NULL,
  solicitante_id INTEGER NOT NULL,
  autor_id INTEGER,
  motivo TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente, aprobada, rechazada, caducada
  resuelta_por_id INTEGER,
  resuelta_at TEXT,
  permiso_expira_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES users(id),
  FOREIGN KEY (autor_id) REFERENCES users(id),
  FOREIGN KEY (resuelta_por_id) REFERENCES users(id)
);
CREATE INDEX idx_edit_requests_entidad ON edit_requests(tipo_entidad, entidad_id);
CREATE INDEX idx_edit_requests_solicitante ON edit_requests(solicitante_id, estado);
CREATE INDEX idx_edit_requests_estado ON edit_requests(estado);

-- Slugs antiguos de noticias/crónicas cuyo título cambió mientras todavía
-- estaban en borrador o programadas (ver "slug_congelado" en articles).
-- Quien entre con uno de estos enlaces viejos se redirige automáticamente
-- al slug actual del artículo, en vez de encontrarse un "no encontrada".
CREATE TABLE IF NOT EXISTS article_slug_redirects (
  slug_antiguo TEXT PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alineaciones (once inicial dibujado sobre un campo de fútbol),
-- vinculadas de forma independiente a una noticia/crónica (articles) o
-- a un partido (results). Ver worker/migracion_alineaciones.sql para el
-- detalle de cada columna.
DROP TABLE IF EXISTS alineaciones;
CREATE TABLE alineaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  result_id INTEGER,
  equipo TEXT NOT NULL,
  escudo_url TEXT,
  formacion TEXT NOT NULL DEFAULT '4-3-3',
  jugadores TEXT NOT NULL DEFAULT '[]',
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (autor_id) REFERENCES users(id)
);
CREATE INDEX idx_alineaciones_article ON alineaciones(article_id);
CREATE INDEX idx_alineaciones_result ON alineaciones(result_id);

-- Comentarios de lectores dentro de cada noticia/crónica/opinión/
-- entrevista. Ver worker/migracion_comentarios.sql para el detalle.
DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  moderado_por_id INTEGER,
  moderado_at TEXT,
  reader_id INTEGER REFERENCES readers(id),
  FOREIGN KEY (moderado_por_id) REFERENCES users(id)
);
CREATE INDEX idx_comments_article ON comments(article_id, estado);
CREATE INDEX idx_comments_estado ON comments(estado, created_at);
CREATE INDEX idx_comments_reader ON comments(reader_id);

-- Ficha informativa de cada club (entrenador, estadio, fundación...).
-- Ver worker/migracion_club_info.sql para el detalle.
DROP TABLE IF EXISTS club_info;
CREATE TABLE club_info (
  club TEXT PRIMARY KEY,
  entrenador TEXT,
  estadio TEXT,
  fundacion INTEGER,
  ciudad TEXT,
  autor_id INTEGER,
  autor_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

-- Propuestas de ficha de club pendientes de aprobación (redactores de
-- Nivel 1). Ver worker/migracion_club_info_solicitudes.sql.
DROP TABLE IF EXISTS club_info_solicitudes;
CREATE TABLE club_info_solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club TEXT NOT NULL,
  entrenador TEXT,
  estadio TEXT,
  fundacion INTEGER,
  ciudad TEXT,
  solicitante_id INTEGER NOT NULL,
  solicitante_nombre TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  resuelta_por_id INTEGER,
  resuelta_por_nombre TEXT,
  resuelta_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES users(id),
  FOREIGN KEY (resuelta_por_id) REFERENCES users(id)
);
CREATE INDEX idx_club_info_solicitudes_estado ON club_info_solicitudes(estado);
CREATE INDEX idx_club_info_solicitudes_club ON club_info_solicitudes(club);

