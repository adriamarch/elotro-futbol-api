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
  rol TEXT NOT NULL DEFAULT 'redactor', -- 'admin', 'redactor' o 'fotografo' (colaborador; ver migracion_colaboradores_fotografo.sql)
  activo INTEGER NOT NULL DEFAULT 1,
  -- Correo electrónico del usuario. Se pide obligatoriamente la primera vez
  -- que inicia sesión (queda NULL hasta entonces) y sirve para poder
  -- recuperar la contraseña desde "He olvidado mi contraseña".
  email TEXT,
  -- Fecha/hora (ISO) del primer inicio de sesión real. NULL = todavía no ha
  -- entrado nunca ("Sin primer acceso" en Usuarios). Antes se deducía de que
  -- faltara el correo, pero ahora el correo se guarda al crear la cuenta.
  -- Ver migracion_primer_acceso.sql.
  primer_acceso_at TEXT,
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
  -- Categoría(s) fija(s) para redactores "sin equipo, con categoría
  -- fija" (p. ej. Arbitraje): array JSON en texto, igual patrón que
  -- "equipo" (p. ej. '["arbitraje"]' o '["arbitraje","jurisdiccion"]").
  -- Si tiene valor(es), este redactor no tiene equipo y solo puede
  -- publicar noticias/crónicas/artículos en alguna de esas categorías
  -- (se fuerza siempre en el backend, no aplica a resultados). NULL o
  -- vacío para el caso normal (redactor con equipo, cualquier
  -- categoría). Solo lo asigna un admin desde "Usuarios", igual que
  -- el equipo.
  categorias_fijas TEXT,
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
  -- Categoría(s) adicional(es) de la noticia, aparte de la principal
  -- ("categoria", que es la que se usa para el link /futbol/[categoria]).
  -- Son solo etiquetas informativas que se muestran junto a la noticia,
  -- no afectan al filtrado por categoría ni a la URL. Array JSON en
  -- texto (p. ej. '["amistoso","general"]'), máximo 4 valores, sin
  -- repetir la principal. NULL o '[]' si no tiene ninguna adicional.
  categorias_adicionales TEXT,
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
  -- Preferencia de publicación del REDACTOR (no una programación real,
  -- solo una sugerencia orientativa para quien vaya a revisar/publicar
  -- la noticia). Formato "YYYY-MM-DD" (fecha simple, sin hora) o
  -- "YYYY-MM-DDTHH:MM" (con hora opcional); se rellenan opcionalmente al
  -- marcar el borrador como "terminado" (ver estado_borrador).
  -- "...desde" es la fecha (y hora, si se indicó) a partir de la cual al
  -- redactor le gustaría que se publicase, y "...hasta" el límite de ese
  -- rango; se pueden rellenar las dos, o solo "desde" para pedir "a
  -- partir de tal día" sin límite superior. No afecta a publicado ni
  -- dispara nada automático: es solo informativa, se limpia cuando la
  -- noticia se publica.
  fecha_preferencia_desde TEXT,
  fecha_preferencia_hasta TEXT,
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
  -- Ficha técnica editable a mano por el redactor, solo para crónicas.
  -- Guardada como JSON (competición, jornada, estadio, ciudad,
  -- fecha/hora, árbitro, asistencia, goleadores, tarjetas, MVP, notas).
  -- Ver migracion_ficha_tecnica.sql para el detalle de las claves.
  -- NULL si el artículo no tiene ficha técnica (lo normal salvo en
  -- crónicas donde el redactor la haya rellenado).
  ficha_tecnica TEXT,
  FOREIGN KEY (autor_id) REFERENCES users(id),
  FOREIGN KEY (coautor_id) REFERENCES users(id),
  -- ON DELETE SET NULL: si se borra el resultado desde el panel, la
  -- noticia/crónica se queda sin partido vinculado en vez de bloquear el
  -- DELETE (ver migracion_fk_resultado_id_set_null.sql: sin esto, borrar
  -- un resultado con una noticia enlazada fallaba con
  -- SQLITE_CONSTRAINT_FOREIGNKEY, un 500 que además disparaba el
  -- failover a la secundaria y, mal interpretado como 401, un logout).
  FOREIGN KEY (resultado_id) REFERENCES results(id) ON DELETE SET NULL
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
  -- 'redaccion' (creado por un redactor, como siempre) o
  -- 'auto_api_football' (relleno automático de un partido que nadie
  -- cubre; ver migracion_relleno_automatico.sql). external_id es el id
  -- del partido en la API externa, para que el cron pueda actualizarlo
  -- sin duplicarlo.
  fuente TEXT NOT NULL DEFAULT 'redaccion',
  external_id TEXT,
  -- Marca si este partido se cerró SOLO por el cron
  -- (crearFinPartidoAutomaticoAlMinuto90) al llegar al minuto
  -- MINUTO_FIN_PARTIDO_AUTOMATICO sin que nadie pulsara "Fin del
  -- partido" antes: 0 = finalizado normal, 1 = cierre automático sin
  -- cubrir. Se usa para pintar el aviso "FINALIZADO NO CUBIERTO" en la
  -- tabla de Resultados del panel admin (ver migracion_fin_no_cubierto.sql).
  finalizado_no_cubierto INTEGER NOT NULL DEFAULT 0,
  -- URL bonita y estable para la galería pública de este partido (ver
  -- migracion_galeria_partido_equipo_slug.sql). NULL hasta que el
  -- partido recibe su primera foto de galería.
  slug TEXT,
  FOREIGN KEY (autor_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_external_id
  ON results(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_slug
  ON results(slug) WHERE slug IS NOT NULL;

-- Alias de nombres de equipo entre la API externa de relleno automático
-- y el nombre "oficial" del sitio (ver public/js/clubs.js).
CREATE TABLE IF NOT EXISTS equipo_alias_externo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_externo TEXT NOT NULL UNIQUE,
  nombre_interno TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Control de la última sincronización automática de partidos (relleno
-- vía API externa). Una única fila fija, igual patrón que
-- newsletter_envios.
CREATE TABLE IF NOT EXISTS sync_partidos_auto (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_sync_at TEXT,
  ultimo_sync_ok INTEGER NOT NULL DEFAULT 1,
  ultimo_error TEXT
);
INSERT OR IGNORE INTO sync_partidos_auto (id, ultimo_sync_at) VALUES (1, NULL);

-- Cola de avisos de "partido posiblemente sin cubrir" pendientes de
-- enviarse en un único email resumen (ver migracion_avisos_desatendidos_cola.sql
-- para el porqué). NO se sincroniza con Postgres: cada backend lleva la suya.
CREATE TABLE IF NOT EXISTS avisos_desatendidos_cola (
  resultado_id INTEGER PRIMARY KEY,
  partido TEXT NOT NULL,
  jornada INTEGER,
  redactor TEXT,
  motivo_corto TEXT NOT NULL,
  encolado_ms INTEGER NOT NULL
);

-- Estado de los recordatorios automáticos a redactores inactivos (ver
-- migracion_recordatorios_inactividad.sql). NO se sincroniza con Postgres.
CREATE TABLE IF NOT EXISTS recordatorios_inactividad (
  user_id INTEGER PRIMARY KEY,
  ref_actividad TEXT NOT NULL,
  avisos_enviados INTEGER NOT NULL DEFAULT 0,
  ultimo_aviso_at TEXT,
  admins_avisados_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  var_motivo TEXT, -- solo para tipo "var": jugada que se revisa (gol, penalti, roja, amarilla, falta, fuera_juego, mano, otra)
  var_decision TEXT, -- solo para tipo "var": estado de la revisión (revisando, mantiene, cambia)
  es_penalti INTEGER NOT NULL DEFAULT 0, -- solo para tipo "gol": 1 si el gol fue de penalti durante el partido (no confundir con la tanda: "penalti_marcado")
  motivo_tarjeta TEXT, -- solo para tarjetas (amarilla, doble_amarilla, roja): motivo en texto libre ("Falta", "Protestas"...)
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

-- Newsletter / boletín semanal: personas suscritas desde el formulario
-- público (portada/pie de página) y control del último envío automático.
-- Ver worker/migracion_newsletter.sql para el detalle de columnas.
CREATE TABLE newsletter_suscriptores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  baja_token TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  baja_at TEXT
);
CREATE INDEX idx_newsletter_email ON newsletter_suscriptores(email);

CREATE TABLE newsletter_envios (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_envio_at TEXT
);
INSERT INTO newsletter_envios (id, ultimo_envio_at) VALUES (1, NULL);

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
  hash_archivo TEXT, -- SHA-256 del contenido; evita subir el mismo archivo dos veces (ver migracion_media_hash.sql)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (autor_id) REFERENCES users(id)
);

CREATE INDEX idx_media_created ON media(created_at);
CREATE UNIQUE INDEX idx_media_hash_unico ON media(hash_archivo) WHERE hash_archivo IS NOT NULL;

-- Galería de partido (ver migracion_match_gallery.sql para el
-- contexto completo y el porqué del diseño como tabla puente en vez
-- de una columna en "media"): vincula imágenes de "media" con un
-- partido concreto de "results", permitiendo que una misma imagen
-- pertenezca a varios partidos.
CREATE TABLE match_gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  vinculado_por_id INTEGER,
  -- De qué equipo es esta foto dentro de ESTE partido concreto: 'local',
  -- 'visitante' o NULL (foto general, sin equipo asignado). Alimenta las
  -- pestañas por equipo de la galería pública (ver
  -- migracion_galeria_partido_equipo_slug.sql).
  equipo TEXT,
  -- 1 = esta foto es la PORTADA de la galería de ESTE partido (obligatoria al
  -- crear la galería; como mucho una por partido). Ver
  -- migracion_galeria_portada.sql.
  es_portada INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
  FOREIGN KEY (vinculado_por_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_match_gallery_unico ON match_gallery(result_id, media_id);
CREATE INDEX idx_match_gallery_result ON match_gallery(result_id, orden);
CREATE INDEX idx_match_gallery_media ON match_gallery(media_id);

-- Galería/imágenes vinculadas a una noticia (ver
-- migracion_article_media.sql para el contexto completo, Fase 12): la
-- galería completa de un partido y/o imágenes sueltas de "media" que un
-- redactor adjunta a una noticia/crónica, aparte de las fotos que ya
-- lleve insertadas dentro del propio texto (articles.imagenes).
CREATE TABLE article_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_article_media_unico ON article_media(article_id, media_id);
CREATE INDEX idx_article_media_article ON article_media(article_id, orden);
CREATE INDEX idx_article_media_media ON article_media(media_id);

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
-- ver migracion_readers.sql para la explicación completa.
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

-- Sistema de Porras: predicciones de lectores para partidos de
-- "results". Ver worker/migracion_porras.sql para la explicación
-- completa del diseño (por qué puntos_obtenidos/resultado_acierto se
-- persisten en vez de calcularse siempre al vuelo, y el baremo de
-- puntos usado al resolver).
CREATE TABLE IF NOT EXISTS porras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  resultado_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  goles_local_predicho INTEGER NOT NULL,
  goles_visitante_predicho INTEGER NOT NULL,
  puntos_obtenidos INTEGER,
  resultado_acierto TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reader_id, resultado_id)
);
CREATE INDEX IF NOT EXISTS idx_porras_reader ON porras(reader_id);
CREATE INDEX IF NOT EXISTS idx_porras_resultado ON porras(resultado_id);

CREATE INDEX idx_articles_categoria ON articles(categoria);
CREATE INDEX idx_articles_publicado ON articles(publicado, fecha_publicacion);
CREATE INDEX idx_articles_autor_publicado ON articles(autor_id, publicado);
CREATE INDEX idx_articles_coautor_publicado ON articles(coautor_id, publicado);
CREATE INDEX idx_articles_fecha_publicacion ON articles(fecha_publicacion DESC);
CREATE INDEX idx_articles_categoria_fecha ON articles(categoria, fecha_publicacion DESC);
CREATE INDEX idx_articles_club_fecha ON articles(club, fecha_publicacion DESC);
CREATE INDEX idx_articles_tipo_fecha ON articles(tipo, fecha_publicacion DESC);
CREATE INDEX idx_articles_autor_fecha ON articles(autor_id, fecha_publicacion DESC);
CREATE INDEX idx_articles_autor_nombre ON articles(autor_nombre);
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
-- entrevista. Ver worker/migracion_comentarios.sql para el detalle, y
-- worker/migracion_votos_denuncias_comentarios.sql para likes/dislikes
-- y denuncias.
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
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  denuncias INTEGER NOT NULL DEFAULT 0,
  oculto_por_denuncia INTEGER NOT NULL DEFAULT 0,
  -- Cuenta de lector que escribió el comentario (si había iniciado
  -- sesión al enviarlo). NULL si comentó sin registrarse.
  reader_id INTEGER REFERENCES readers(id),
  FOREIGN KEY (moderado_por_id) REFERENCES users(id)
);
CREATE INDEX idx_comments_article ON comments(article_id, estado);
CREATE INDEX idx_comments_estado ON comments(estado, created_at);
CREATE INDEX idx_comments_reader ON comments(reader_id);

DROP TABLE IF EXISTS comment_votes;
CREATE TABLE comment_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  votante_id TEXT NOT NULL,
  valor INTEGER NOT NULL CHECK (valor IN (1, -1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (comment_id, votante_id)
);
CREATE INDEX idx_comment_votes_comment ON comment_votes(comment_id);

DROP TABLE IF EXISTS comment_reports;
CREATE TABLE comment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  denunciante_id TEXT NOT NULL,
  motivo TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revisado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (comment_id, denunciante_id)
);
CREATE INDEX idx_comment_reports_comment ON comment_reports(comment_id);
CREATE INDEX idx_comment_reports_revisado ON comment_reports(revisado, created_at);

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

-- Encuestas para lectores. Solo puede votar un lector con cuenta,
-- logueado y con el email verificado (mismo requisito que comentar).
-- Ver worker/migracion_encuestas.sql para el detalle.
DROP TABLE IF EXISTS polls;
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pregunta TEXT NOT NULL,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  en_portada INTEGER NOT NULL DEFAULT 0,
  orden_portada INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'abierta',
  cierra_en TEXT,
  autor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_polls_article ON polls(article_id);
CREATE INDEX idx_polls_portada ON polls(en_portada, orden_portada);
CREATE INDEX idx_polls_estado ON polls(estado);

DROP TABLE IF EXISTS poll_options;
CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_poll_options_poll ON poll_options(poll_id);

DROP TABLE IF EXISTS poll_votes;
CREATE TABLE poll_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  reader_id INTEGER NOT NULL REFERENCES readers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(poll_id, reader_id)
);
CREATE INDEX idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX idx_poll_votes_option ON poll_votes(option_id);

-- Tracking propio de vistas y tiempo de lectura, para el panel de
-- analíticas (ver worker/migracion_analiticas.sql para la versión no
-- destructiva de estas mismas tablas, pensada para bases ya desplegadas).
DROP TABLE IF EXISTS article_views;
CREATE TABLE article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitante_hash TEXT NOT NULL,
  -- Hash de IP+User-Agent SIN el día (a diferencia de visitante_hash,
  -- que sí lo incluye a propósito). Solo se usa para "lectores nuevos
  -- vs. recurrentes" -- ver migracion_analiticas_recurrencia.sql y
  -- calcularRecurrenciaAnaliticas() en src/index.js.
  visitante_estable TEXT,
  fuente TEXT NOT NULL DEFAULT 'directo',
  referer_dominio TEXT,
  dispositivo TEXT NOT NULL DEFAULT 'escritorio',
  -- Idioma en el que se leyó la noticia ('es','eu','ca','gl','en'), ver
  -- migracion_analiticas_idioma_partidos.sql y el selector de idioma de
  -- noticia.html.
  idioma TEXT NOT NULL DEFAULT 'es',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_article_views_article ON article_views(article_id);
CREATE INDEX idx_article_views_created ON article_views(created_at);
CREATE INDEX idx_article_views_visitante_dia ON article_views(visitante_hash, article_id, created_at);
CREATE INDEX idx_article_views_created_article ON article_views(created_at, article_id);
CREATE INDEX idx_article_views_idioma ON article_views(idioma);
CREATE INDEX idx_article_views_visitante_estable ON article_views(visitante_estable, created_at);

-- Una fila por cada carga de minuto-a-minuto.html (seguimiento público
-- de un partido). Alimenta "partidos más seguidos" en el panel de
-- analíticas -- ver migracion_analiticas_idioma_partidos.sql.
CREATE TABLE result_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  visitante_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_result_views_result ON result_views(result_id);
CREATE INDEX idx_result_views_created ON result_views(created_at);
CREATE INDEX idx_result_views_created_result ON result_views(created_at, result_id);

DROP TABLE IF EXISTS article_reading;
CREATE TABLE article_reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id INTEGER NOT NULL REFERENCES article_views(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  segundos INTEGER NOT NULL,
  scroll_maximo INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_article_reading_article ON article_reading(article_id);
CREATE INDEX idx_article_reading_created ON article_reading(created_at);
CREATE INDEX idx_article_reading_view ON article_reading(view_id);
CREATE INDEX idx_article_reading_created_article ON article_reading(created_at, article_id);


-- Tablas añadidas por migraciones posteriores (mantener schema.sql completo para montar una D1 desde cero y para los tests).
-- Origen: migracion_jugadores.sql
CREATE TABLE IF NOT EXISTS jugadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  club TEXT NOT NULL,
  nombre TEXT NOT NULL,
  dorsal INTEGER,
  oculto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jugador_alias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  club TEXT NOT NULL,
  clave TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club, clave)
);

CREATE INDEX IF NOT EXISTS idx_jugador_alias_jugador ON jugador_alias(jugador_id);
CREATE INDEX IF NOT EXISTS idx_jugadores_club ON jugadores(club);

-- Origen: migracion_lecturas_cuenta.sql
CREATE TABLE IF NOT EXISTS reader_saved_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reader_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_reader_saved_reader_fecha ON reader_saved_articles(reader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reader_saved_article ON reader_saved_articles(article_id);

CREATE TABLE IF NOT EXISTS reader_reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reader_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_reader_history_reader_fecha ON reader_reading_history(reader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reader_history_article ON reader_reading_history(article_id);

-- Columnas añadidas por migraciones posteriores (solo para montar una D1 desde cero; en producción ya están aplicadas).
-- migracion_2fa_admins.sql
ALTER TABLE users ADD COLUMN totp_secret TEXT;
-- migracion_2fa_admins.sql
ALTER TABLE users ADD COLUMN totp_activo INTEGER NOT NULL DEFAULT 0;
-- migracion_2fa_admins.sql
ALTER TABLE users ADD COLUMN totp_ultimo_paso INTEGER;
-- migracion_2fa_admins.sql
ALTER TABLE users ADD COLUMN totp_recovery TEXT;
-- migracion_anadido_anunciado.sql
ALTER TABLE results ADD COLUMN anadido_minutos INTEGER;
-- migracion_anadido_anunciado.sql
ALTER TABLE results ADD COLUMN anadido_parte INTEGER;
-- migracion_anadido_avisado.sql
ALTER TABLE results ADD COLUMN anadido_avisado INTEGER;
-- migracion_anadido_seguir.sql
ALTER TABLE results ADD COLUMN anadido_seguir INTEGER;
-- migracion_aviso_desatendido.sql
ALTER TABLE results ADD COLUMN aviso_desatendido_enviado INTEGER NOT NULL DEFAULT 0;
-- migracion_banner_urgente.sql
ALTER TABLE articles ADD COLUMN banner_urgente INTEGER NOT NULL DEFAULT 0;
-- migracion_banner_urgente.sql
ALTER TABLE articles ADD COLUMN banner_urgente_hasta TEXT;
-- migracion_comentarios_respuestas.sql
ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;
-- migracion_comentarios_respuestas.sql
ALTER TABLE comments ADD COLUMN responde_a_id INTEGER REFERENCES comments(id) ON DELETE SET NULL;
-- migracion_comentarios_respuestas.sql
ALTER TABLE comments ADD COLUMN aviso_aprobado INTEGER NOT NULL DEFAULT 0;
-- migracion_comentarios_respuestas.sql
ALTER TABLE comments ADD COLUMN respuesta_avisada INTEGER NOT NULL DEFAULT 0;
-- migracion_comentarios_respuestas.sql
ALTER TABLE readers ADD COLUMN avisos_comentarios INTEGER NOT NULL DEFAULT 1;
-- migracion_fase4_sync_tracking.sql
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_fase4_sync_tracking.sql
ALTER TABLE results ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_fase4_sync_tracking.sql
ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_fase4_sync_tracking.sql
ALTER TABLE edit_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_fase4_sync_tracking.sql
ALTER TABLE comments ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_fase4_sync_tracking.sql
ALTER TABLE club_info_solicitudes ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
-- migracion_formato_enlace.sql
ALTER TABLE articles ADD COLUMN usa_url_bonita INTEGER NOT NULL DEFAULT 1;
-- migracion_horario_manual.sql
ALTER TABLE results ADD COLUMN horario_manual INTEGER NOT NULL DEFAULT 0;
-- migracion_horario_publicacion.sql
ALTER TABLE articles ADD COLUMN fuera_calendario INTEGER NOT NULL DEFAULT 0;
-- migracion_media_carpetas.sql
ALTER TABLE media ADD COLUMN carpeta_id INTEGER REFERENCES media_carpetas(id) ON DELETE SET NULL;
-- migracion_media_portada.sql
ALTER TABLE media ADD COLUMN portada_segundo REAL;
-- migracion_media_portada_foco.sql
ALTER TABLE media ADD COLUMN portada_foco TEXT;
-- migracion_media_visibilidad.sql
ALTER TABLE media ADD COLUMN visibilidad TEXT NOT NULL DEFAULT 'publico';
-- migracion_niveles.sql
ALTER TABLE users ADD COLUMN nivel INTEGER NOT NULL DEFAULT 1;
-- migracion_niveles.sql
ALTER TABLE users ADD COLUMN nivel_nota TEXT;
-- migracion_origin_write_id.sql
ALTER TABLE articles ADD COLUMN origin_write_id TEXT;
-- migracion_origin_write_id.sql
ALTER TABLE results ADD COLUMN origin_write_id TEXT;
-- migracion_partidazo.sql
ALTER TABLE results ADD COLUMN partidazo INTEGER NOT NULL DEFAULT 0;
-- migracion_partidazo.sql
ALTER TABLE results ADD COLUMN partidazo_puntuacion INTEGER;
-- migracion_partidazo.sql
ALTER TABLE results ADD COLUMN partidazo_motivos TEXT;
-- migracion_perfil_lectores.sql
ALTER TABLE readers ADD COLUMN avatar_url TEXT;
-- migracion_permisos_redactores.sql
ALTER TABLE users ADD COLUMN ultima_hora_hash TEXT;
-- migracion_permisos_redactores.sql
ALTER TABLE users ADD COLUMN ultima_hora_salt TEXT;
-- migracion_readers_discord.sql
ALTER TABLE readers ADD COLUMN discord_id TEXT;
-- migracion_readers_google.sql
ALTER TABLE readers ADD COLUMN google_id TEXT;
-- migracion_readers_microsoft.sql
ALTER TABLE readers ADD COLUMN microsoft_id TEXT;
-- migracion_readers_x.sql
ALTER TABLE readers ADD COLUMN x_id TEXT;
-- migracion_recordatorios_inactividad_historial.sql
ALTER TABLE recordatorios_inactividad ADD COLUMN historial_avisos TEXT;
-- migracion_redes_destino.sql
ALTER TABLE articles ADD COLUMN redes_destino TEXT;
-- migracion_tienda.sql
ALTER TABLE users ADD COLUMN puede_gestionar_tienda INTEGER NOT NULL DEFAULT 0;
-- migracion_users_avatar_foco.sql
ALTER TABLE users ADD COLUMN avatar_foco TEXT;

-- Tablas creadas solo en migraciones (para montar una D1 desde cero y para los tests).
-- Origen: migracion_acreditaciones.sql
CREATE TABLE IF NOT EXISTS acreditaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  dni TEXT NOT NULL,
  equipo TEXT NOT NULL,
  tipo_evento TEXT NOT NULL,
  tipo_acreditacion TEXT NOT NULL,
  funciones TEXT NOT NULL,
  jornada_partido TEXT NOT NULL,
  confirmado INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  nota_admin TEXT,
  revisado_por TEXT,
  revisado_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acreditaciones_created ON acreditaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acreditaciones_estado ON acreditaciones(estado);

-- Origen: migracion_activity_log.sql
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_nombre TEXT NOT NULL,
  usuario_rol TEXT NOT NULL,
  accion TEXT NOT NULL,       
  entidad TEXT,               
  entidad_id TEXT,            
  descripcion TEXT NOT NULL,  
  detalle TEXT,               
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_usuario ON activity_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_activity_accion ON activity_log(accion);
CREATE INDEX IF NOT EXISTS idx_activity_entidad ON activity_log(entidad, entidad_id);

-- Origen: migracion_anuncios_destinatarios.sql
CREATE TABLE IF NOT EXISTS anuncios_email_destinatarios (
  anuncio_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (anuncio_id, email)
);

-- Origen: migracion_anuncios_email.sql
CREATE TABLE IF NOT EXISTS anuncios_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  
  
  audiencias TEXT NOT NULL,
  boton_texto TEXT,
  boton_url TEXT,
  creado_por_id INTEGER,
  creado_por_nombre TEXT,
  total_destinatarios INTEGER NOT NULL DEFAULT 0,
  enviados INTEGER NOT NULL DEFAULT 0,
  fallidos INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'enviando', 
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completado_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anuncios_email_created ON anuncios_email(created_at);

-- Origen: migracion_formularios.sql
CREATE TABLE IF NOT EXISTS formularios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  aviso TEXT NOT NULL DEFAULT '',
  texto_boton TEXT NOT NULL DEFAULT 'Enviar',
  mensaje_final TEXT NOT NULL DEFAULT '',
  campos TEXT NOT NULL DEFAULT '[]',
  acceso TEXT NOT NULL DEFAULT 'libre',
  pin TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  notificar_email INTEGER NOT NULL DEFAULT 1,
  creado_por TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formularios_created ON formularios(created_at DESC);

-- Origen: migracion_formularios.sql
CREATE TABLE IF NOT EXISTS formularios_respuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formulario_id INTEGER NOT NULL,
  datos TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'nueva',
  nota_admin TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formularios_respuestas_form ON formularios_respuestas(formulario_id, created_at DESC);

-- Origen: migracion_formularios_invitados.sql
CREATE TABLE IF NOT EXISTS formularios_invitados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formulario_id INTEGER NOT NULL,
  campo_id TEXT NOT NULL,
  opcion TEXT NOT NULL,
  opcion_norm TEXT NOT NULL,
  expira_at TEXT,
  creado_por TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formularios_invitados_unica ON formularios_invitados(formulario_id, campo_id, opcion_norm);
CREATE INDEX IF NOT EXISTS idx_formularios_invitados_form ON formularios_invitados(formulario_id, expira_at);

-- Origen: migracion_jornadas_calendario.sql
CREATE TABLE IF NOT EXISTS jornadas_calendario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competicion TEXT NOT NULL,
  grupo TEXT,
  jornada INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL, 
  fecha_fin TEXT NOT NULL,    
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jornadas_calendario_busqueda
  ON jornadas_calendario(competicion, grupo, fecha_inicio, fecha_fin);

-- Origen: migracion_media_carpetas.sql
CREATE TABLE IF NOT EXISTS media_carpetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  creada_por_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creada_por_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_carpetas_nombre ON media_carpetas(LOWER(nombre));

-- Origen: migracion_niveles.sql
CREATE TABLE IF NOT EXISTS nivel_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  usuario_nombre TEXT NOT NULL,
  nivel_anterior INTEGER NOT NULL,
  nivel_nuevo INTEGER NOT NULL,
  motivo TEXT,                        
  cambiado_por_id INTEGER,
  cambiado_por_nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES users(id),
  FOREIGN KEY (cambiado_por_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_nivel_historial_usuario ON nivel_historial(usuario_id);

-- Origen: migracion_noticias_rapidas.sql
CREATE TABLE IF NOT EXISTS noticias_rapidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  subtitulo TEXT NOT NULL,
  imagen_url TEXT NOT NULL,
  autor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_noticias_rapidas_created ON noticias_rapidas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_noticias_rapidas_autor ON noticias_rapidas(autor_id);

-- Origen: migracion_push.sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  noticias INTEGER NOT NULL DEFAULT 1,
  partidos INTEGER NOT NULL DEFAULT 1,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_noticias ON push_subscriptions(noticias);
CREATE INDEX IF NOT EXISTS idx_push_partidos ON push_subscriptions(partidos);

-- Origen: migracion_push_clubes.sql
CREATE TABLE IF NOT EXISTS push_subscription_clubs (
  subscription_id INTEGER NOT NULL,
  club TEXT NOT NULL,
  PRIMARY KEY (subscription_id, club)
);
CREATE INDEX IF NOT EXISTS idx_push_clubs_club ON push_subscription_clubs(club);

-- Origen: migracion_recordatorios_galeria.sql
CREATE TABLE IF NOT EXISTS recordatorios_galeria (
  acreditacion_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  email TEXT,
  enviado_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (acreditacion_id, result_id)
);

-- Origen: migracion_staff_push.sql
CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_push_user ON staff_push_subscriptions(user_id);

-- Origen: migracion_staff_push.sql
CREATE TABLE IF NOT EXISTS staff_push_prefs (
  user_id INTEGER NOT NULL,
  categoria TEXT NOT NULL,
  PRIMARY KEY (user_id, categoria)
);
CREATE INDEX IF NOT EXISTS idx_staff_push_prefs_cat ON staff_push_prefs(categoria);

-- Origen: migracion_tienda.sql
CREATE TABLE IF NOT EXISTS tienda_productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  
  
  precio_centimos INTEGER NOT NULL,
  imagen_url TEXT,
  
  
  
  variantes TEXT,
  
  
  
  
  requiere_para_acreditacion INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Origen: migracion_tienda.sql
CREATE TABLE IF NOT EXISTS tienda_pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  producto_id INTEGER NOT NULL,
  
  
  
  producto_nombre TEXT NOT NULL,
  variante TEXT,
  precio_centimos INTEGER NOT NULL,
  
  
  
  
  
  
  estado TEXT NOT NULL DEFAULT 'pendiente_pago',
  
  
  
  referencia_pago TEXT,
  
  
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

-- Origen: migracion_votaciones_internas.sql
CREATE TABLE IF NOT EXISTS votaciones_internas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  multiple INTEGER NOT NULL DEFAULT 0,
  anonima INTEGER NOT NULL DEFAULT 0,
  resultados_visibles TEXT NOT NULL DEFAULT 'tras_votar',
  cierra_en TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta',
  creado_por INTEGER REFERENCES users(id),
  creado_por_nombre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cerrada_en TEXT
);

-- Origen: migracion_votaciones_internas.sql
CREATE TABLE IF NOT EXISTS votaciones_internas_opciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_votint_opciones_votacion ON votaciones_internas_opciones(votacion_id);

-- Origen: migracion_votaciones_internas.sql
CREATE TABLE IF NOT EXISTS votaciones_internas_votos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL REFERENCES votaciones_internas(id) ON DELETE CASCADE,
  opcion_id INTEGER NOT NULL REFERENCES votaciones_internas_opciones(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(opcion_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_votint_votos_votacion ON votaciones_internas_votos(votacion_id);
CREATE INDEX IF NOT EXISTS idx_votint_votos_usuario ON votaciones_internas_votos(usuario_id, votacion_id);


-- Feedback de revisores a redactores: aviso al autor cuando se aprueba,
-- programa o devuelve su pieza (con nota breve del revisor) y observaciones
-- sueltas. article_id puede quedar a NULL si la noticia se borra: por eso
-- se guarda también el título (article_titulo).
--   tipo: aprobada | programada | cambios | observacion
CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  article_titulo TEXT NOT NULL DEFAULT '',
  article_slug TEXT,
  destinatario_id INTEGER NOT NULL,
  autor_feedback_id INTEGER,
  autor_feedback_nombre TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'observacion',
  nota TEXT,
  leido INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_feedback_dest ON article_feedback(destinatario_id, leido, created_at);
CREATE INDEX IF NOT EXISTS idx_article_feedback_updated ON article_feedback(updated_at);
