// ElOtroFútbol - Worker API
// Rutas: /api/login, /api/me, /api/me/sesiones, /api/articles, /api/results, /api/media, /api/custom-clubs, /api/articles/:id/comments, /api/admin/comments, /api/club-info, /api/admin/club-info, /sitemap-noticias.xml, /sitemap-news.xml, /rss.xml

// Escapa los caracteres especiales de XML para que un título o slug con
// "&", "<", ">", comillas, etc. no rompa el XML del sitemap.
function escaparXml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Convierte una fecha guardada por la base de datos ("YYYY-MM-DD
// HH:MM:SS", UTC) o un ISO string en el formato de fecha simple
// "YYYY-MM-DD" que espera <lastmod> en un sitemap. Si no hay fecha o no
// se puede parsear, se omite (mejor no mandar <lastmod> que uno inventado
// o mal formado).
function fechaParaSitemap(valor) {
  if (!valor) return null;
  const fecha = new Date(valor.includes("T") || valor.endsWith("Z") ? valor : `${valor.replace(" ", "T")}Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().slice(0, 10);
}


// Convierte una fecha a texto en el mismo formato que usa SQLite para
// datetime('now') ("YYYY-MM-DD HH:MM:SS", en UTC, sin milisegundos ni
// separador "T"/"Z"). Es imprescindible guardar "programado_para" con
// este formato exacto: al ser una columna TEXT, la comparación
// "programado_para <= datetime('now')" del disparador programado es una
// comparación de texto, no de fechas, así que un ISO string normal
// (con "T"/"Z"/milisegundos) nunca es "menor o igual" aunque la hora ya
// haya pasado, y las noticias programadas se quedarían sin publicar.
function aSqliteDatetimeUTC(fecha) {
  return fecha.toISOString().slice(0, 19).replace("T", " ");
}

// Convierte una fecha guardada por SQLite o un ISO string al formato
// RFC-822 que exige la especificación RSS 2.0 para <pubDate>
// (p.ej. "Tue, 18 Aug 2026 10:00:00 GMT"). Si no hay fecha o no se
// puede parsear, se omite (igual que fechaParaSitemap con <lastmod>).
function fechaParaRss(valor) {
  if (!valor) return null;
  const fecha = new Date(valor.includes("T") || valor.endsWith("Z") ? valor : `${valor.replace(" ", "T")}Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toUTCString();
}

// Quita etiquetas HTML y colapsa espacios para obtener un extracto de
// texto plano a partir del contenido (HTML) de una noticia, usable como
// <description> en RSS. Trunca a "limite" caracteres sin cortar una
// palabra a la mitad.
function extractoTexto(html, limite = 300) {
  const texto = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (texto.length <= limite) return texto;
  return texto.slice(0, texto.lastIndexOf(" ", limite)) + "…";
}

// "fecha_partido" se guarda tal cual la escribe el redactor en el
// <input type="datetime-local"> del panel (hora de Madrid, SIN
// información de zona horaria: "2026-08-08T15:40"), pero tanto el reloj
// del cron como Date.now() trabajan en UTC. Sin corregir el desfase, un
// partido puesto a las 15:40 no arrancaba solo hasta las 17:40 (CEST,
// UTC+2) o las 16:40 (CET, UTC+1) según la época del año.
//
// Devuelve el desplazamiento en minutos que hay que RESTAR a una fecha
// interpretada como Madrid para obtener el instante UTC real
// equivalente (p.ej. 120 en horario de verano, 60 en horario de
// invierno). Se calcula pidiéndole al motor de Intl el offset vigente
// en Madrid para el instante indicado (por defecto, ahora), así el
// cambio de hora de primavera/otoño se gestiona solo, sin tablas de
// fechas hardcodeadas.
function offsetMadridEnMinutos(instante = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  // Instante que esos mismos "dígitos de reloj" representarían si
  // fuesen UTC, comparado con el instante real: la diferencia es el
  // offset de Madrid en ese momento (Date.UTC no lanza nunca).
  const comoSiFueraUTC = Date.UTC(
    partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second
  );
  return Math.round((comoSiFueraUTC - instante.getTime()) / 60000);
}

// Convierte "fecha_partido" (hora de Madrid, formato "YYYY-MM-DDTHH:MM")
// al datetime UTC equivalente en formato SQLite ("YYYY-MM-DD HH:MM:SS"),
// para poder compararlo con datetime('now') sin desfase horario. null si
// no trae hora (solo fecha, longitud distinta de 16).
function fechaPartidoAUtcSqlite(fechaPartido) {
  if (!fechaPartido || fechaPartido.length !== 16) return null;
  const comoSiFueraUTC = new Date(`${fechaPartido}:00Z`);
  if (isNaN(comoSiFueraUTC.getTime())) return null;
  const offset = offsetMadridEnMinutos(comoSiFueraUTC);
  const real = new Date(comoSiFueraUTC.getTime() - offset * 60000);
  return aSqliteDatetimeUTC(real);
}

function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return resp;
}
function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    // "no-store" evita que Cloudflare (u otro caché intermedio) sirva una
    // respuesta antigua para peticiones GET repetidas a la misma URL, como
    // pasaba con /api/results/:id al refrescar el modal de partido: sin
    // esta cabecera el marcador/estado podían quedarse "pegados" al primer
    // valor que se pidió, aunque los eventos sí se actualizaran.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
}

// ---------- Utils crypto ----------
function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes.buffer;
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBuf(saltHex), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}
function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return bufToHex(arr.buffer);
}

// ---------- Traducciones de artículos ----------
// Idiomas a los que se puede traducir una noticia/crónica, además del
// castellano (que es siempre el idioma base, obligatorio). La traducción
// a cada uno es opcional: la hace el propio redactor al subir o editar
// el artículo, no hay traducción automática.
const IDIOMAS_TRADUCCION = ["eu", "ca", "gl", "en"];

// Un idioma se considera "traducido" (disponible) cuando tiene, como
// mínimo, título Y contenido. El subtítulo es opcional incluso dentro
// de un idioma ya traducido (igual que en castellano). Se centraliza
// aquí para que backend y frontend usen exactamente el mismo criterio.
function idiomaCompleto(campos) {
  return Boolean(campos.titulo && campos.contenido);
}

// Normaliza un valor de texto venido del body: recorta espacios y
// convierte cadenas vacías (o solo espacios) en null. Cualquier valor
// no-string (undefined, null, número raro) también se resuelve a null,
// para que nunca se cuele algo distinto de TEXT|NULL en la BD.
function normalizarTexto(valor) {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio ? limpio : null;
}

// Construye, a partir del body recibido, los pares columna->valor para
// las columnas _eu/_ca/_gl/_en de titulo/subtitulo/contenido. Si el
// redactor no ha escrito nada en un idioma (o lo ha borrado), se guarda
// NULL para que esa noticia se marque como no disponible en ese idioma.
//
// Regla de integridad: si un idioma tiene subtítulo y/o contenido pero
// falta el título (por ejemplo el redactor borró solo el título por
// error), ese idioma se descarta entero -> los tres campos van a NULL.
// Así se evita el estado inconsistente "hay traducción pero sin título",
// que rompería el selector de idioma y el listado de artículos.
// Si en cambio falta el contenido (con o sin título), el idioma tampoco
// se considera válido, por el mismo motivo: una noticia sin cuerpo no es
// una traducción utilizable.
function extraerTraducciones(body) {
  const campos = {};
  const avisos = [];
  for (const idioma of IDIOMAS_TRADUCCION) {
    const t = (body.traducciones && body.traducciones[idioma]) || {};
    const titulo = normalizarTexto(t.titulo);
    const subtitulo = normalizarTexto(t.subtitulo);
    const contenido = normalizarTexto(t.contenido);

    if (idiomaCompleto({ titulo, contenido })) {
      campos[`titulo_${idioma}`] = titulo;
      campos[`subtitulo_${idioma}`] = subtitulo;
      campos[`contenido_${idioma}`] = contenido;
    } else {
      // Incompleto: se descarta el idioma entero, pero si había algo
      // escrito se avisa en la respuesta para que el redactor lo sepa
      // (evita que un texto a medias "desaparezca" en silencio).
      if (titulo || subtitulo || contenido) {
        avisos.push(
          `${idioma}: falta ${titulo ? "" : "título"}${!titulo && !contenido ? " y " : ""}${contenido ? "" : "contenido"} — no se ha guardado esta traducción.`
        );
      }
      campos[`titulo_${idioma}`] = null;
      campos[`subtitulo_${idioma}`] = null;
      campos[`contenido_${idioma}`] = null;
    }
  }
  return { campos, avisos };
}

// Añade a un artículo ya leído de la BD el campo "idiomas_disponibles":
// la lista de idiomas (además de "es", siempre presente) que tienen al
// menos título y contenido traducidos. Lo usa el frontend para el
// selector de idioma y para el aviso "Disponible en...".
function conIdiomasDisponibles(article) {
  const idiomas_disponibles = ["es"];
  for (const idioma of IDIOMAS_TRADUCCION) {
    if (idiomaCompleto({ titulo: article[`titulo_${idioma}`], contenido: article[`contenido_${idioma}`] })) {
      idiomas_disponibles.push(idioma);
    }
  }
  return { ...article, idiomas_disponibles, imagen_foco: focoDePortada(article) };
}

// El foco de recorte ("qué parte de la foto no se debe recortar nunca")
// se guarda por cada foto dentro del array "imagenes", no en la columna
// "imagen_url". Para que las tarjetas, el hero y las mini-cards de la
// portada respeten ese mismo foco (y no solo la foto grande del
// artículo), se busca aquí la foto del array que coincide con la
// portada (imagen_url) y se expone su foco como "imagen_foco" en cada
// artículo devuelto por la API. Si no hay foco guardado, se usa el
// centro ("50% 50%"), que es lo mismo que hacía object-position antes.
//
// La comparación no puede ser un simple "===": hay noticias donde la
// URL guardada en "imagen_url" y la guardada dentro del array difieren
// en detalles que no cambian la imagen real (espacios sueltos, mayúsculas
// en el dominio, "http" vs "https", o una barra final), normalmente
// porque la portada se guardó en momentos distintos del array. Por eso
// se compara también una versión normalizada de la URL antes de rendirse
// y caer en la primera foto del array (que es la portada por diseño
// según el esquema de la tabla).
function normalizarUrlImagen(u) {
  if (typeof u !== "string") return "";
  try {
    return decodeURIComponent(u.trim()).toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  } catch {
    return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function focoDePortada(article) {
  if (!article || !article.imagenes) return "50% 50%";
  let imagenes;
  try {
    imagenes = typeof article.imagenes === "string" ? JSON.parse(article.imagenes) : article.imagenes;
  } catch {
    return "50% 50%";
  }
  if (!Array.isArray(imagenes) || imagenes.length === 0) return "50% 50%";

  // 1) Coincidencia exacta de URL.
  let portada = imagenes.find((img) => img && img.url === article.imagen_url);

  // 2) Si no coincide exactamente, se prueba con la URL normalizada.
  if (!portada && article.imagen_url) {
    const objetivo = normalizarUrlImagen(article.imagen_url);
    portada = imagenes.find((img) => img && normalizarUrlImagen(img.url) === objetivo);
  }

  // 3) Si sigue sin encontrarse, se usa la primera foto del array, que
  // es la portada por defecto según el diseño original de la tabla.
  if (!portada) portada = imagenes[0];

  return (portada && portada.foco) || "50% 50%";
}

// ---------- Notificaciones por correo ----------
// Avisa a la redacción por email cada vez que se sube contenido (fotos/vídeos)
// o se publica una crónica. Usa Resend (mismo servicio que TGN Fan Shop).
// Requiere el secreto RESEND_API_KEY (wrangler secret put RESEND_API_KEY).
// Si no está configurado, o falla el envío, no rompe la subida: solo se
// registra el error en los logs del Worker.
const EMAIL_NOTIFICACIONES = "elotrofutbolmedio@gmail.com";
const SITIO_URL = "https://elotrofutbol.media";

function escapeHtmlEmail(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Plantilla HTML compartida por todos los avisos: cabecera con el logo
// sobre fondo marino, franja roja de acento, una etiqueta de tipo, título,
// una lista de datos clave (autor, club, etc.) y un botón de acción.
// Todo con estilos en línea (tablas) porque así es como hay que maquetar
// para que se vea bien en Gmail, Outlook, etc.
function plantillaEmail({ etiqueta, titulo, filas = [], parrafo, boton }) {
  const filasHtml = filas
    .filter((f) => f && f.valor)
    .map(
      (f) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#9aa0ab;width:110px;vertical-align:top;">${escapeHtmlEmail(f.etiqueta)}</td>
          <td style="padding:6px 0;font-size:14px;color:#0c1b2e;font-weight:600;">${escapeHtmlEmail(f.valor)}</td>
        </tr>`
    )
    .join("");

  const botonHtml = boton
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
        <tr>
          <td style="border-radius:24px;background:#d1132e;">
            <a href="${boton.url}" style="display:inline-block;padding:12px 26px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtmlEmail(boton.texto)}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 18px rgba(12,27,46,.12);">
          <tr>
            <td style="background:#0c1b2e;padding:22px 28px;">
              <img src="${SITIO_URL}/img/logo.png" alt="ELOTROFÚTBOLTV" height="34" style="display:block;">
            </td>
          </tr>
          <tr><td style="height:4px;background:#d1132e;line-height:0;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <span style="display:inline-block;background:#eef1f5;color:#d1132e;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:4px 11px;border-radius:12px;">${escapeHtmlEmail(etiqueta)}</span>
              <h1 style="margin:14px 0 6px;font-size:21px;line-height:1.3;color:#0c1b2e;">${escapeHtmlEmail(titulo)}</h1>
              ${parrafo ? `<p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#5a6270;">${escapeHtmlEmail(parrafo)}</p>` : ""}
            </td>
          </tr>
          ${filasHtml ? `
          <tr>
            <td style="padding:6px 28px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#eef1f5;border-radius:8px;padding:14px 16px;">
                ${filasHtml}
              </table>
            </td>
          </tr>` : ""}
          <tr>
            <td style="padding:8px 28px 34px;">
              ${botonHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f7f8fa;border-top:1px solid #eee;">
              <p style="margin:0;font-size:11.5px;color:#9aa0ab;">Aviso automático de ELOTROFÚTBOLTV · No hace falta responder a este correo.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function enviarEmailNotificacion(env, { asunto, texto, html }, { destinatario } = {}) {
  if (!env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY no configurado: aviso por email omitido ->", asunto);
    return;
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "ELOTROFÚTBOLTV <notificaciones@elotrofutbol.media>",
        to: [destinatario || EMAIL_NOTIFICACIONES],
        subject: asunto,
        text: texto,
        html: html || undefined,
      }),
    });
    if (!resp.ok) {
      console.log("Error al enviar email de notificación:", resp.status, await resp.text());
    }
  } catch (err) {
    console.log("Error al enviar email de notificación:", err.message);
  }
}

function emailValido(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
// ---------- Equipos de un usuario (hasta 3 clubes) ----------
// Se guardan en la columna "equipo" como un array JSON en texto, p. ej.
// '["Real Madrid","FC Barcelona"]'. Antes era un unico club en texto
// plano; parsearEquipos() sigue aceptando ese formato antiguo (lo
// convierte en un array de un elemento) para no romper datos ya
// guardados. Un admin puede asignar hasta 3 equipos a cada persona
// desde "Usuarios"; la propia persona solo puede consultarlos, nunca
// editarlos, desde "Mis datos".
function parsearEquipos(valor) {
  if (!valor) return [];
  try {
    const parsed = JSON.parse(valor);
    if (Array.isArray(parsed)) return parsed.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim());
  } catch {
    if (typeof valor === "string" && valor.trim()) return [valor.trim()];
  }
  return [];
}
// Valida y normaliza la lista de equipos recibida del panel: hasta 3
// equipos (0, 1, 2 o 3 son validos), sin duplicados ni vacios. Devuelve
// { error } si no cumple, o { equipos } con el array ya limpio.
function validarEquipos(valorRecibido) {
  let lista = [];
  if (Array.isArray(valorRecibido)) {
    lista = valorRecibido;
  } else if (typeof valorRecibido === "string" && valorRecibido.trim()) {
    lista = [valorRecibido];
  }
  const limpios = [...new Set(lista.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim()))];
  if (limpios.length > 3) return { error: "Puedes seleccionar como maximo 3 equipos." };
  return { equipos: limpios };
}

// ---------- "Última hora": PIN de 4 dígitos único y compartido ----------
// Permite a cualquier redactor publicar directamente (sin pasar por
// borrador) una noticia/crónica/opinión/entrevista puntual y urgente.
// No es un PIN por persona: es un único PIN aleatorio, guardado en la
// tabla settings, que solo puede ver un admin desde el panel. Cada vez
// que se usa correctamente para publicar, se regenera automáticamente,
// así que un PIN que se ha filtrado o compartido de más solo sirve
// para esa publicación.
function validarPin4Digitos(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}
function generarPin4Digitos() {
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  // 0000-9999, con el 0 a la izquierda si hace falta.
  const n = Math.floor((arr[0] / 256) * 10000);
  return String(n).padStart(4, "0");
}
async function obtenerUltimaHoraPin(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ultima_hora_pin'").first();
  return row ? row.value : null;
}
async function regenerarUltimaHoraPin(env) {
  const nuevo = generarPin4Digitos();
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('ultima_hora_pin', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(nuevo).run();
  return nuevo;
}
async function comprobarUltimaHora(env, pinRecibido) {
  if (!validarPin4Digitos(pinRecibido)) return false;
  const actual = await obtenerUltimaHoraPin(env);
  if (!actual || pinRecibido !== actual) return false;
  // Correcto: se regenera de inmediato para que no se pueda reutilizar.
  await regenerarUltimaHoraPin(env);
  return true;
}

// ---------- Publicación directa según el nivel del colaborador ----------
// A partir del sistema de niveles, un redactor de Nivel 2 o superior ya
// no necesita el PIN de "Última hora" para publicar directamente: la
// confianza de poder publicar sin revisión se la da su nivel. Un
// redactor de Nivel 1 (o sin nivel, por compatibilidad con datos
// antiguos) sigue exactamente igual que antes: todo pasa por revisión
// salvo que use el PIN de "Última hora" para ese caso puntual. Se
// consulta el nivel siempre en la base de datos (no se guarda en el
// JWT) para que un ascenso o descenso de nivel tenga efecto inmediato,
// sin esperar a que la persona vuelva a iniciar sesión.
async function obtenerNivelUsuario(env, uid) {
  const user = await env.DB.prepare("SELECT nivel, rol FROM users WHERE id = ?").bind(uid).first();
  if (user && user.rol === "admin") return NIVEL_MAXIMO;
  return (user && user.nivel) || 1;
}

function generatePassword(length = 10) {
  // Excluye caracteres fácilmente confundibles (0/O, 1/l/I) al mostrarla
  // en pantalla para dársela a la persona.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => chars[b % chars.length]).join("");
}

// ---------- JWT (HS256) ----------
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJSON(obj) {
  return b64url(JSON.stringify(obj));
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}
async function signHS256(data, secret) {
  if (!secret) {
    // Sin esta comprobación, un JWT_SECRET vacío/undefined revienta más
    // abajo en crypto.subtle.importKey con "Zero-length key is not
    // supported" -- un mensaje que no menciona la causa real (falta
    // configurar la variable de entorno) y que aparece igual de críptico
    // tanto al firmar un login nuevo como al verificar un token existente.
    throw new Error("JWT_SECRET no está configurado (variable de entorno vacía o ausente)");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}
async function createJWT(payload, secret, expiresInSec = 60 * 60 * 12) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const data = `${b64urlJSON(header)}.${b64urlJSON(fullPayload)}`;
  const sig = await signHS256(data, secret);
  return `${data}.${sig}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = await signHS256(`${h}.${p}`, secret);
  if (expected !== s) return null;
  const payload = JSON.parse(b64urlDecode(p));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
async function requireAuth(request, env, url) {
  const auth = request.headers.get("Authorization") || "";
  let token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  // La descarga se abre como enlace normal del navegador (no un fetch),
  // así que no puede llevar cabecera Authorization; en ese caso concreto
  // se acepta también el token como parámetro ?token= de la URL.
  if (!token && url) token = url.searchParams.get("token");
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  // Además de que el JWT en sí sea válido, la sesión (fila en la tabla
  // "sessions") tiene que seguir existiendo y no estar revocada: así,
  // cerrar una sesión desde "Mis sesiones" la invalida al momento aunque
  // el JWT todavía no haya caducado. Los JWT antiguos (emitidos antes de
  // este cambio) no llevan "sid"; se siguen aceptando hasta que caduquen
  // por sí solos, para no desconectar a todo el mundo de golpe.
  //
  // IMPORTANTE (secundaria/Railway): esta base de datos es una RÉPLICA de
  // D1, que recibe las sesiones nuevas con el retraso propio del
  // sincronizador (por defecto hasta 60s, ver sync/scheduler.mjs). Si se
  // exige aquí "la fila existe y no está revocada" igual que en la
  // primaria, cualquier login o petición que llegue a la secundaria antes
  // de que su sesión se haya sincronizado se rechaza como si el usuario no
  // estuviera autenticado — en la práctica, esto tumbaba TODO el panel de
  // administración durante un failover (todas las rutas protegidas usan
  // requireAuth), mientras que las rutas públicas sin auth (como
  // /api/results) seguían funcionando con normalidad, dando la falsa
  // impresión de que "solo resultados funciona en la secundaria".
  //
  // La distinción correcta es entre "la fila NO existe todavía" (aún no
  // sincronizada: el JWT ya demuestra que hubo un login válido, así que se
  // deja pasar) y "la fila SÍ existe pero está revocada" (alguien cerró
  // esa sesión explícitamente: eso sí debe bloquear, y ya habrá llegado a
  // la secundaria en cuanto se sincronice el cierre de sesión).
  if (payload.sid) {
    const sesion = await env.DB.prepare(
      "SELECT id, revoked_at FROM sessions WHERE id = ? AND user_id = ?"
    ).bind(payload.sid, payload.uid).first();
    if (sesion && sesion.revoked_at) return null;
    if (sesion) {
      // No bloqueamos la respuesta por esto: es solo para que la lista de
      // "Mis sesiones" muestre cuándo se ha usado cada una por última vez.
      env.DB.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?")
        .bind(payload.sid).run().catch(() => {});
    } else {
      // FIX SEGURIDAD (2026-08): "sesion === null" es ambiguo. Puede
      // significar de verdad "aún no sincronizada" (retraso normal del
      // sincronizador, hasta ~60s) o puede significar "el sincronizador
      // está caído/no desplegado y esta fila JAMÁS va a llegar" -- por
      // ejemplo, si alguien revocó esta sesión hace horas y el proceso
      // sync/scheduler.mjs lleva parado desde entonces. Sin distinguir
      // ambos casos, un JWT robado o de una sesión cerrada explícitamente
      // se aceptaría en la secundaria de forma indefinida, precisamente
      // en el escenario donde más importa (failover con la primaria caída).
      //
      // Se comprueba la frescura real del sincronizador consultando
      // sync_cursor para la tabla "sessions" (actualizado por
      // sync/incremental.mjs en cada pasada que toca esa tabla). Si el
      // cursor está más desactualizado que UMBRAL_SYNC_STALE_MS, se
      // considera que el sincronizador no está operativo y se falla
      // cerrado (se rechaza el token) en vez de fiarse ciegamente del JWT.
      //
      // Margen elegido: 5 minutos. El intervalo normal del scheduler es de
      // 60s (SYNC_INTERVAL_MS), así que 5 minutos da margen de sobra para
      // picos de carga o un reintento puntual sin generar falsos rechazos,
      // pero sigue detectando un sincronizador realmente caído mucho antes
      // de que se convierta en un problema de horas o días.
      const UMBRAL_SYNC_STALE_MS = 5 * 60 * 1000;
      let sincronizadorSano = false;
      try {
        const cursorSessions = await env.DB.prepare(
          "SELECT last_synced_at FROM sync_cursor WHERE table_name = ?"
        ).bind("sessions").first();
        if (cursorSessions && cursorSessions.last_synced_at) {
          const antiguedadMs = Date.now() - new Date(cursorSessions.last_synced_at).getTime();
          sincronizadorSano = antiguedadMs <= UMBRAL_SYNC_STALE_MS;
        }
        // Si no hay fila de cursor todavía (p. ej. justo tras el
        // despliegue inicial, antes de la primera pasada), no se puede
        // afirmar que el sincronizador esté sano: se trata igual que
        // "caído" y se falla cerrado, por prudencia.
      } catch (error) {
        // Si ni siquiera se puede leer sync_cursor (tabla no migrada,
        // Postgres con problemas, etc.), tampoco hay forma de confiar en
        // que la sincronización esté funcionando: se falla cerrado.
        console.error("[requireAuth] no se pudo comprobar sync_cursor de sessions:", error.message);
        sincronizadorSano = false;
      }
      if (!sincronizadorSano) return null;
      // El sincronizador está operativo y al día: se asume que esta fila
      // en concreto todavía no ha llegado por el retraso normal de una
      // pasada (segundos), no porque esté todo caído. El JWT firmado con
      // JWT_SECRET es prueba suficiente de que el login fue legítimo.
    }
  }
  return payload;
}

// ---------- Sesiones (dispositivos con la sesión iniciada) ----------
function generarIdSesion() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Convierte la cabecera User-Agent en una descripción legible tipo
// "Chrome en Windows" o "Safari en iPhone", para que cada persona
// reconozca de un vistazo qué dispositivo es cada sesión. Es una
// heurística sencilla (no una librería de detección completa), pero
// cubre bien los casos habituales.
function describirDispositivo(userAgent) {
  const ua = userAgent || "";
  let so = "Dispositivo desconocido";
  if (/iPhone/i.test(ua)) so = "iPhone";
  else if (/iPad/i.test(ua)) so = "iPad";
  else if (/Android/i.test(ua)) so = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) so = "Mac";
  else if (/Windows/i.test(ua)) so = "Windows";
  else if (/Linux/i.test(ua)) so = "Linux";

  let navegador = "Navegador desconocido";
  if (/Edg\//i.test(ua)) navegador = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) navegador = "Opera";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) navegador = "Chrome";
  else if (/CriOS/i.test(ua)) navegador = "Chrome";
  else if (/FxiOS/i.test(ua)) navegador = "Firefox";
  else if (/Firefox\//i.test(ua)) navegador = "Firefox";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) navegador = "Safari";

  return `${navegador} en ${so}`;
}

// Crea la fila de sesión en la BD y el JWT correspondiente (con el "sid"
// incrustado), en un único paso: se usa tanto al iniciar sesión como en
// cualquier sitio que hasta ahora emitía un token nuevo (cambio de
// nombre, etc.), para que esos casos también queden como sesiones
// listables y cerrables.
//
// "Mismo dispositivo" se aproxima por user_id + user_agent: si ya hay una
// sesión sin revocar de ese usuario con ese mismo User-Agent, se reutiliza
// esa misma fila (se actualiza IP y last_seen_at y se le asigna un JWT
// nuevo) en vez de insertar otra. Así, cerrar sesión y volver a entrar
// desde el mismo navegador no duplica la entrada en "Mis sesiones": solo
// hay una fila por dispositivo, no una por cada inicio de sesión.
async function crearSesion(env, request, user) {
  const userAgent = request.headers.get("User-Agent") || null;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || null;

  const existente = await env.DB.prepare(
    `SELECT id FROM sessions WHERE user_id = ? AND user_agent IS ? AND revoked_at IS NULL
     ORDER BY last_seen_at DESC LIMIT 1`
  ).bind(user.id, userAgent).first();

  let id;
  if (existente) {
    id = existente.id;
    await env.DB.prepare(
      `UPDATE sessions SET ip = ?, last_seen_at = datetime('now') WHERE id = ?`
    ).bind(ip, id).run();
  } else {
    id = generarIdSesion();
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, user_agent, ip) VALUES (?, ?, ?, ?)`
    ).bind(id, user.id, userAgent, ip).run();
  }

  const token = await createJWT(
    { uid: user.id, username: user.username, nombre: user.nombre, rol: user.rol, sid: id },
    env.JWT_SECRET
  );
  return token;
}

// ---------- Cloudinary ----------
// Sustituye a R2/Drive: los archivos de "Subir contenido" se guardan en
// Cloudinary. Solo hacen falta 3 credenciales fijas (cloud name, api key,
// api secret) que da el panel al crear la cuenta —nada de OAuth ni
// consola de Google Cloud—, y el plan gratis (25 créditos/mes) no cobra
// automáticamente al superarse: avisa y, si no se amplía el plan,
// desactiva la cuenta. Ver README para cómo obtener las credenciales.
async function sha1Hex(text) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-1", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Sube un archivo a Cloudinary sin ninguna transformación (se conserva la
// calidad original). Devuelve { publicId, resourceType, url }.
async function subirACloudinary(env, fileBytes, mimeType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);

  const form = new FormData();
  form.append("file", new Blob([fileBytes], { type: mimeType }));
  form.append("api_key", env.CLOUDINARY_API_KEY);
  form.append("timestamp", timestamp.toString());
  form.append("signature", signature);

  const resp = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    throw new Error("Error al subir a Cloudinary: " + (await resp.text()));
  }
  const data = await resp.json();
  return { publicId: data.public_id, resourceType: data.resource_type, url: data.secure_url };
}

// ---------- Validación de archivos subidos (imágenes y vídeos) ----------
// Punto único de configuración: tanto "Subir contenido" (/api/media,
// fotos y vídeos de la mediateca) como "Subir imagen suelta"
// (/api/subir-imagen, usado en la foto de perfil y en las fotos de una
// noticia/crónica) validan el archivo aquí antes de tocar Cloudinary, así
// los formatos admitidos, los límites de tamaño y los mensajes de error
// son siempre los mismos en toda la web en vez de estar duplicados (y
// potencialmente desincronizados) en cada sitio donde se sube algo.
const TIPOS_IMAGEN_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const TIPOS_VIDEO_PERMITIDOS = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/mpeg"];
// Las imágenes no tienen límite de tamaño propio: Cloudinary y el límite
// de payload de Workers son los únicos topes reales.
const LIMITE_VIDEO_BYTES = 90 * 1024 * 1024; // 90 MB (el plan gratis de Workers corta la petición entera a los 100 MB)

function esImagenPermitida(mimeType) {
  return TIPOS_IMAGEN_PERMITIDOS.includes(mimeType);
}

// Devuelve un mensaje de error si el archivo no es válido, o null si se
// puede subir. `permitirVideo` distingue el caso de "Subir contenido"
// (admite fotos y vídeos) del de "Subir imagen suelta" (solo fotos).
function validarArchivoSubida(file, { permitirVideo = false } = {}) {
  if (!file || typeof file === "string") return "Falta el archivo";
  if (esImagenPermitida(file.type)) {
    return null;
  }
  if (permitirVideo && TIPOS_VIDEO_PERMITIDOS.includes(file.type)) {
    if (file.size > LIMITE_VIDEO_BYTES) return "El vídeo no puede superar los 90 MB";
    return null;
  }
  return permitirVideo
    ? "Solo se admiten fotos (JPG, PNG, WEBP, GIF, AVIF) o vídeos (MP4, MOV, WEBM, MKV, MPEG)"
    : "Solo se admiten imágenes en un formato compatible (JPG, PNG, WEBP, GIF o AVIF)";
}

// Valida el archivo y, si es correcto, lo sube a Cloudinary tal cual
// llega, sin recomprimir ni transformar. Lanza un error con
// `esValidacion: true` cuando el problema es el propio archivo (para
// devolver un 400 con el mensaje tal cual), y un error normal si falla
// la subida a Cloudinary (para devolver un 502).
async function procesarSubidaArchivo(env, file, opciones) {
  const errorValidacion = validarArchivoSubida(file, opciones);
  if (errorValidacion) {
    const error = new Error(errorValidacion);
    error.esValidacion = true;
    throw error;
  }
  const fileBytes = await file.arrayBuffer();
  return subirACloudinary(env, fileBytes, file.type);
}

async function borrarDeCloudinary(env, publicId, resourceType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", env.CLOUDINARY_API_KEY);
  form.append("timestamp", timestamp.toString());
  form.append("signature", signature);

  return fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`, {
    method: "POST",
    body: form,
  });
}

// Posiciones válidas para cada foto (que no sea la portada, que siempre
// se muestra arriba del todo) dentro de una noticia/crónica: "inicio"
// la inserta al principio del cuerpo del texto; "personalizada" la inserta
// tras el número de párrafo indicado en "trasParrafo"; "galeria" la deja
// en la tira de miniaturas final (comportamiento clásico). Se sigue
// aceptando en la validación "medio"/"final" (formato antiguo) para no
// romper noticias ya guardadas antes de este cambio.
// "collage" es una foto que forma parte de un collage personalizable
// (varias fotos combinadas en una sola cuadrícula dentro del texto): se
// comporta, a efectos de posición dentro del artículo, igual que
// "inicio"/"personalizada" (usa también "trasParrafo"), pero varias
// fotos comparten el mismo "grupo" (id de collage) y "plantilla" (2, 3 o
// 4 fotos, con la disposición concreta dentro de esa plantilla).
const POSICIONES_IMAGEN_VALIDAS = ["inicio", "personalizada", "medio", "final", "galeria", "collage"];
// Plantillas de collage admitidas: cuántas fotos lleva cada una. La
// disposición visual concreta de cada plantilla la decide el CSS
// (public/css/style.css, .collage-<plantilla>), no el backend.
const PLANTILLAS_COLLAGE_VALIDAS = ["2-horizontal", "2-vertical", "3-una-grande", "3-fila", "4-cuadricula"];

// Normaliza el array de fotos de una noticia/crónica. Admite tanto el
// formato antiguo (array de URLs en texto plano) como el nuevo, con un
// objeto por foto que además guarda en qué posición del texto se debe
// insertar y el punto de la imagen que no se debe recortar nunca (el
// "foco", en formato CSS object-position, p. ej. "50% 30%").
// Competiciones para las que tiene sentido enlazar el partido finalizado
// con su ficha en Flashscore (Primera Federación, Segunda Federación y
// LaLiga Hypermotion, que es la LaLiga2 actual). Los amistosos y el resto
// de competiciones nunca guardan este enlace, aunque venga en el body.
const COMPETICIONES_CON_FLASHSCORE = ["hypermotion", "primera_federacion", "segunda_federacion"];
function flashscoreUrlValido(competicion, estado, url) {
  if (!url) return null;
  if (!COMPETICIONES_CON_FLASHSCORE.includes(competicion)) return null;
  if (estado !== "finalizado") return null;
  const limpia = String(url).trim();
  return limpia || null;
}

function normalizarImagenes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const url = item.trim();
        return url ? { url, posicion: "galeria", foco: "50% 50%" } : null;
      }
      if (item && typeof item === "object" && typeof item.url === "string") {
        const url = item.url.trim();
        if (!url) return null;
        const posicion = POSICIONES_IMAGEN_VALIDAS.includes(item.posicion) ? item.posicion : "galeria";
        const foco = typeof item.foco === "string" && /^\d{1,3}% \d{1,3}%$/.test(item.foco.trim()) ? item.foco.trim() : "50% 50%";
        const resultado = { url, posicion, foco };
        if (posicion === "personalizada" || posicion === "collage") {
          const n = parseInt(item.trasParrafo, 10);
          resultado.trasParrafo = Number.isFinite(n) && n > 0 ? n : 1;
        }
        if (posicion === "collage") {
          // "grupo" identifica qué fotos van juntas en el mismo collage
          // (varias filas del array pueden compartir el mismo id de
          // grupo); "plantilla" es la disposición elegida para ese
          // grupo y se repite igual en todas sus fotos.
          resultado.grupo = typeof item.grupo === "string" && item.grupo.trim() ? item.grupo.trim() : "collage-1";
          resultado.plantilla = PLANTILLAS_COLLAGE_VALIDAS.includes(item.plantilla) ? item.plantilla : "2-horizontal";
        }
        // Crédito/cita de la fotografía (autor, agencia...), opcional.
        if (typeof item.credito === "string" && item.credito.trim()) {
          resultado.credito = item.credito.trim();
        }
        return resultado;
      }
      return null;
    })
    .filter(Boolean);
}

// ---------- Alineaciones ----------
// Devuelve las alineaciones (normalmente 0, 1 o 2: local y visitante)
// ligadas a una noticia o a un partido, ya con "jugadores" convertido de
// JSON guardado a array de verdad, listas para mandar al frontend.
async function obtenerAlineaciones(env, columna, id) {
  if (!id) return [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM alineaciones WHERE ${columna} = ? ORDER BY id ASC`
  ).bind(id).all();
  return (results || []).map((a) => {
    try {
      a.jugadores = JSON.parse(a.jugadores || "[]");
    } catch {
      a.jugadores = [];
    }
    return a;
  });
}

// Valida y normaliza el array de jugadores que manda el editor visual
// del panel: descarta entradas sin nombre, recorta dorsales/coordenadas
// a rangos razonables y no deja pasar campos inesperados.
function normalizarJugadoresAlineacion(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((j) => {
      if (!j || typeof j !== "object") return null;
      const nombre = typeof j.nombre === "string" ? j.nombre.trim() : "";
      if (!nombre) return null;
      const titular = j.titular !== false;
      const jugador = {
        nombre,
        dorsal: Number.isFinite(parseInt(j.dorsal, 10)) ? parseInt(j.dorsal, 10) : null,
        titular,
      };
      if (titular) {
        jugador.x = Math.max(0, Math.min(100, Number.isFinite(+j.x) ? +j.x : 50));
        jugador.y = Math.max(0, Math.min(100, Number.isFinite(+j.y) ? +j.y : 50));
      }
      return jugador;
    })
    .filter(Boolean)
    .slice(0, 30); // 11 titulares + suplentes razonables, tope de seguridad
}

// ---------- Historial de acciones (auditoría, solo admins) ----------
// Deja constancia de cada acción relevante que hace cada persona
// (quién, qué, cuándo y sobre qué), para que un admin pueda revisar la
// actividad del equipo desde el panel ("Historial"). No debe romper
// nunca la operación principal: si falla el registro, solo se anota en
// los logs del Worker.
async function registrarActividad(env, request, payload, { accion, entidad = null, entidad_id = null, descripcion, detalle = null }) {
  try {
    // "request" puede venir vacío cuando la actividad la registra el propio
    // sistema (p. ej. el disparador programado publicando una noticia) y no
    // hay ninguna petición HTTP de por medio.
    const ip = request ? (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || null) : null;
    await env.DB.prepare(
      `INSERT INTO activity_log (usuario_id, usuario_nombre, usuario_rol, accion, entidad, entidad_id, descripcion, detalle, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      payload?.uid ?? null,
      payload?.nombre ?? "Desconocido",
      payload?.rol ?? "desconocido",
      accion,
      entidad,
      entidad_id !== null && entidad_id !== undefined ? String(entidad_id) : null,
      descripcion,
      detalle ? JSON.stringify(detalle) : null,
      ip
    ).run();
  } catch (err) {
    console.log("Error al registrar actividad:", err.message);
  }
}

function slugify(text) {
  return text
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
}

// Genera un slug único a partir de un título, evitando choques con el
// slug de otro artículo (o con un slug antiguo ya guardado en
// article_slug_redirects, para no reutilizar por error un enlace que
// todavía puede estar circulando apuntando a otra noticia).
// "idPropio" es el id del propio artículo (al editar), para no chocar
// contra su propio slug actual si el título no ha cambiado de verdad.
async function slugUnico(env, titulo, idPropio) {
  let base = slugify(titulo);
  if (!base) base = "noticia";
  let slug = base;
  let intento = 0;
  while (true) {
    const chocaConArticulo = await env.DB.prepare(
      "SELECT id FROM articles WHERE slug = ? AND id != ?"
    ).bind(slug, idPropio || -1).first();
    const chocaConRedirect = await env.DB.prepare(
      "SELECT article_id FROM article_slug_redirects WHERE slug_antiguo = ? AND article_id != ?"
    ).bind(slug, idPropio || -1).first();
    if (!chocaConArticulo && !chocaConRedirect) return slug;
    intento++;
    slug = `${base}-${intento > 1 ? intento : Date.now().toString().slice(-5)}`;
  }
}

// Al guardar un artículo cuyo slug ha cambiado (porque todavía no está
// "congelado", ver slug_congelado en schema.sql), guarda el slug antiguo
// en article_slug_redirects para que quien entre con el enlace viejo se
// redirija automáticamente al nuevo, en vez de encontrarse un "no
// encontrada". No hace nada si el slug no ha cambiado.
async function registrarRedirectSiCambia(env, articleId, slugAntiguo, slugNuevo) {
  if (!slugAntiguo || slugAntiguo === slugNuevo) return;
  await env.DB.prepare(
    `INSERT INTO article_slug_redirects (slug_antiguo, article_id) VALUES (?, ?)
     ON CONFLICT(slug_antiguo) DO UPDATE SET article_id = excluded.article_id, created_at = datetime('now')`
  ).bind(slugAntiguo, articleId).run();
  // Si alguna redirección antigua apuntaba precisamente al slug nuevo que
  // acabamos de "liberar" en otro artículo... no debería darse (slugUnico
  // ya evita choques), así que no hace falta contemplarlo aquí.
}

// Cuenta los caracteres de texto "real" de una noticia/crónica, quitando
// las etiquetas HTML del editor (para que el mínimo/máximo se aplique al
// texto que de verdad va a leer la persona, no a las marcas de formato).
function longitudTextoPlano(html) {
  if (!html) return 0;
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim().length;
}

const CONTENIDO_MIN = 2000;
const CONTENIDO_MAX = 8000;

// ---------- Sistema de niveles y recompensas ----------
// Umbrales de publicaciones (contenido PUBLICADO, no borradores) que
// hacen falta para poder OPTAR a cada nivel. Cumplirlos no sube el
// nivel automáticamente (lo decide un admin, ver PUT /api/users/:id/nivel);
// esto es solo lo que se usa para calcular el progreso y decir si la
// persona "ya está en condiciones de que la evalúen".
const NIVELES_REQUISITOS = {
  1: null, // Principiante: nivel inicial, no requiere nada.
  2: { noticia: 30, cronica: 15, opinion: 3, entrevista: 1 },
  3: { noticia: 50, cronica: 25, opinion: 4, entrevista: 1 },
  4: { noticia: 60, cronica: 30, opinion: 6, entrevista: 2 },
};

const NIVELES_INFO = {
  1: {
    nombre: "Principiante", emoji: "🟢",
    descripcion: "Todo el contenido pasa por revisión de un administrador antes de publicarse.",
  },
  2: {
    nombre: "Aprendiz", emoji: "🔵",
    descripcion: "Publica noticias, crónicas y artículos de opinión sin revisión previa.",
  },
  3: {
    nombre: "Maestro", emoji: "🟣",
    descripcion: "Publicación sin revisión + puede publicar contenido del medio en Instagram y TikTok.",
  },
  4: {
    nombre: "Experto", emoji: "🟠",
    descripcion: "Puede revisar y corregir noticias de otros, optar al consejo de administración y a coordinaciones.",
  },
};

// Cuenta, por tipo, cuántos artículos PUBLICADOS tiene un autor. Se
// cuentan solo publicados (publicado = 1): un borrador o una noticia
// programada todavía no cuenta como "trabajo demostrado". Se cuentan
// tanto los artículos en los que la persona es autora principal como
// aquellos en los que firma como coautora: si ayudó a sacar la noticia
// adelante, debe contarle igual para su progreso de nivel, no solo al
// autor principal.
async function contarPublicacionesPorTipo(env, autorId) {
  const { results } = await env.DB.prepare(
    `SELECT tipo, COUNT(*) AS total FROM articles
     WHERE (autor_id = ? OR coautor_id = ?) AND publicado = 1
     GROUP BY tipo`
  ).bind(autorId, autorId).all();
  const conteo = { noticia: 0, cronica: 0, opinion: 0, entrevista: 0 };
  for (const fila of results) {
    if (conteo[fila.tipo] !== undefined) conteo[fila.tipo] = fila.total;
  }
  return conteo;
}

// Dado el conteo actual de publicaciones, calcula el detalle de
// progreso hacia un nivel concreto (cuánto lleva y cuánto le falta de
// cada tipo) y si ya cumple todas las cifras mínimas.
function calcularProgresoNivel(conteo, requisitos) {
  if (!requisitos) return { cumple: true, detalle: [] };
  const detalle = Object.entries(requisitos).map(([tipo, necesarios]) => ({
    tipo,
    actual: conteo[tipo] || 0,
    necesarios,
    cumple: (conteo[tipo] || 0) >= necesarios,
  }));
  return { cumple: detalle.every((d) => d.cumple), detalle };
}

// Construye el objeto de progreso completo de un usuario: nivel
// actual, conteo de publicaciones, progreso hacia el siguiente nivel
// (si existe uno por encima de NIVEL_MAXIMO) y si ya está en
// condiciones de que un admin lo evalúe para el ascenso.
const NIVEL_MAXIMO = 4;

async function construirProgresoNivel(env, usuario) {
  // Los admins publican directamente, revisan todo y no tienen que
  // demostrar nada con cifras: a efectos de "Mi progreso" y de la
  // tabla de Usuarios se muestran siempre en el nivel máximo, aunque
  // en la columna `nivel` de la base de datos se queden en 1 por
  // defecto (ver migracion_niveles.sql). Como es rol, no cifra, no
  // tiene sentido calcular ni mostrar progreso hacia "el siguiente
  // nivel": no hay ninguno por encima.
  const esAdmin = usuario.rol === "admin";
  const nivelActual = esAdmin ? NIVEL_MAXIMO : (usuario.nivel || 1);
  const conteo = await contarPublicacionesPorTipo(env, usuario.id);
  const siguienteNivel = !esAdmin && nivelActual < NIVEL_MAXIMO ? nivelActual + 1 : null;
  const progresoSiguiente = siguienteNivel
    ? calcularProgresoNivel(conteo, NIVELES_REQUISITOS[siguienteNivel])
    : null;

  return {
    nivel_actual: nivelActual,
    nivel_info: NIVELES_INFO[nivelActual] || NIVELES_INFO[1],
    nivel_nota: esAdmin ? null : (usuario.nivel_nota || null),
    publicaciones: conteo,
    nivel_maximo: nivelActual >= NIVEL_MAXIMO,
    es_admin: esAdmin,
    siguiente_nivel: siguienteNivel,
    siguiente_nivel_info: siguienteNivel ? NIVELES_INFO[siguienteNivel] : null,
    progreso: progresoSiguiente
      ? {
          cumple_requisitos: progresoSiguiente.cumple,
          detalle: progresoSiguiente.detalle,
        }
      : null,
  };
}

// ---------- Permisos por autor + solicitudes de edición ----------
// Minutos que dura el permiso de edición sobre una entidad concreta una
// vez aprobada una solicitud (tiempo de sobra para hacer la edición sin
// tener que estar pidiéndolo cada vez, pero sin dejarlo abierto para
// siempre: pasado este tiempo, si quiere volver a tocarlo tiene que
// pedirlo de nuevo).
const EDIT_GRANT_MINUTOS = 120;

// Comprueba si "payload" (el usuario autenticado) puede editar/borrar la
// entidad indicada: un admin siempre puede; un redactor solo si es el
// autor, o si tiene una solicitud aprobada y todavía dentro de la
// ventana de tiempo concedida para esa entidad exacta.
async function puedeEditarEntidad(env, payload, tipoEntidad, autorId) {
  if (payload.rol === "admin") return true;
  if (autorId && autorId === payload.uid) return true;
  return false; // el permiso temporal por solicitud se comprueba aparte con id de entidad
}

async function tienePermisoTemporal(env, payload, tipoEntidad, entidadId) {
  if (payload.rol === "admin") return true;
  const permiso = await env.DB.prepare(
    `SELECT id FROM edit_requests
     WHERE tipo_entidad = ? AND entidad_id = ? AND solicitante_id = ? AND estado = 'aprobada'
       AND permiso_expira_at IS NOT NULL AND permiso_expira_at > datetime('now')
     ORDER BY resuelta_at DESC LIMIT 1`
  ).bind(tipoEntidad, entidadId, payload.uid).first();
  return Boolean(permiso);
}

// Combina las tres comprobaciones: autoría directa (o coautoría, si se
// pasa), nivel 4 (revisa/corrige contenido de cualquiera sin tener que
// pedir permiso, ver documento de niveles), o permiso temporal
// concedido por una solicitud aprobada.
// El atajo de Nivel 4 solo aplica a "articulo" (noticias, crónicas,
// opinión, entrevistas), que es lo que dice el documento de niveles.
// Para "resultado" (marcadores, minuto a minuto, cronómetro en vivo)
// se deja fuera a propósito: es contenido operativo, no editorial, y
// tocar el minuto a minuto de un partido que otra persona está
// gestionando en directo tiene mucho más riesgo que corregir un texto.
async function puedeEditar(env, payload, tipoEntidad, entidadId, autorId, coautorId) {
  if (payload.rol === "admin") return true;
  if (autorId && autorId === payload.uid) return true;
  if (coautorId && coautorId === payload.uid) return true;
  if (tipoEntidad === "articulo") {
    const nivel = await obtenerNivelUsuario(env, payload.uid);
    if (nivel >= 4) return true;
  }
  return tienePermisoTemporal(env, payload, tipoEntidad, entidadId);
}

// Publica las noticias programadas cuyo "programado_para" ya se ha
// cumplido (usado por el disparador programado, ver "scheduled" más
// abajo). Se publican todas las que toquen en cada ejecución, no solo
// una, por si el disparador ha tardado en pasar por lo que sea.
// ---------- MINUTO A MINUTO: arranque automático del cronómetro ----------
// Única función que "arranca" un partido, la use quien la use (cron,
// botón manual de "En juego", o "Iniciar partido" del panel). Así nunca
// hay un partido en_juego sin cronómetro corriendo, sea cual sea el
// camino por el que se puso en_juego.
//
//   minutoInicial: minuto en el que debe arrancar a contar el reloj (0
//   normalmente; >0 cuando se arranca tarde, ver más abajo).
async function iniciarCronometroPartido(env, resultadoId, minutoInicial = 0) {
  const minutos = Number.isFinite(minutoInicial) && minutoInicial > 0 ? Math.floor(minutoInicial) : 0;
  await env.DB.prepare(
    `UPDATE results SET inicio_cronometro_at = datetime('now', ?), cronometro_pausado_en = NULL,
       ajuste_cronometro_minutos = 0, estado = 'en_juego' WHERE id = ?`
  ).bind(`-${minutos} minutes`, resultadoId).run();
}

// Revisa cada minuto (mismo cron que ya revisaba artículos programados)
// los partidos "programado" cuya fecha_partido ya haya llegado, y los
// pasa a "en_juego" arrancando el cronómetro desde 0 en ese instante.
// Si el cron tarda en pasar (el propio cron trigger de Cloudflare no es
// al segundo exacto) el minuto empieza a contar desde 0 igualmente: el
// desfase de esos segundos/minuto es asumible y no afecta al resto de
// la lógica (mismo criterio que ya usa "Iniciar partido" manual).
async function iniciarPartidosProgramadosCuyaHoraHaLlegado(env) {
  // "fecha_partido" es hora de Madrid tal cual la escribió el redactor,
  // no UTC (ver fechaPartidoAUtcSqlite más arriba). Comparar su texto
  // directamente contra datetime('now') -que sí es UTC- desfasaba el
  // arranque automático 1-2h según la época del año. Se filtran primero
  // en SQL los candidatos con hora conocida y aún "programado" (barato),
  // y la comparación fina de instante ya corregida se hace en JS.
  const { results: candidatos } = await env.DB.prepare(
    `SELECT id, fecha_partido FROM results
     WHERE estado = 'programado' AND fecha_partido IS NOT NULL
       AND length(fecha_partido) = 16` // "YYYY-MM-DDTHH:MM": solo si se conoce la hora, no solo la fecha
  ).all();
  const ahoraSqlite = aSqliteDatetimeUTC(new Date());
  const pendientes = candidatos.filter((p) => {
    const inicioUtc = fechaPartidoAUtcSqlite(p.fecha_partido);
    return inicioUtc !== null && inicioUtc <= ahoraSqlite;
  });
  for (const partido of pendientes) {
    await iniciarCronometroPartido(env, partido.id, 0);
    // Comprobación defensiva por si, justo en el minuto en que pasa el
    // cron, el redactor ha pulsado "Iniciar partido" a mano casi a la
    // vez: sin esto podían colarse dos "Comienza el partido" para el
    // mismo encuentro (ver también la comprobación gemela en el POST de
    // /eventos, que cubre el caso opuesto: cron primero, botón después).
    const yaTieneInicio = await env.DB.prepare(
      "SELECT id FROM match_events WHERE resultado_id = ? AND tipo = 'inicio_partido' LIMIT 1"
    ).bind(partido.id).first();
    if (yaTieneInicio) continue;
    await env.DB.prepare(
      `INSERT INTO match_events (resultado_id, tipo, equipo, minuto, orden) VALUES (?, 'inicio_partido', 'ninguno', 0, 0)`
    ).bind(partido.id).run();
  }
}

// ---------- MINUTO A MINUTO: aviso de partido "desatendido" ----------
// Detecta partidos que llevan el cronómetro corriendo (nadie ha pulsado
// "Descanso" ni "Fin del partido") mucho más allá de lo normal, señal
// de que el redactor asignado se ha despistado o se ha ido y el
// partido se ha quedado sin nadie cubriéndolo desde el panel. Antes de
// este aviso, un partido podía llegar al minuto 80 sin que se hubiera
// pitado ni el descanso porque nadie estaba mirando el panel.
//
// Dos situaciones se consideran "desatendido":
//   1) El cronómetro sigue corriendo (no pausado) y ya ha superado el
//      minuto UMBRAL_PRIMERA_PARTE_SIN_DESCANSO sin que exista un
//      evento "descanso" registrado: la primera parte no dura tanto en
//      ningún partido real, así que el reloj se ha "olvidado" corriendo.
//   2) El cronómetro está pausado en el descanso (evento "descanso" es
//      el último evento de tipo pausa) desde hace más de
//      UMBRAL_DESCANSO_SIN_REANUDAR minutos: el redactor no ha pulsado
//      "Iniciar 2ª parte".
// Se manda como máximo un aviso por email por cada mitad del partido
// (al autor del partido, con copia a EMAIL_NOTIFICACIONES si no tiene
// correo): uno para la 1ª parte y otro, independiente, para la 2ª. Se
// guarda en aviso_desatendido_mitad qué mitades ya han avisado, para no
// repetirlo cada minuto (el cron pasa cada minuto) ni tampoco varias
// veces dentro de la misma mitad si hay algún toque suelto de por medio
// -- así se evita mandar una "petada" de correos seguidos por un solo
// partido desatendido.
const UMBRAL_PRIMERA_PARTE_SIN_DESCANSO = 55; // minutos
const UMBRAL_SEGUNDA_PARTE_SIN_FINAL = 100; // minutos (aprox. 2ª parte + prórroga larga)
const UMBRAL_DESCANSO_SIN_REANUDAR = 25; // minutos parado en el descanso

function minutoEnVivoServidor(resultado) {
  if (resultado.cronometro_pausado_en !== null && resultado.cronometro_pausado_en !== undefined) {
    return resultado.cronometro_pausado_en;
  }
  if (!resultado.inicio_cronometro_at) return 0;
  const inicioMs = new Date(String(resultado.inicio_cronometro_at).replace(" ", "T") + "Z").getTime();
  if (isNaN(inicioMs)) return 0;
  const ajuste = Number.isInteger(resultado.ajuste_cronometro_minutos) ? resultado.ajuste_cronometro_minutos : 0;
  return Math.max(0, Math.floor((Date.now() - inicioMs) / 60000) + ajuste);
}

async function revisarPartidosDesatendidos(env, ctx) {
  const { results: partidos } = await env.DB.prepare(
    `SELECT id, competicion, jornada, equipo_local, equipo_visitante, autor_id, autor_nombre,
            inicio_cronometro_at, cronometro_pausado_en, ajuste_cronometro_minutos,
            aviso_desatendido_mitad
     FROM results WHERE estado = 'en_juego'`
  ).all();
  if (!partidos.length) return;

  for (const partido of partidos) {
    const corriendo = partido.cronometro_pausado_en === null || partido.cronometro_pausado_en === undefined;
    const minuto = minutoEnVivoServidor(partido);

    // A qué mitad del partido pertenece la situación de riesgo detectada,
    // para repartir como mucho un aviso por mitad (ver comentario de la
    // columna aviso_desatendido_mitad) en vez de un único aviso para todo
    // el partido: así un partido que se queda desatendido en la 1ª parte
    // y luego, tras retomarlo, vuelve a quedarse desatendido en la 2ª,
    // puede avisar de nuevo esa segunda vez en lugar de quedarse callado.
    let motivo = null;
    let mitad = null;
    if (corriendo && minuto >= UMBRAL_SEGUNDA_PARTE_SIN_FINAL) {
      motivo = `El cronómetro sigue corriendo y ya marca el minuto ${minuto} sin que se haya registrado el final del partido.`;
      mitad = "segunda";
    } else if (corriendo && minuto >= UMBRAL_PRIMERA_PARTE_SIN_DESCANSO) {
      const yaHuboDescanso = await env.DB.prepare(
        "SELECT id FROM match_events WHERE resultado_id = ? AND tipo = 'descanso' LIMIT 1"
      ).bind(partido.id).first();
      if (!yaHuboDescanso) {
        motivo = `El cronómetro sigue corriendo y ya marca el minuto ${minuto} sin que se haya pitado el descanso.`;
        mitad = "primera";
      } else {
        // Ya hubo descanso pero el cronómetro sigue corriendo por encima
        // del umbral de la 1ª parte: en realidad ya estamos en la 2ª.
        motivo = `El cronómetro sigue corriendo y ya marca el minuto ${minuto} sin que se haya registrado el final del partido.`;
        mitad = "segunda";
      }
    } else if (!corriendo) {
      const ultimaPausa = await env.DB.prepare(
        `SELECT tipo, created_at FROM match_events WHERE resultado_id = ? AND tipo IN ('descanso', 'pausa_hidratacion')
         ORDER BY id DESC LIMIT 1`
      ).bind(partido.id).first();
      if (ultimaPausa && ultimaPausa.tipo === "descanso") {
        const desdeMs = new Date(String(ultimaPausa.created_at).replace(" ", "T") + "Z").getTime();
        const minutosParado = isNaN(desdeMs) ? 0 : Math.floor((Date.now() - desdeMs) / 60000);
        if (minutosParado >= UMBRAL_DESCANSO_SIN_REANUDAR) {
          motivo = `El partido lleva parado en el descanso ${minutosParado} minutos sin que se haya iniciado la 2ª parte.`;
          // El descanso es la frontera entre mitades: se cuenta como
          // aviso de la 1ª parte (es el cierre pendiente de esa mitad).
          mitad = "primera";
        }
      }
    }

    const mitadesAvisadas = (partido.aviso_desatendido_mitad || "").split("_").filter(Boolean);

    if (!motivo) {
      // Si el partido ya no está en situación de riesgo pero se había
      // avisado antes, no se toca nada: cada mitad solo se limpia
      // cuando termina el partido o se reinicia desde cero (abajo),
      // así no se vuelve a avisar dentro de la misma mitad nada más
      // resolverse un despiste puntual.
      continue;
    }
    if (mitadesAvisadas.includes(mitad)) continue; // ya avisado en esta mitad, no se repite

    const nuevoValor = [...new Set([...mitadesAvisadas, mitad])].join("_");
    await env.DB.prepare("UPDATE results SET aviso_desatendido_mitad = ? WHERE id = ?").bind(nuevoValor, partido.id).run();

    let destinatario = EMAIL_NOTIFICACIONES;
    if (partido.autor_id) {
      const autor = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(partido.autor_id).first();
      if (autor?.email) destinatario = autor.email;
    }
    const nombrePartido = `${partido.equipo_local} - ${partido.equipo_visitante}`;
    const enlacePanel = `${SITIO_URL}/admin/minuto-a-minuto.html?id=${partido.id}`;

    const enviar = enviarEmailNotificacion(env, {
      asunto: `⚠️ Partido posiblemente sin cubrir: ${nombrePartido}`,
      texto: `${motivo}\n\nPartido: ${nombrePartido} (jornada ${partido.jornada})\nRedactor asignado: ${partido.autor_nombre || "sin asignar"}\n\nRevisa el panel de Minuto a Minuto: ${enlacePanel}`,
      html: plantillaEmail({
        etiqueta: "Aviso automático",
        titulo: "Partido posiblemente sin cubrir",
        parrafo: motivo,
        filas: [
          { etiqueta: "Partido", valor: nombrePartido },
          { etiqueta: "Jornada", valor: String(partido.jornada) },
          { etiqueta: "Redactor", valor: partido.autor_nombre || "Sin asignar" },
        ],
        boton: { texto: "Abrir Minuto a Minuto", url: enlacePanel },
      }),
    }, { destinatario });

    // Si el aviso va al autor, se manda también copia a la cuenta
    // general de notificaciones para que un admin pueda intervenir
    // aunque el redactor no vea el correo a tiempo.
    if (destinatario !== EMAIL_NOTIFICACIONES) {
      ctx.waitUntil(enviar);
      ctx.waitUntil(enviarEmailNotificacion(env, {
        asunto: `⚠️ Partido posiblemente sin cubrir: ${nombrePartido}`,
        texto: `${motivo}\n\nPartido: ${nombrePartido} (jornada ${partido.jornada})\nRedactor asignado: ${partido.autor_nombre || "sin asignar"}\n\nRevisa el panel de Minuto a Minuto: ${enlacePanel}`,
      }, { destinatario: EMAIL_NOTIFICACIONES }));
    } else {
      ctx.waitUntil(enviar);
    }

    await registrarActividad(env, null, { uid: null, nombre: "Vigilancia de partidos", rol: "sistema" }, {
      accion: "aviso_partido_desatendido", entidad: "resultado", entidad_id: partido.id,
      descripcion: `Aviso automático: ${nombrePartido} — ${motivo}`,
    });
  }
}

async function publicarArticulosProgramados(env) {
  const { results: pendientes } = await env.DB.prepare(
    `SELECT id, slug, titulo, subtitulo, tipo, categoria, club, autor_nombre, coautor_nombre, imagen_url
     FROM articles
     WHERE publicado = 0 AND programado_para IS NOT NULL AND programado_para <= datetime('now')`
  ).all();

  for (const articulo of pendientes) {
    const fechaPublicacion = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE articles SET publicado = 1, programado_para = NULL, slug_congelado = 1, fecha_publicacion = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(articulo.id).run();

    const tipoLabel = { noticia: "Noticia", cronica: "Crónica", opinion: "Opinión", entrevista: "Entrevista" }[articulo.tipo] || "Artículo";
    const firmaAutores = articulo.coautor_nombre ? `${articulo.autor_nombre} y ${articulo.coautor_nombre}` : articulo.autor_nombre;

    await enviarEmailNotificacion(env, {
      asunto: `Nueva ${tipoLabel.toLowerCase()} publicada (programada): ${articulo.titulo}`,
      texto: `Se ha publicado automáticamente, tal y como estaba programada, "${articulo.titulo}" (${tipoLabel}) en ELOTROFÚTBOLTV, firmada por ${firmaAutores}.\n\nVerla en la web: ${SITIO_URL}/noticia.html?slug=${articulo.slug}`,
      html: plantillaEmail({
        etiqueta: `Nueva ${tipoLabel.toLowerCase()} (programada)`,
        titulo: articulo.titulo,
        parrafo: articulo.subtitulo || null,
        filas: [
          { etiqueta: "Autor", valor: firmaAutores },
          { etiqueta: "Categoría", valor: articulo.club || articulo.categoria },
        ],
        boton: { texto: "Ver la noticia", url: `${SITIO_URL}/noticia.html?slug=${articulo.slug}` },
      }),
    });

    await registrarActividad(env, null, { uid: null, nombre: "Publicación programada", rol: "sistema" }, {
      accion: "publicar_articulo_programado", entidad: "articulo", entidad_id: articulo.slug,
      descripcion: `Se ha publicado automáticamente, tal y como estaba programada, "${tipoLabel.toLowerCase()}": "${articulo.titulo}"`,
    });
  }
}

/*
 * ================================================================
 * CRON DE RESPALDO — implementación
 * ================================================================
 *
 * Llamado por /api/internal/cron-respaldo (ver arriba). Un cron
 * externo en Railway lo invoca cada minuto; aquí se decide si de
 * verdad hace falta actuar.
 */

// URL pública del Worker principal para comprobar si sigue vivo antes de
// actuar. Se puede sobrescribir con la variable de entorno PRIMARY_HEALTH_URL,
// pero por defecto usa el mismo dominio propio que ya usa el frontend (ver
// public/js/config.js) en vez del workers.dev subdomain de la cuenta, que
// se ha demostrado inestable (se desactivaba solo).
const PRIMARY_HEALTH_URL_POR_DEFECTO = "https://api.elotrofutbol.media/api/health";

// Si el primario no contesta en este tiempo, se considera caído. Corto a
// propósito: este endpoint lo llama un cron cada minuto, así que no puede
// quedarse colgado esperando -- mejor asumir que está caído y, en el peor
// caso, no hacer nada este minuto concreto (se reintenta en el siguiente).
const TIMEOUT_COMPROBACION_PRIMARIA_MS = 8000;

async function primariaEstaViva(env) {
  const url = env.PRIMARY_HEALTH_URL || PRIMARY_HEALTH_URL_POR_DEFECTO;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_COMPROBACION_PRIMARIA_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    // Un 503 de /api/health significa "Worker vivo pero D1 degradado": en
    // ese caso SÍ debe actuar el respaldo, porque el cron del primario usa
    // ese mismo D1 y probablemente esté fallando igual. Solo se considera
    // "viva" si responde 2xx con database: true.
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return !!(data && data.database === true);
  } catch {
    // Error de red, timeout, DNS... el primario no es alcanzable.
    return false;
  }
}

async function ejecutarCronRespaldo(request, env, ctx) {
  const secretoEsperado = env.INTERNAL_CRON_SECRET;
  if (!secretoEsperado) {
    // Igual que drainPendingWrites en el primario: fallo cerrado si no
    // hay secreto configurado, para que este endpoint nunca quede
    // accesible sin protección por un descuido de configuración.
    return json({ error: "Endpoint interno no configurado" }, 503);
  }
  const secretoRecibido = request.headers.get("X-Internal-Cron-Secret");
  if (!secretoRecibido || secretoRecibido !== secretoEsperado) {
    return json({ error: "No autorizado" }, 401);
  }

  const primariaViva = await primariaEstaViva(env);
  if (primariaViva) {
    // El primario sigue sirviendo tráfico con D1 sano: su propio cron
    // trigger ya se encarga de estas tareas. Actuar aquí también
    // publicaría cada noticia programada dos veces (una desde cada
    // backend). No se hace nada, y se informa en la respuesta para que
    // el log del cron externo en Railway quede claro.
    return json({ ok: true, actuado: false, motivo: "primaria_viva" });
  }

  console.warn("[cron-respaldo] Primaria no responde: ejecutando tareas programadas contra Postgres.");

  const resultados = {};
  try {
    await publicarArticulosProgramados(env);
    resultados.articulos = "ok";
  } catch (error) {
    console.error("[cron-respaldo] Error publicando artículos programados:", error);
    resultados.articulos = `error: ${error.message}`;
  }
  try {
    await iniciarPartidosProgramadosCuyaHoraHaLlegado(env);
    resultados.partidos = "ok";
  } catch (error) {
    console.error("[cron-respaldo] Error iniciando partidos programados:", error);
    resultados.partidos = `error: ${error.message}`;
  }
  try {
    await revisarPartidosDesatendidos(env, ctx);
    resultados.avisos = "ok";
  } catch (error) {
    console.error("[cron-respaldo] Error revisando partidos desatendidos:", error);
    resultados.avisos = `error: ${error.message}`;
  }

  return json({ ok: true, actuado: true, motivo: "primaria_caida", resultados });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Presente solo cuando server-railway.js ya decidió que esta escritura
    // se va a encolar en pending_writes para reproducirse luego contra D1
    // (ver server-railway.js: candidataAEncolar). Se guarda en la propia
    // fila creada aquí (origin_write_id, si la petición es un INSERT de
    // artículo/resultado) para que, cuando D1 reproduzca esta misma
    // escritura más tarde con el mismo X-Write-Id (ver drainPendingWrites
    // en worker/src/index.js), sync/incremental.mjs pueda reconciliar
    // ambas filas como una sola en vez de duplicar. Ver
    // worker/migracion_origin_write_id.sql para el porqué completo.
    const origenWriteId = request.headers.get("X-Write-Id") || null;

    if (method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    /*
     * ============================================================
     * CRON DE RESPALDO (tareas programadas cuando el primario cae)
     * ============================================================
     *
     * El Worker principal de Cloudflare tiene un cron trigger
     * (worker/wrangler.toml, "* * * * *") que cada minuto publica
     * noticias programadas, arranca partidos programados y avisa de
     * partidos desatendidos (ver publicarArticulosProgramados,
     * iniciarPartidosProgramadosCuyaHoraHaLlegado y
     * revisarPartidosDesatendidos, todas abajo). Ese cron SOLO existe
     * en el Worker principal -- deliberadamente desactivado aquí en
     * el wrangler.toml heredado de este directorio, para no disparar
     * la misma tarea dos veces si ambos backends estuvieran vivos a
     * la vez.
     *
     * Si el Worker principal deja de responder por completo (no solo
     * D1, sino el propio dominio inalcanzable), su cron deja de
     * ejecutarse y nada lo sustituye: las noticias programadas no se
     * publican solas, los partidos programados no arrancan. Este
     * endpoint es el respaldo para ese caso: un cron EXTERNO
     * configurado en Railway (ver README de este directorio) lo llama
     * cada minuto, protegido por un secreto compartido
     * (INTERNAL_CRON_SECRET). Antes de ejecutar nada, comprueba que el
     * primario de verdad no responde -- si respondiera, no hace nada,
     * precisamente para no duplicar publicaciones.
     * ============================================================
     */
    if (path === "/api/internal/cron-respaldo" && method === "POST") {
      return await ejecutarCronRespaldo(request, env, ctx);
    }

    // ---------- HEALTH CHECK ----------
    // Mismo endpoint que worker/src/index.js, replicado aquí para que la
    // página pública de estado (estado.html) pueda comprobar también la
    // salud de la API secundaria si algún día se expone con dominio
    // propio (ver nota de /sitemap-noticias.xml más abajo sobre por qué
    // hoy esto no se usa en producción).
    if (path === "/api/health" && method === "GET") {
      try {
        const started = Date.now();
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ status: "ok", database: true, storage: null, responseTime: Date.now() - started, api: "secondary", failover: false }, 200);
      } catch (error) {
        console.error("[health] D1 error:", error);
        return json({ status: "degraded", database: false, storage: null, responseTime: null, api: "secondary", failover: false }, 503);
      }
    }

    // ---------- CONTACTO DE PRENSA ----------
    // Mismo endpoint que worker/src/index.js. Ver nota de arriba: no se usa
    // en producción hoy (el punto de entrada público real es siempre el
    // worker principal), se mantiene solo para que el código no diverja.
    if (path === "/api/contacto-prensa" && method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON inválido" }, 400);
      }
      const nombre = (body && body.nombre ? String(body.nombre) : "").trim().slice(0, 200);
      const email = (body && body.email ? String(body.email) : "").trim().toLowerCase();
      const medio = (body && body.medio ? String(body.medio) : "").trim().slice(0, 200);
      const mensaje = (body && body.mensaje ? String(body.mensaje) : "").trim().slice(0, 5000);

      if (!nombre) return json({ error: "Indica tu nombre" }, 400);
      if (!emailValido(email)) return json({ error: "Introduce un email válido" }, 400);
      if (!mensaje) return json({ error: "Escribe un mensaje" }, 400);

      try {
        const textoPlano = [
          `Nombre: ${nombre}`,
          `Email: ${email}`,
          medio ? `Medio/organización: ${medio}` : null,
          "",
          mensaje,
        ].filter((l) => l !== null).join("\n");

        await enviarEmailNotificacion(env, {
          asunto: `Contacto de prensa: ${nombre}`,
          texto: textoPlano,
          html: `<p><strong>Nombre:</strong> ${escapeHtmlEmail(nombre)}</p>
<p><strong>Email:</strong> ${escapeHtmlEmail(email)}</p>
${medio ? `<p><strong>Medio/organización:</strong> ${escapeHtmlEmail(medio)}</p>` : ""}
<p><strong>Mensaje:</strong></p>
<p>${escapeHtmlEmail(mensaje).replace(/\n/g, "<br>")}</p>`,
        });
        return json({ ok: true });
      } catch (err) {
        console.error("[contacto-prensa]", err);
        return json({ error: "No se pudo enviar el mensaje. Inténtalo de nuevo o escribe directamente a prensa@elotrofutbol.media." }, 500);
      }
    }

    // ---------- SITEMAP DE NOTICIAS ----------
    // GET /sitemap-noticias.xml — mismo endpoint que worker/src/index.js
    // (API principal). El punto de entrada público real siempre es el
    // worker principal (elotrofutbol.media pasa por él, y es él quien
    // reenvía a Railway internamente si D1 falla — ver fetchRailway en
    // worker/src/index.js), así que este endpoint aquí NO se usa en
    // producción salvo que algún día esta API secundaria se exponga ella
    // misma con su propio dominio/ruta pública. Se mantiene por si eso
    // ocurre y para que el código de ambas APIs no diverja en esta parte.
    if (path === "/sitemap-noticias.xml" && method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          `SELECT slug, titulo, imagen_url, imagenes, fecha_publicacion, updated_at FROM articles
           WHERE publicado = 1
           ORDER BY fecha_publicacion DESC
           LIMIT 50000`
        ).all();

        const urls = results.map((articulo) => {
          const lastmod = fechaParaSitemap(articulo.updated_at || articulo.fecha_publicacion);

          // Extensión "image:" del protocolo de sitemaps — ver comentario
          // equivalente en worker/src/index.js.
          let listaImagenes = [];
          try {
            const adicionales = articulo.imagenes ? JSON.parse(articulo.imagenes) : [];
            listaImagenes = [articulo.imagen_url, ...(Array.isArray(adicionales) ? adicionales : [])]
              .filter(Boolean);
          } catch {
            listaImagenes = articulo.imagen_url ? [articulo.imagen_url] : [];
          }
          listaImagenes = [...new Set(listaImagenes)];

          const bloquesImagen = listaImagenes.map((src) => [
            "    <image:image>",
            `      <image:loc>${escaparXml(src)}</image:loc>`,
            articulo.titulo ? `      <image:caption>${escaparXml(articulo.titulo)}</image:caption>` : null,
            "    </image:image>",
          ].filter(Boolean).join("\n")).join("\n");

          return [
            "  <url>",
            `    <loc>https://elotrofutbol.media/noticia.html?slug=${escaparXml(articulo.slug)}</loc>`,
            lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
            "    <changefreq>weekly</changefreq>",
            "    <priority>0.6</priority>",
            bloquesImagen || null,
            "  </url>",
          ].filter(Boolean).join("\n");
        }).join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="https://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`;

        return cors(new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=UTF-8",
            "Cache-Control": "public, max-age=3600",
          },
        }));
      } catch (err) {
        return cors(new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`,
          { status: 200, headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "no-store" } }
        ));
      }
    }

    // ---------- GOOGLE NEWS SITEMAP ----------
    // GET /sitemap-news.xml — mismo endpoint que worker/src/index.js.
    // Ver comentario de /sitemap-noticias.xml arriba sobre por qué se
    // mantiene aquí por paridad aunque no se use en producción.
    if (path === "/sitemap-news.xml" && method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          `SELECT slug, titulo, categoria, fecha_publicacion FROM articles
           WHERE publicado = 1
             AND fecha_publicacion >= datetime('now', '-48 hours')
           ORDER BY fecha_publicacion DESC
           LIMIT 1000`
        ).all();

        const urls = results.map((articulo) => {
          const fecha = new Date(
            articulo.fecha_publicacion.includes("T") || articulo.fecha_publicacion.endsWith("Z")
              ? articulo.fecha_publicacion
              : `${articulo.fecha_publicacion.replace(" ", "T")}Z`
          );
          if (Number.isNaN(fecha.getTime())) return null;

          return [
            "  <url>",
            `    <loc>https://elotrofutbol.media/noticia.html?slug=${escaparXml(articulo.slug)}</loc>`,
            "    <news:news>",
            "      <news:publication>",
            "        <news:name>ELOTROFÚTBOLTV</news:name>",
            "        <news:language>es</news:language>",
            "      </news:publication>",
            `      <news:publication_date>${fecha.toISOString()}</news:publication_date>`,
            `      <news:title>${escaparXml(articulo.titulo)}</news:title>`,
            articulo.categoria ? `      <news:keywords>${escaparXml(articulo.categoria)}</news:keywords>` : null,
            "    </news:news>",
            "  </url>",
          ].filter(Boolean).join("\n");
        }).filter(Boolean).join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="https://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>\n`;

        return cors(new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=UTF-8",
            "Cache-Control": "public, max-age=600",
          },
        }));
      } catch (err) {
        return cors(new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="https://www.google.com/schemas/sitemap-news/0.9"></urlset>\n`,
          { status: 200, headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "no-store" } }
        ));
      }
    }

    // ---------- RSS ----------
    // GET /rss.xml — mismo endpoint que worker/src/index.js (API
    // principal). Ver comentario de /sitemap-noticias.xml arriba: este
    // endpoint aquí no se usa en producción salvo failover, se mantiene
    // por paridad de código entre ambas APIs.
    if (path === "/rss.xml" && method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          `SELECT slug, titulo, subtitulo, contenido, categoria, autor_nombre, fecha_publicacion, updated_at
           FROM articles
           WHERE publicado = 1
           ORDER BY fecha_publicacion DESC
           LIMIT 100`
        ).all();

        const items = results.map((articulo) => {
          const link = `https://elotrofutbol.media/noticia.html?slug=${escaparXml(articulo.slug)}`;
          const pubDate = fechaParaRss(articulo.fecha_publicacion);
          const descripcion = articulo.subtitulo?.trim() || extractoTexto(articulo.contenido);
          return [
            "  <item>",
            `    <title>${escaparXml(articulo.titulo)}</title>`,
            `    <link>${link}</link>`,
            `    <guid isPermaLink="true">${link}</guid>`,
            descripcion ? `    <description>${escaparXml(descripcion)}</description>` : null,
            articulo.categoria ? `    <category>${escaparXml(articulo.categoria)}</category>` : null,
            articulo.autor_nombre ? `    <author>${escaparXml(articulo.autor_nombre)}</author>` : null,
            pubDate ? `    <pubDate>${pubDate}</pubDate>` : null,
            "  </item>",
          ].filter(Boolean).join("\n");
        }).join("\n");

        const ultimaActualizacion = fechaParaRss(results[0]?.updated_at || results[0]?.fecha_publicacion) || new Date().toUTCString();

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="https://www.w3.org/2005/Atom">\n<channel>\n  <title>ELOTROFÚTBOLTV</title>\n  <link>https://elotrofutbol.media</link>\n  <description>Últimas noticias de fútbol modesto: Primera Federación, Segunda Federación y más.</description>\n  <language>es</language>\n  <lastBuildDate>${ultimaActualizacion}</lastBuildDate>\n  <atom:link href="https://elotrofutbol.media/rss.xml" rel="self" type="application/rss+xml" />\n${items}\n</channel>\n</rss>\n`;

        return cors(new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/rss+xml; charset=UTF-8",
            "Cache-Control": "public, max-age=3600",
          },
        }));
      } catch (err) {
        return cors(new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>ELOTROFÚTBOLTV</title><link>https://elotrofutbol.media</link><description>Últimas noticias de fútbol modesto.</description></channel></rss>\n`,
          { status: 200, headers: { "Content-Type": "application/rss+xml; charset=UTF-8", "Cache-Control": "no-store" } }
        ));
      }
    }

    try {
      // ---------- LOGIN ----------
      if (path === "/api/login" && method === "POST") {
        const { username, password } = await request.json();
        if (!username || !password) return json({ error: "Faltan credenciales" }, 400);
        const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND activo = 1").bind(username).first();
        if (!user) return json({ error: "Usuario o contraseña incorrectos" }, 401);
        const hash = await hashPassword(password, user.salt);
        if (hash !== user.password_hash) return json({ error: "Usuario o contraseña incorrectos" }, 401);
        const token = await crearSesion(env, request, user);
        ctx.waitUntil(registrarActividad(env, request, { uid: user.id, nombre: user.nombre, rol: user.rol }, {
          accion: "login", entidad: "sesion", descripcion: `${user.nombre} ha iniciado sesión`,
        }));
        return json({ token, user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, nivel: user.rol === "admin" ? NIVEL_MAXIMO : (user.nivel || 1), email: user.email || null, avatar_url: user.avatar_url || null, avatar_foco: user.avatar_foco || null } });
      }

      // ---------- GUARDAR EMAIL (primer inicio de sesión) ----------
      if (path === "/api/me/email" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { email } = await request.json();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          return json({ error: "Introduce un correo electrónico válido" }, 400);
        }
        await env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email.trim(), payload.uid).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_email_propio", entidad: "usuario", entidad_id: payload.uid,
          descripcion: `${payload.nombre} ha guardado su correo electrónico`,
        }));
        return json({ ok: true, email: email.trim() });
      }

      // ---------- RECUPERAR CONTRASEÑA: paso 1, solicitar el enlace ----------
      // Antes este endpoint cambiaba la contraseña con solo mandar
      // usuario + correo, sin ninguna verificación de que quien lo pide
      // es realmente el dueño de la cuenta (un correo personal no es un
      // secreto: puede saberse o adivinarse fácilmente en una redacción
      // pequeña donde todos se conocen). Ahora se genera un token de un
      // solo uso, caduca a los 30 minutos, y solo se puede usar si llega
      // por el enlace enviado a la bandeja de entrada del correo
      // guardado, vía Resend (mismo servicio que el resto de avisos).
      //
      // Por seguridad, la respuesta es siempre la misma exista o no la
      // cuenta/correo (para no revelar si un usuario existe): el aviso
      // real de "no coinciden" ya no se muestra en el propio formulario.
      if (path === "/api/forgot-password" && method === "POST") {
        const { username, email } = await request.json();
        if (!username || !email) return json({ error: "Faltan campos" }, 400);

        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE username = ? AND email = ? AND activo = 1"
        ).bind(username.trim(), email.trim()).first();

        if (user) {
          const tokenArr = new Uint8Array(32);
          crypto.getRandomValues(tokenArr);
          const token = [...tokenArr].map((b) => b.toString(16).padStart(2, "0")).join("");
          const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          await env.DB.prepare("UPDATE users SET reset_token = ?, reset_token_expira = ? WHERE id = ?")
            .bind(token, expira, user.id).run();

          const enlace = `${SITIO_URL}/admin/login.html?reset=${token}`;
          ctx.waitUntil(enviarEmailNotificacion(env, {
            asunto: "Recupera tu contraseña — ELOTROFÚTBOLTV",
            texto: `Hola ${user.nombre},\n\nHas pedido recuperar tu contraseña en ELOTROFÚTBOLTV. Entra en este enlace para poner una nueva (caduca en 30 minutos):\n${enlace}\n\nSi no has sido tú, ignora este correo: tu contraseña actual sigue siendo válida.`,
            html: plantillaEmail({
              etiqueta: "Recuperar contraseña",
              titulo: "Pon una contraseña nueva",
              parrafo: "Si no has pedido tú este cambio, ignora este correo: tu contraseña actual sigue siendo válida. El enlace caduca en 30 minutos.",
              boton: { texto: "Poner contraseña nueva", url: enlace },
            }),
          }, { destinatario: user.email }));

          ctx.waitUntil(registrarActividad(env, request, { uid: user.id, nombre: user.nombre, rol: user.rol }, {
            accion: "solicitar_recuperar_password", entidad: "usuario", entidad_id: user.id,
            descripcion: `${user.nombre} ha solicitado recuperar su contraseña por correo`,
          }));
        }

        return json({ ok: true, mensaje: "Si los datos son correctos, te hemos enviado un enlace a tu correo para poner una contraseña nueva." });
      }

      // ---------- RECUPERAR CONTRASEÑA: paso 2, usar el enlace del correo ----------
      if (path === "/api/forgot-password/confirmar" && method === "POST") {
        const { token, nueva } = await request.json();
        if (!token || !nueva) return json({ error: "Faltan campos" }, 400);
        if (nueva.length < 8) return json({ error: "La nueva contraseña debe tener al menos 8 caracteres" }, 400);

        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE reset_token = ? AND activo = 1"
        ).bind(token).first();
        if (!user || !user.reset_token_expira || new Date(user.reset_token_expira).getTime() < Date.now()) {
          return json({ error: "El enlace no es válido o ha caducado. Pide uno nuevo desde \"He olvidado mi contraseña\"." }, 401);
        }

        const nuevaSalt = randomSalt();
        const nuevaHash = await hashPassword(nueva, nuevaSalt);
        await env.DB.prepare(
          "UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expira = NULL WHERE id = ?"
        ).bind(nuevaHash, nuevaSalt, user.id).run();

        // Igual que al cambiar la contraseña desde el panel: cierra
        // cualquier sesión que hubiera abierta en otros dispositivos.
        await env.DB.prepare(
          "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
        ).bind(user.id).run();

        ctx.waitUntil(registrarActividad(env, request, { uid: user.id, nombre: user.nombre, rol: user.rol }, {
          accion: "recuperar_password", entidad: "usuario", entidad_id: user.id,
          descripcion: `${user.nombre} ha recuperado su contraseña mediante "He olvidado mi contraseña"`,
        }));

        return json({ ok: true });
      }

      // ---------- DEBUG TEMPORAL: diagnóstico de la auto-transición de partidos ----------
      // Endpoint de solo lectura para ver, sin tocar nada, por qué un
      // partido "programado" no se está pasando solo a "en_juego": qué
      // hora cree el worker que es, cómo se está convirtiendo
      // fecha_partido, y si el filtro lo está cogiendo o no. Requiere
      // login (cualquier usuario del panel) para no dejarlo abierto al
      // público. BORRAR este bloque una vez confirmado el arreglo.
      if (path === "/api/debug/cron-partidos" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const ahora = new Date();
        const ahoraSqlite = aSqliteDatetimeUTC(ahora);
        const { results: candidatos } = await env.DB.prepare(
          `SELECT id, equipo_local, equipo_visitante, fecha_partido, estado
           FROM results WHERE estado = 'programado' AND fecha_partido IS NOT NULL
           ORDER BY fecha_partido DESC LIMIT 30`
        ).all();
        const diagnostico = candidatos.map((p) => {
          const longitudOk = p.fecha_partido && p.fecha_partido.length === 16;
          const inicioUtcSqlite = longitudOk ? fechaPartidoAUtcSqlite(p.fecha_partido) : null;
          return {
            id: p.id,
            partido: `${p.equipo_local} - ${p.equipo_visitante}`,
            fecha_partido_guardada: p.fecha_partido,
            longitud: p.fecha_partido ? p.fecha_partido.length : null,
            pasa_filtro_longitud_16: longitudOk,
            inicio_convertido_a_utc_sqlite: inicioUtcSqlite,
            deberia_estar_en_juego: inicioUtcSqlite !== null && inicioUtcSqlite <= ahoraSqlite,
          };
        });
        return json({
          ahora_utc_iso: ahora.toISOString(),
          ahora_utc_sqlite: ahoraSqlite,
          offset_madrid_minutos_ahora: offsetMadridEnMinutos(ahora),
          total_programados_con_fecha: candidatos.length,
          partidos: diagnostico,
        });
      }

      // Endpoint hermano del anterior, pero que SÍ ejecuta de verdad
      // iniciarPartidosProgramadosCuyaHoraHaLlegado (la misma función
      // que llama el cron cada minuto). Sirve para descartar si el
      // problema está en la lógica (que ya hemos visto que no, el
      // cálculo de horas es correcto) o en que el cron trigger de
      // Cloudflare simplemente no se está disparando en producción: si
      // al llamar esto a mano el partido pasado de hora SÍ cambia a
      // "en_juego", el bug está 100% en el cron trigger (revisar en el
      // dashboard de Cloudflare -> Workers -> este worker -> Triggers
      // -> Cron Triggers, que exista "* * * * *" y esté activo).
      // BORRAR junto con el endpoint anterior una vez confirmado.
      if (path === "/api/debug/cron-partidos/ejecutar" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const antes = await env.DB.prepare(
          `SELECT id, equipo_local, equipo_visitante, fecha_partido, estado FROM results
           WHERE estado = 'programado' AND fecha_partido IS NOT NULL AND length(fecha_partido) = 16`
        ).all();
        await iniciarPartidosProgramadosCuyaHoraHaLlegado(env);
        const idsAntes = antes.results.map((p) => p.id);
        let despues = { results: [] };
        if (idsAntes.length) {
          despues = await env.DB.prepare(
            `SELECT id, equipo_local, equipo_visitante, estado FROM results WHERE id IN (${idsAntes.map(() => "?").join(",")})`
          ).bind(...idsAntes).all();
        }
        const estadoDespuesPorId = Object.fromEntries(despues.results.map((p) => [p.id, p.estado]));
        const cambiados = antes.results
          .filter((p) => estadoDespuesPorId[p.id] === "en_juego")
          .map((p) => ({ id: p.id, partido: `${p.equipo_local} - ${p.equipo_visitante}`, fecha_partido: p.fecha_partido }));
        return json({
          mensaje: cambiados.length
            ? "La función SÍ funciona: estos partidos se han pasado a en_juego al ejecutarla a mano. El bug está en que el cron trigger no se dispara solo en Cloudflare."
            : "No había ningún partido pendiente de activar en este momento (o ya estaban todos al día).",
          partidos_activados_ahora: cambiados,
        });
      }

      // Limpieza puntual: borra duplicados de "inicio_partido" que ya
      // se hubieran colado ANTES de este arreglo (se queda con el más
      // antiguo -el id más bajo- de cada partido y borra el resto).
      // Solo lectura+borrado de match_events, no toca goles/tarjetas.
      // BORRAR junto con los demás endpoints de debug una vez usado.
      if (path === "/api/debug/cron-partidos/limpiar-duplicados" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { results: duplicados } = await env.DB.prepare(
          `SELECT id, resultado_id FROM match_events WHERE tipo = 'inicio_partido' AND id NOT IN (
             SELECT MIN(id) FROM match_events WHERE tipo = 'inicio_partido' GROUP BY resultado_id
           )`
        ).all();
        for (const dup of duplicados) {
          await env.DB.prepare("DELETE FROM match_events WHERE id = ?").bind(dup.id).run();
        }
        return json({ ok: true, eliminados: duplicados.length, detalle: duplicados });
      }

      // ---------- ME ----------
      if (path === "/api/me" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        return json({ user: payload });
      }

      // ---------- CAMBIO DE CONTRASEÑA PROPIA ----------
      if (path === "/api/me/password" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { actual, nueva } = await request.json();
        if (!actual || !nueva) return json({ error: "Faltan campos" }, 400);
        if (nueva.length < 8) return json({ error: "La nueva contraseña debe tener al menos 8 caracteres" }, 400);

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(payload.uid).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);

        const hashActual = await hashPassword(actual, user.salt);
        if (hashActual !== user.password_hash) return json({ error: "La contraseña actual no es correcta" }, 401);

        const nuevaSalt = randomSalt();
        const nuevaHash = await hashPassword(nueva, nuevaSalt);
        await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
          .bind(nuevaHash, nuevaSalt, user.id).run();

        // Por seguridad, cambiar la contraseña cierra todas las demás
        // sesiones (en otros dispositivos/navegadores): si alguien cambia
        // la contraseña porque sospecha que otra persona tiene acceso a
        // su cuenta, esa otra sesión queda invalidada al momento. La
        // sesión actual (desde la que se ha hecho el cambio) se mantiene.
        await env.DB.prepare(
          "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
        ).bind(user.id, payload.sid || "").run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "cambiar_password_propia", entidad: "usuario", entidad_id: payload.uid,
          descripcion: `${payload.nombre} ha cambiado su contraseña`,
        }));

        return json({ ok: true });
      }

      // ---------- MIS SESIONES (dispositivos con sesión iniciada) ----------
      // Lista las sesiones activas (no revocadas) de la persona conectada:
      // desde qué dispositivo/navegador, con qué IP, cuándo se inició y
      // cuándo se ha usado por última vez. Permite reconocer accesos que
      // no se reconocen y cerrarlos.
      if (path === "/api/me/sesiones" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { results } = await env.DB.prepare(
          `SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions
           WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC`
        ).bind(payload.uid).all();
        const sesiones = results.map((s) => ({
          id: s.id,
          dispositivo: describirDispositivo(s.user_agent),
          ip: s.ip || null,
          created_at: s.created_at,
          last_seen_at: s.last_seen_at,
          actual: s.id === payload.sid,
        }));
        return json({ sesiones });
      }

      // ---------- CERRAR TODAS LAS DEMÁS SESIONES ----------
      // Va antes del DELETE de una sesión concreta con id, para no
      // confundirla con /api/me/sesiones/:id.
      if (path === "/api/me/sesiones/otras" && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        await env.DB.prepare(
          "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
        ).bind(payload.uid, payload.sid || "").run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "cerrar_otras_sesiones", entidad: "sesion",
          descripcion: `${payload.nombre} ha cerrado el resto de sus sesiones abiertas`,
        }));
        return json({ ok: true });
      }

      // ---------- CERRAR UNA SESIÓN CONCRETA ----------
      // Solo se puede cerrar una sesión propia (nunca la de otra
      // persona): se filtra siempre por user_id = payload.uid.
      const sesionMatch = path.match(/^\/api\/me\/sesiones\/([a-f0-9]+)$/);
      if (sesionMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = sesionMatch[1];
        const sesion = await env.DB.prepare(
          "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
        ).bind(id, payload.uid).first();
        if (!sesion) return json({ error: "Sesión no encontrada" }, 404);
        await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").bind(id).run();
        const eraLaActual = id === payload.sid;
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "cerrar_sesion", entidad: "sesion", entidad_id: id,
          descripcion: eraLaActual
            ? `${payload.nombre} ha cerrado su sesión actual desde "Mis sesiones"`
            : `${payload.nombre} ha cerrado una sesión abierta en otro dispositivo`,
        }));
        return json({ ok: true, era_la_actual: eraLaActual });
      }

      // ---------- NOVEDADES: cuándo las ha visto por última vez ----------
      // Se guarda en el servidor (no solo en localStorage del navegador)
      // para que, si se pierde la sesión o se borran las cookies/datos
      // del navegador, al volver a entrar no le vuelvan a salir como
      // nuevas las novedades que ya había visto.
      if (path === "/api/me/notif-visto" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const user = await env.DB.prepare("SELECT notif_visto_at FROM users WHERE id = ?").bind(payload.uid).first();
        return json({ visto: (user && user.notif_visto_at) || null });
      }

      if (path === "/api/me/notif-visto" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const ahora = new Date().toISOString();
        await env.DB.prepare("UPDATE users SET notif_visto_at = ? WHERE id = ?").bind(ahora, payload.uid).run();
        return json({ ok: true, visto: ahora });
      }
      // Cada persona puede editar su propio nombre y correo. Devolvemos un
      // token nuevo porque el nombre va incrustado en el JWT (se usa, por
      // ejemplo, para la cabecera del panel), así el cambio se ve al
      // momento sin tener que volver a iniciar sesión.
      // ---------- LEER MI PERFIL COMPLETO (bio, avatar, redes...) ----------
      // El JWT solo lleva lo justo (uid/username/nombre/rol) para no
      // hacerlo enorme; el resto del perfil (biografía, foto, redes
      // sociales propias) se consulta aparte para rellenar el formulario
      // de "Mis datos" del panel.
      if (path === "/api/me/perfil" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const user = await env.DB.prepare(
          "SELECT id, username, nombre, rol, email, bio, experiencia, avatar_url, equipo, redes_sociales FROM users WHERE id = ?"
        ).bind(payload.uid).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);
        let redes = {};
        if (user.redes_sociales) {
          try { redes = JSON.parse(user.redes_sociales); } catch { redes = {}; }
        }
        // El equipo se devuelve como array (aunque en la BD solo hubiera
        // uno guardado con el formato antiguo) para que el panel lo
        // muestre igual en todos los casos. Es de solo lectura aqui: la
        // propia persona lo ve pero no puede cambiarlo (ver PUT abajo).
        const equipos = parsearEquipos(user.equipo);
        return json({ user: { ...user, equipo: equipos, redes_sociales: undefined, redes } });
      }

      // ---------- EDITAR MI PERFIL (nombre / correo / bio / avatar / redes) ----------
      // Cada persona puede editar su propio perfil: nombre, correo,
      // biografía, foto y redes sociales propias (distintas de las redes
      // del medio, que solo puede tocar un admin desde /api/settings).
      // Este perfil es público: lo puede ver cualquiera desde su página
      // de autor (GET /api/autores/:id), enlazada desde sus noticias.
      // Devolvemos un token nuevo porque el nombre va incrustado en el
      // JWT (se usa, por ejemplo, para la cabecera del panel), así el
      // cambio se ve al momento sin tener que volver a iniciar sesión.
      if (path === "/api/me/perfil" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
        if (!nombre) return json({ error: "El nombre no puede estar vacío" }, 400);
        let email = null;
        if (body.email !== undefined && body.email !== null && body.email.trim() !== "") {
          email = body.email.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json({ error: "Introduce un correo electrónico válido" }, 400);
          }
        }
        const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 600) : null;
        const experiencia = typeof body.experiencia === "string" ? body.experiencia.trim().slice(0, 1200) : null;
        const avatarUrl = typeof body.avatar_url === "string" && body.avatar_url.trim() ? body.avatar_url.trim() : null;
        // El equipo NO se puede editar desde el propio perfil: es de solo
        // lectura para la persona (se muestra bloqueado en "Mis datos") y
        // solo un admin puede cambiarlo, desde "Usuarios" (PUT /api/users/:id).
        // Por eso aqui se ignora cualquier "equipo" que llegue en el body.

        // Igual que en /api/settings: solo se guardan claves conocidas y
        // con valores de texto, para no guardar basura en la BD.
        const redesLimpias = {};
        if (body.redes && typeof body.redes === "object" && !Array.isArray(body.redes)) {
          for (const [key, val] of Object.entries(body.redes)) {
            if (["twitter", "instagram", "tiktok", "youtube"].includes(key) && typeof val === "string" && val.trim() !== "") {
              redesLimpias[key] = val.trim();
            }
          }
        }

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(payload.uid).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);

        // Para que el historial diga exactamente qué se ha tocado (y no
        // un genérico "nombre, bio, foto o redes" aunque solo se haya
        // cambiado una cosa), comparamos cada campo con su valor anterior.
        const redesAnteriores = (() => {
          if (!user.redes_sociales) return {};
          try { return JSON.parse(user.redes_sociales); } catch { return {}; }
        })();
        const cambios = [];
        if (user.nombre !== nombre) cambios.push("nombre");
        if ((user.email || null) !== email) cambios.push("correo");
        if ((user.bio || null) !== bio) cambios.push("biografía");
        if ((user.experiencia || null) !== experiencia) cambios.push("experiencia");
        if ((user.avatar_url || null) !== avatarUrl) cambios.push("foto de perfil");
        if (JSON.stringify(redesAnteriores) !== JSON.stringify(redesLimpias)) cambios.push("redes sociales");

        await env.DB.prepare("UPDATE users SET nombre = ?, email = ?, bio = ?, experiencia = ?, avatar_url = ?, redes_sociales = ? WHERE id = ?")
          .bind(nombre, email, bio, experiencia, avatarUrl, Object.keys(redesLimpias).length ? JSON.stringify(redesLimpias) : null, user.id).run();

        // Mantenemos el mismo "sid": es la misma sesión de antes, solo
        // cambia el nombre incrustado en el JWT, así que no tiene sentido
        // crear una fila de sesión nueva por simplemente editar el perfil.
        const token = await createJWT({ uid: user.id, username: user.username, nombre, rol: user.rol, sid: payload.sid }, env.JWT_SECRET);
        const descripcionCambios = cambios.length
          ? `${nombre} ha editado su perfil: ${cambios.join(", ")}`
          : `${nombre} ha guardado su perfil sin cambios`;
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_perfil_propio", entidad: "usuario", entidad_id: payload.uid,
          descripcion: descripcionCambios,
          detalle: cambios.length ? { campos: cambios } : null,
        }));
        return json({
          ok: true,
          token,
          user: { id: user.id, username: user.username, nombre, rol: user.rol, email, bio, experiencia, avatar_url: avatarUrl, equipo: parsearEquipos(user.equipo), redes: redesLimpias },
        });
      }

      // ---------- MI PROGRESO (nivel y publicaciones) ----------
      // Progreso propio del colaborador conectado: nivel actual,
      // publicaciones contabilizadas y lo que le falta para el
      // siguiente nivel. Se usa en "Ajustes de cuenta" → "Mi progreso",
      // que se refresca solo (polling) sin que la persona tenga que
      // recargar la página.
      if (path === "/api/me/nivel" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const user = await env.DB.prepare("SELECT id, nivel, nivel_nota, rol FROM users WHERE id = ?").bind(payload.uid).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);
        const progreso = await construirProgresoNivel(env, user);
        return json(progreso);
      }

      // ---------- SETTINGS (redes sociales y otros ajustes del medio) ----------
      // Se guardan todos juntos en una tabla clave/valor para poder editarlos
      // desde un único sitio (el panel de administración) en vez de tener
      // que tocar el código en varios archivos distintos.
      if (path === "/api/settings" && method === "GET") {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'redes_sociales'").first();
        let redes = {};
        if (row) {
          try { redes = JSON.parse(row.value); } catch { redes = {}; }
        }
        return json({ redes });
      }

      if (path === "/api/settings" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede modificar las redes sociales" }, 403);
        const body = await request.json();
        if (!body.redes || typeof body.redes !== "object" || Array.isArray(body.redes)) {
          return json({ error: "Faltan las redes sociales" }, 400);
        }
        // Solo guardamos texto (URLs); descartamos claves vacías o con
        // valores que no sean texto, para no guardar basura.
        const redesLimpias = {};
        for (const [key, val] of Object.entries(body.redes)) {
          if (typeof val === "string" && val.trim() !== "") redesLimpias[key] = val.trim();
        }
        await env.DB.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES ('redes_sociales', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).bind(JSON.stringify(redesLimpias)).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_settings", entidad: "settings",
          descripcion: `Ha modificado las redes sociales del medio`,
        }));
        return json({ ok: true, redes: redesLimpias });
      }

      // ---------- AUTORES (cualquier usuario logueado) ----------
      // Lista ligera (solo id + nombre) de redactores/admins activos, para
      // poder elegir "quién ha hecho la noticia" al crear o editar una
      // noticia/crónica sin depender de quién la esté subiendo. A
      // diferencia de /api/users, no exige rol admin ni expone datos
      // sensibles (usuario, correo, rol...).
      if (path === "/api/autores" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { results } = await env.DB.prepare(
          "SELECT id, nombre, equipo, redes_sociales FROM users WHERE activo = 1 ORDER BY nombre"
        ).all();
        const autores = results.map((a) => {
          let redes = {};
          if (a.redes_sociales) {
            try { redes = JSON.parse(a.redes_sociales); } catch { redes = {}; }
          }
          return { ...a, equipo: parsearEquipos(a.equipo), redes_sociales: undefined, redes };
        });
        return json({ autores });
      }

      // ---------- PERFIL PÚBLICO DE AUTOR ----------
      // Página pública (autor.html) a la que se enlaza desde el nombre del
      // autor en cada noticia: no exige sesión ni admin, cualquiera puede
      // verla. Solo se devuelven los datos pensados para ser públicos
      // (nombre, biografía, foto, redes propias) y sus noticias/crónicas
      // ya publicadas; nunca usuario, correo, rol, etc.
      const autorPublicoMatch = path.match(/^\/api\/autores\/(\d+)$/);
      if (autorPublicoMatch && method === "GET") {
        const id = parseInt(autorPublicoMatch[1], 10);
        const autor = await env.DB.prepare(
          "SELECT id, nombre, bio, experiencia, avatar_url, equipo, redes_sociales FROM users WHERE id = ? AND activo = 1"
        ).bind(id).first();
        if (!autor) return json({ error: "Autor no encontrado" }, 404);

        let redes = {};
        if (autor.redes_sociales) {
          try { redes = JSON.parse(autor.redes_sociales); } catch { redes = {}; }
        }

        const { results: articulos } = await env.DB.prepare(
          `SELECT id, slug, titulo, subtitulo, contenido, categoria, club, imagen_url, imagenes, autor_id, autor_nombre, coautor_id, coautor_nombre, fecha_publicacion
           FROM articles WHERE (autor_id = ? OR coautor_id = ?) AND publicado = 1 ORDER BY fecha_publicacion DESC LIMIT 30`
        ).bind(id, id).all();

        return json({
          autor: { id: autor.id, nombre: autor.nombre, bio: autor.bio || "", experiencia: autor.experiencia || "", avatar_url: autor.avatar_url || "", equipo: parsearEquipos(autor.equipo), redes },
          articulos: articulos.map((a) => ({ ...a, imagen_foco: focoDePortada(a), imagenes: undefined })),
        });
      }

      // ---------- HISTORIAL DE ACCIONES (solo admins) ----------
      // Permite filtrar por usuario, acción, entidad, texto libre (busca
      // en la descripción) y rango de fechas. Paginado con limit/offset.
      if (path === "/api/activity" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede ver el historial" }, 403);

        const usuarioId = url.searchParams.get("usuario_id");
        const accion = url.searchParams.get("accion");
        const entidad = url.searchParams.get("entidad");
        const q = url.searchParams.get("q");
        const desde = url.searchParams.get("desde"); // YYYY-MM-DD
        const hasta = url.searchParams.get("hasta"); // YYYY-MM-DD
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);

        let query = "SELECT * FROM activity_log WHERE 1=1";
        const binds = [];
        if (usuarioId) { query += " AND usuario_id = ?"; binds.push(parseInt(usuarioId, 10)); }
        if (accion) { query += " AND accion = ?"; binds.push(accion); }
        if (entidad) { query += " AND entidad = ?"; binds.push(entidad); }
        if (q) { query += " AND (descripcion LIKE ? OR usuario_nombre LIKE ?)"; binds.push(`%${q}%`, `%${q}%`); }
        if (desde) { query += " AND created_at >= ?"; binds.push(`${desde} 00:00:00`); }
        if (hasta) { query += " AND created_at <= ?"; binds.push(`${hasta} 23:59:59`); }

        let countQuery = query.replace("SELECT *", "SELECT COUNT(*) AS total");
        const totalRow = await env.DB.prepare(countQuery).bind(...binds).first();

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        binds.push(limit, offset);
        const { results } = await env.DB.prepare(query).bind(...binds).all();

        // Lista de acciones y usuarios distintos, para rellenar los
        // desplegables de filtro en el panel sin tener que traerse todo
        // el historial.
        const { results: accionesDistintas } = await env.DB.prepare(
          "SELECT DISTINCT accion FROM activity_log ORDER BY accion"
        ).all();
        const { results: usuariosDistintos } = await env.DB.prepare(
          "SELECT DISTINCT usuario_id, usuario_nombre FROM activity_log WHERE usuario_id IS NOT NULL ORDER BY usuario_nombre"
        ).all();

        return json({
          actividad: results,
          total: totalRow ? totalRow.total : 0,
          acciones: accionesDistintas.map((a) => a.accion),
          usuarios: usuariosDistintos,
        });
      }

      // ---------- USUARIOS (solo admins) ----------
      // Nunca se devuelve password_hash ni salt: las contraseñas están
      // cifradas y no se pueden consultar, solo restablecer.
      if (path === "/api/users" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede ver los usuarios" }, 403);
        const { results } = await env.DB.prepare(
          "SELECT id, username, nombre, rol, activo, email, equipo, avatar_url, nivel, nivel_nota, created_at FROM users ORDER BY nombre"
        ).all();
        // El progreso de nivel se calcula por usuario (cuenta sus
        // artículos publicados), así que se resuelve en paralelo para
        // no encadenar N consultas una detrás de otra.
        const users = await Promise.all(results.map(async (u) => ({
          ...u,
          equipo: parsearEquipos(u.equipo),
          progreso_nivel: await construirProgresoNivel(env, u),
        })));
        return json({ users });
      }

      if (path === "/api/users" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede crear usuarios" }, 403);
        const body = await request.json();
        if (!body.username || !body.nombre) return json({ error: "Faltan campos obligatorios" }, 400);
        const username = body.username.trim().toLowerCase();
        if (!/^[a-z0-9_.]+$/.test(username)) {
          return json({ error: "El usuario solo puede tener letras, números, puntos y guiones bajos" }, 400);
        }
        const existe = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (existe) return json({ error: "Ya existe un usuario con ese nombre de usuario" }, 400);

        const passwordInicial = body.password && body.password.length >= 8 ? body.password : generatePassword();
        const salt = randomSalt();
        const hash = await hashPassword(passwordInicial, salt);
        const rol = body.rol === "admin" ? "admin" : "redactor";

        // El equipo es opcional, pero si se manda alguno hay que elegir
        // hasta 3 (ver validarEquipos).
        const { error: errorEquipo, equipos: equiposNuevos } = validarEquipos(body.equipo);
        if (errorEquipo) return json({ error: errorEquipo }, 400);
        const equipoNuevo = equiposNuevos.length ? JSON.stringify(equiposNuevos) : null;

        await env.DB.prepare(
          `INSERT INTO users (username, password_hash, salt, nombre, rol, activo, email, equipo) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(username, hash, salt, body.nombre, rol, body.email ? body.email.trim() : null, equipoNuevo).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "crear_usuario", entidad: "usuario", entidad_id: username,
          descripcion: `Ha creado el usuario "${username}" (${rol})`,
        }));

        // La contraseña en claro solo se devuelve aquí, en el momento de
        // crear el usuario, para que el admin pueda comunicársela.
        return json({ ok: true, username, password: passwordInicial });
      }

      // ---------- USUARIOS: restablecer contraseña ----------
      const resetPassMatch = path.match(/^\/api\/users\/(\d+)\/reset-password$/);
      if (resetPassMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede restablecer contraseñas" }, 403);
        const id = parseInt(resetPassMatch[1]);
        const user = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);

        const body = await request.json().catch(() => ({}));
        const nuevaPassword = body.nueva && body.nueva.length >= 8 ? body.nueva : generatePassword();
        const salt = randomSalt();
        const hash = await hashPassword(nuevaPassword, salt);
        await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, id).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "restablecer_password", entidad: "usuario", entidad_id: id,
          descripcion: `Ha restablecido la contraseña de "${user.username}"`,
        }));

        return json({ ok: true, username: user.username, password: nuevaPassword });
      }

      // ---------- USUARIOS: cambiar de nivel (a mano, por un admin) ----------
      // El nivel nunca sube solo por cumplir las cifras: lo decide un
      // admin evaluando también calidad, puntualidad, cumplimiento de
      // normas, etc. (ver documento del sistema de niveles). Esta ruta
      // permite subir o bajar el nivel de cualquier colaborador, con un
      // motivo opcional, dejando constancia en nivel_historial y en el
      // historial general de actividad.
      const nivelMatch = path.match(/^\/api\/users\/(\d+)\/nivel$/);
      if (nivelMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede cambiar el nivel de un colaborador" }, 403);
        const id = parseInt(nivelMatch[1]);
        const user = await env.DB.prepare("SELECT id, nombre, nivel, rol FROM users WHERE id = ?").bind(id).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);
        // Los admins siempre están al nivel máximo mientras tengan ese
        // rol: no se les puede subir ni bajar a mano. Si se quiere que
        // un admin vuelva a tener un nivel "normal", primero hay que
        // quitarle el rol de administrador.
        if (user.rol === "admin") {
          return json({ error: "Los administradores están siempre en el nivel máximo y no se puede editar su nivel mientras tengan ese rol" }, 400);
        }

        const body = await request.json().catch(() => ({}));
        const nuevoNivel = parseInt(body.nivel);
        if (![1, 2, 3, 4].includes(nuevoNivel)) {
          return json({ error: "El nivel debe ser 1, 2, 3 o 4" }, 400);
        }
        const nota = typeof body.nota === "string" ? body.nota.trim().slice(0, 500) : null;
        const nivelAnterior = user.nivel || 1;

        await env.DB.prepare("UPDATE users SET nivel = ?, nivel_nota = ? WHERE id = ?")
          .bind(nuevoNivel, nota, id).run();

        if (nuevoNivel !== nivelAnterior) {
          await env.DB.prepare(
            `INSERT INTO nivel_historial (usuario_id, usuario_nombre, nivel_anterior, nivel_nuevo, motivo, cambiado_por_id, cambiado_por_nombre)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(user.id, user.nombre, nivelAnterior, nuevoNivel, nota, payload.uid, payload.nombre).run();
        }

        const subeOBaja = nuevoNivel > nivelAnterior ? "subido" : (nuevoNivel < nivelAnterior ? "bajado" : "actualizado");
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "cambiar_nivel_usuario", entidad: "usuario", entidad_id: id,
          descripcion: `Ha ${subeOBaja} el nivel de "${user.nombre}" de ${nivelAnterior} a ${nuevoNivel}${nota ? `: ${nota}` : ""}`,
          detalle: { nivel_anterior: nivelAnterior, nivel_nuevo: nuevoNivel, nota },
        }));

        const userActualizado = await env.DB.prepare("SELECT id, nivel, nivel_nota, rol FROM users WHERE id = ?").bind(id).first();
        const progreso = await construirProgresoNivel(env, userActualizado);
        return json({ ok: true, ...progreso });
      }

      // ---------- USUARIOS: historial de cambios de nivel ----------
      const nivelHistorialMatch = path.match(/^\/api\/users\/(\d+)\/nivel-historial$/);
      if (nivelHistorialMatch && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede ver el historial de niveles" }, 403);
        const id = parseInt(nivelHistorialMatch[1]);
        const { results } = await env.DB.prepare(
          `SELECT nivel_anterior, nivel_nuevo, motivo, cambiado_por_nombre, created_at
           FROM nivel_historial WHERE usuario_id = ? ORDER BY created_at DESC LIMIT 50`
        ).bind(id).all();
        return json({ historial: results });
      }

      // ---------- USUARIOS: editar / eliminar ----------
      const userMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede editar usuarios" }, 403);
        const id = parseInt(userMatch[1]);
        const body = await request.json();
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
        if (!user) return json({ error: "Usuario no encontrado" }, 404);

        // Evita que un admin se quite a sí mismo el rol o se desactive,
        // para no quedarse fuera del panel por error.
        if (id === payload.uid && body.rol && body.rol !== "admin") {
          return json({ error: "No puedes quitarte a ti mismo el rol de administrador" }, 400);
        }
        if (id === payload.uid && body.activo === false) {
          return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
        }

        // El equipo solo lo puede cambiar un admin (esta ruta ya exige
        // rol admin arriba). Si no se manda "equipo" en el body, se deja
        // el que ya tuviera; si se manda, se valida que no pase de 3.
        let equipoActualizado = user.equipo;
        if (body.equipo !== undefined) {
          const { error: errorEquipo, equipos: equiposNuevos } = validarEquipos(body.equipo);
          if (errorEquipo) return json({ error: errorEquipo }, 400);
          equipoActualizado = equiposNuevos.length ? JSON.stringify(equiposNuevos) : null;
        }

        await env.DB.prepare(
          `UPDATE users SET nombre = ?, rol = ?, activo = ?, email = ?, equipo = ? WHERE id = ?`
        ).bind(
          body.nombre !== undefined ? body.nombre : user.nombre,
          body.rol === "admin" || body.rol === "redactor" ? body.rol : user.rol,
          body.activo === undefined ? user.activo : (body.activo ? 1 : 0),
          body.email !== undefined ? (body.email ? body.email.trim() : null) : user.email,
          equipoActualizado,
          id
        ).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_usuario", entidad: "usuario", entidad_id: id,
          descripcion: `Ha editado el usuario "${user.username}"`,
          detalle: body,
        }));

        return json({ ok: true });
      }

      if (userMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede eliminar usuarios" }, 403);
        const id = parseInt(userMatch[1]);
        if (id === payload.uid) return json({ error: "No puedes eliminar tu propia cuenta" }, 400);
        const userBorrado = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(id).first();
        // El historial de acciones guarda el nombre en texto aparte
        // (usuario_nombre), así que al eliminar la cuenta solo hace
        // falta soltar la referencia (usuario_id) para no chocar con la
        // clave foránea; las entradas de su actividad pasada se
        // conservan igual. Lo mismo para el resto de tablas que
        // referencian users(id): se limpia o reasigna la referencia
        // antes de borrar, si no D1 rechaza el DELETE por FOREIGN KEY.
        await env.DB.prepare("UPDATE activity_log SET usuario_id = NULL WHERE usuario_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE articles SET autor_id = NULL WHERE autor_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE articles SET coautor_id = NULL WHERE coautor_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE media SET autor_id = NULL WHERE autor_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE results SET autor_id = NULL WHERE autor_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE custom_clubs SET autor_id = NULL WHERE autor_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
        // usuario_id es NOT NULL en nivel_historial: no se puede poner a
        // NULL, así que se borra su historial de cambios de nivel.
        await env.DB.prepare("DELETE FROM nivel_historial WHERE usuario_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE nivel_historial SET cambiado_por_id = NULL WHERE cambiado_por_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM edit_requests WHERE solicitante_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE edit_requests SET autor_id = NULL WHERE autor_id = ?").bind(id).run();
        await env.DB.prepare("UPDATE edit_requests SET resuelta_por_id = NULL WHERE resuelta_por_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "eliminar_usuario", entidad: "usuario", entidad_id: id,
          descripcion: `Ha eliminado el usuario "${userBorrado ? userBorrado.username : id}"`,
        }));
        return json({ ok: true });
      }

      // ---------- MEDIA: subir contenido (fotos/vídeos) ----------
      // Cualquier usuario logueado (redactor o admin) puede subir. El
      // archivo se guarda en Cloudinary tal cual llega —sin recomprimir
      // ni transformar— para no perder ni un ápice de calidad.
      if (path === "/api/media" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);

        const form = await request.formData();
        const file = form.get("archivo");
        const titulo = (form.get("titulo") || "").toString().trim();
        const descripcion = (form.get("descripcion") || "").toString().trim();
        const club = (form.get("club") || "").toString().trim();

        if (!file || typeof file === "string") return json({ error: "Falta el archivo" }, 400);
        if (!titulo) return json({ error: "Falta el título" }, 400);

        // Se sube el archivo completo, byte a byte, sin ninguna
        // recodificación ni compresión: se guarda en Cloudinary
        // exactamente como llega, así se conserva la calidad original.
        // La validación (formato y tamaño) y la subida pasan por el mismo
        // punto único que usa /api/subir-imagen.
        let subida;
        try {
          subida = await procesarSubidaArchivo(env, file, { permitirVideo: true });
        } catch (err) {
          if (err.esValidacion) return json({ error: err.message }, 400);
          return json({ error: "No se pudo subir el archivo a Cloudinary", detail: err.message }, 502);
        }
        const esFoto = esImagenPermitida(file.type);

        await env.DB.prepare(
          `INSERT INTO media (cloudinary_public_id, cloudinary_resource_type, cloudinary_url, titulo, descripcion, tipo, nombre_archivo, content_type, tamano_bytes, autor_id, autor_nombre, club)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          subida.publicId, subida.resourceType, subida.url,
          titulo, descripcion || null, esFoto ? "foto" : "video",
          file.name, file.type, file.size, payload.uid, payload.nombre, club || null
        ).run();

        ctx.waitUntil(enviarEmailNotificacion(env, {
          asunto: `Nuevo ${esFoto ? "foto" : "vídeo"} subido: ${titulo}`,
          texto: `${payload.nombre} ha subido "${titulo}" (${esFoto ? "foto" : "vídeo"}) a ELOTROFÚTBOLTV.${club ? `\nClub: ${club}` : ""}${descripcion ? `\nDescripción: ${descripcion}` : ""}\n\nEntra en el panel de administración para verlo y descargarlo.`,
          html: plantillaEmail({
            etiqueta: `Nuevo ${esFoto ? "foto" : "vídeo"}`,
            titulo,
            parrafo: descripcion || null,
            filas: [
              { etiqueta: "Subido por", valor: payload.nombre },
              { etiqueta: "Club", valor: club },
            ],
            boton: { texto: "Ver en el panel", url: `${SITIO_URL}/admin/panel.html` },
          }),
        }));

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "subir_media", entidad: "media", entidad_id: subida.publicId,
          descripcion: `Ha subido ${esFoto ? "una foto" : "un vídeo"}: "${titulo}"`,
        }));

        return json({ ok: true });
      }

      // ---------- SUBIR IMAGEN SUELTA (foto de perfil, fotos de una noticia...) ----------
      // A diferencia de /api/media (que además guarda un registro en la
      // mediateca para poder descargarlo más tarde), este endpoint solo
      // sube la imagen a Cloudinary y devuelve su URL, para pegarla
      // directamente en el campo de foto de perfil o en las fotos de una
      // noticia/crónica sin pasar por ningún listado.
      if (path === "/api/subir-imagen" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);

        const form = await request.formData();
        const file = form.get("imagen");
        try {
          const subida = await procesarSubidaArchivo(env, file, { permitirVideo: false });
          return json({ url: subida.url });
        } catch (err) {
          if (err.esValidacion) return json({ error: err.message }, 400);
          return json({ error: "No se pudo subir la imagen", detail: err.message }, 502);
        }
      }

      const mediaMatch = path.match(/^\/api\/media\/(\d+)$/);

      // ---------- MEDIA: listado ----------
      // Los administradores ven todo lo subido por el equipo; un redactor
      // normal solo ve (y por tanto solo puede editar) lo que ha subido él.
      if (path === "/api/media" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const base = "SELECT id, cloudinary_url, titulo, descripcion, tipo, nombre_archivo, content_type, tamano_bytes, autor_id, autor_nombre, club, created_at FROM media";
        const { results } = payload.rol === "admin"
          ? await env.DB.prepare(`${base} ORDER BY created_at DESC`).all()
          : await env.DB.prepare(`${base} WHERE autor_id = ? ORDER BY created_at DESC`).bind(payload.uid).all();
        return json({ media: results });
      }

      // ---------- MEDIA: editar título/club/descripción ----------
      // Solo puede editar un archivo la persona que lo subió (comparando
      // autor_id con el usuario autenticado); no se puede sustituir el
      // archivo en sí, solo sus datos.
      if (mediaMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(mediaMatch[1]);
        const registro = await env.DB.prepare("SELECT autor_id FROM media WHERE id = ?").bind(id).first();
        if (!registro) return json({ error: "No encontrado" }, 404);
        if (registro.autor_id !== payload.uid) {
          return json({ error: "Solo la persona que subió este contenido puede editarlo" }, 403);
        }
        const body = await request.json();
        const titulo = (body.titulo || "").toString().trim();
        if (!titulo) return json({ error: "Falta el título" }, 400);
        const descripcion = (body.descripcion || "").toString().trim();
        const club = (body.club || "").toString().trim();
        await env.DB.prepare(
          "UPDATE media SET titulo = ?, descripcion = ?, club = ? WHERE id = ?"
        ).bind(titulo, descripcion || null, club || null, id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_media", entidad: "media", entidad_id: id,
          descripcion: `Ha editado el contenido "${titulo}"`,
        }));
        return json({ ok: true });
      }

      // ---------- MEDIA: descarga del archivo original (solo admins) ----------
      const mediaDownloadMatch = path.match(/^\/api\/media\/(\d+)\/descargar$/);
      if (mediaDownloadMatch && method === "GET") {
        const payload = await requireAuth(request, env, url);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede descargar contenido" }, 403);
        const id = parseInt(mediaDownloadMatch[1]);
        const registro = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first();
        if (!registro) return json({ error: "No encontrado" }, 404);

        const objeto = await fetch(registro.cloudinary_url);
        if (!objeto.ok) return json({ error: "El archivo ya no está disponible" }, 404);

        const headers = new Headers();
        headers.set("Content-Type", registro.content_type);
        headers.set("Content-Length", registro.tamano_bytes.toString());
        headers.set("Content-Disposition", `attachment; filename="${registro.nombre_archivo.replace(/"/g, "")}"`);
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "descargar_media", entidad: "media", entidad_id: id,
          descripcion: `Ha descargado el archivo "${registro.nombre_archivo}"`,
        }));
        return cors(new Response(objeto.body, { headers }));
      }

      // ---------- MEDIA: eliminar (solo admins) ----------
      if (mediaMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede eliminar contenido" }, 403);
        const id = parseInt(mediaMatch[1]);
        const registro = await env.DB.prepare("SELECT cloudinary_public_id, cloudinary_resource_type FROM media WHERE id = ?").bind(id).first();
        if (!registro) return json({ error: "No encontrado" }, 404);
        await borrarDeCloudinary(env, registro.cloudinary_public_id, registro.cloudinary_resource_type);
        await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "eliminar_media", entidad: "media", entidad_id: id,
          descripcion: `Ha eliminado un contenido multimedia (id ${id})`,
        }));
        return json({ ok: true });
      }

      // ---------- ARTICLES: lista pública / creación ----------
      if (path === "/api/articles" && method === "GET") {
        const categoria = url.searchParams.get("categoria");
        const club = url.searchParams.get("club");
        const tipo = url.searchParams.get("tipo");
        const autorId = url.searchParams.get("autor_id");
        const destacado = url.searchParams.get("destacado");
        const busqueda = url.searchParams.get("q");
        const limit = parseInt(url.searchParams.get("limit") || "30", 10);
        let admin = url.searchParams.get("admin") === "1";
        if (admin) {
          // La vista "admin" incluye borradores no publicados, así que
          // exige un token válido; si no lo hay, se trata como pública.
          const payload = await requireAuth(request, env);
          if (!payload) admin = false;
        }

        let query = "SELECT * FROM articles WHERE 1=1";
        const binds = [];
        if (!admin) {
          query += " AND publicado = 1";
        }
        if (categoria) { query += " AND categoria = ?"; binds.push(categoria); }
        if (club) { query += " AND club = ?"; binds.push(club); }
        if (tipo) { query += " AND tipo = ?"; binds.push(tipo); }
        if (autorId) { query += " AND autor_id = ?"; binds.push(parseInt(autorId, 10)); }
        if (destacado === "1") { query += " AND destacado = 1"; }
        if (destacado === "0") { query += " AND destacado = 0"; }
        if (busqueda) { query += " AND (titulo LIKE ? OR contenido LIKE ?)"; binds.push(`%${busqueda}%`, `%${busqueda}%`); }
        query += " ORDER BY fecha_publicacion DESC LIMIT ?";
        binds.push(limit);

        const { results } = await env.DB.prepare(query).bind(...binds).all();
        return json({ articles: results.map(conIdiomasDisponibles) });
      }

      if (path === "/api/articles" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        if (!body.titulo || !body.contenido) return json({ error: "Faltan campos obligatorios" }, 400);

        // Un redactor de Nivel 1 no puede publicar directamente noticias,
        // crónicas, artículos de opinión ni entrevistas: se guardan
        // siempre como borrador salvo que use "Última hora" con su PIN
        // de 4 dígitos. A partir de Nivel 2, el redactor ya publica
        // directo sin necesitar el PIN. Un admin siempre publica directo.
        let esUltimaHora = false;
        let nivelUsuario = payload.rol === "admin" ? NIVEL_MAXIMO : null;
        if (payload.rol !== "admin" && body.publicado !== false) {
          nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
          if (nivelUsuario < 2) {
            esUltimaHora = await comprobarUltimaHora(env, body.ultima_hora_pin);
            if (!esUltimaHora) body.publicado = false;
          }
        }

        // Programar publicación: un admin, o un redactor de Nivel 2+ (que
        // ya publica directo sin PIN de "Última hora"), puede dejar una
        // noticia programada para publicarse sola en una fecha/hora
        // futura. Si se manda "programado_para" con una fecha futura
        // válida, la noticia se guarda como no publicada (la publicará el
        // disparador programado del Worker cuando llegue esa hora) y sin
        // estado de borrador (no es un borrador normal, es una programación).
        let programadoPara = null;
        if (nivelUsuario === null) nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
        if ((payload.rol === "admin" || nivelUsuario >= 2) && body.programado_para) {
          const fechaProgramada = new Date(body.programado_para);
          // Se compara por minuto, no por milisegundo exacto: el input del
          // panel solo tiene granularidad de minuto, así que si se programa
          // para "dentro de 1 minuto" no debe rechazarse solo porque, con
          // la latencia de red hasta que la petición llega aquí, el reloj
          // exacto ya lo haya superado en unos segundos.
          const inicioMinutoActual = Math.floor(Date.now() / 60000) * 60000;
          if (!isNaN(fechaProgramada.getTime()) && fechaProgramada.getTime() >= inicioMinutoActual) {
            programadoPara = aSqliteDatetimeUTC(fechaProgramada);
            body.publicado = false;
          }
        }

        const longitudContenido = longitudTextoPlano(body.contenido);
        if (longitudContenido < CONTENIDO_MIN) {
          return json({ error: `El contenido debe tener al menos ${CONTENIDO_MIN} caracteres (tiene ${longitudContenido}).` }, 400);
        }
        if (longitudContenido > CONTENIDO_MAX) {
          return json({ error: `El contenido no puede superar los ${CONTENIDO_MAX} caracteres (tiene ${longitudContenido}).` }, 400);
        }
        let slug = await slugUnico(env, body.slug || body.titulo, null);

        // Estado del borrador (solo aplica si no se publica): "terminado"
        // o "en_proceso", según lo que haya contestado el redactor en la
        // notificación que se le muestra al guardar como borrador. Si se
        // publica directamente, no aplica (se guarda NULL).
        const estadoBorrador = body.publicado === false && !programadoPara
          ? (body.estado_borrador === "terminado" ? "terminado" : "en_proceso")
          : null;

        // Varias fotos: se guardan como JSON (con su posición dentro del
        // texto y su foco de recorte); la marcada como portada hace además
        // de "imagen_url", que es la que usan las tarjetas y el hero.
        const imagenes = normalizarImagenes(body.imagenes);
        const imagenPortada = body.imagen_url || (imagenes[0] && imagenes[0].url) || null;
        const resultadoId = body.resultado_id ? parseInt(body.resultado_id, 10) : null;

        // Autor de la noticia: por defecto quien la está subiendo, pero se
        // puede elegir a otra persona (p. ej. cuando quien sube la noticia
        // no es quien la ha redactado). Se busca siempre en la tabla de
        // usuarios (y no en el JWT) para firmar con el nombre actual y
        // para no poder "firmar" con un nombre inventado.
        const idAutorElegido = body.autor_id ? parseInt(body.autor_id, 10) : payload.uid;
        const autorElegido = await env.DB.prepare("SELECT id, nombre FROM users WHERE id = ? AND activo = 1")
          .bind(idAutorElegido).first();
        const autorId = autorElegido ? autorElegido.id : payload.uid;
        const autorNombre = autorElegido ? autorElegido.nombre : payload.nombre;

        // Segundo autor (coautor) opcional: una noticia se puede firmar
        // entre dos personas. Solo aporta el nombre extra; no cambia
        // permisos de edición ni nada más (eso lo sigue decidiendo el
        // autor principal). Si no se elige nadie o coincide con el
        // principal, se deja sin coautor.
        let coautorId = null, coautorNombre = null;
        if (body.coautor_id) {
          const idCoautorElegido = parseInt(body.coautor_id, 10);
          if (idCoautorElegido && idCoautorElegido !== autorId) {
            const coautorElegido = await env.DB.prepare("SELECT id, nombre FROM users WHERE id = ? AND activo = 1")
              .bind(idCoautorElegido).first();
            if (coautorElegido) { coautorId = coautorElegido.id; coautorNombre = coautorElegido.nombre; }
          }
        }

        const { campos: traducciones, avisos: avisosTraduccion } = extraerTraducciones(body);

        // El slug queda "congelado" desde el momento de crear la noticia
        // solo si se publica directamente (nace ya con enlace real y
        // compartible). Si nace como borrador o programada, el slug
        // sigue "vivo": se recalculará a partir del título en cada
        // guardado posterior hasta que se publique de verdad (ver PUT y
        // publicarArticulosProgramados).
        const slugCongelado = body.publicado !== false ? 1 : 0;

        await env.DB.prepare(
          `INSERT INTO articles (slug, titulo, subtitulo, contenido, tipo, categoria, club, imagen_url, imagenes, resultado_id, autor_id, autor_nombre, coautor_id, coautor_nombre, destacado, publicado, estado_borrador, programado_para, slug_congelado, fecha_publicacion, updated_at,
            titulo_eu, subtitulo_eu, contenido_eu, titulo_ca, subtitulo_ca, contenido_ca, titulo_gl, subtitulo_gl, contenido_gl, titulo_en, subtitulo_en, contenido_en, origin_write_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          slug, body.titulo, body.subtitulo || null, body.contenido,
          body.tipo || "noticia", body.categoria || "hypermotion", body.club || null,
          imagenPortada, imagenes.length ? JSON.stringify(imagenes) : null, resultadoId,
          autorId, autorNombre, coautorId, coautorNombre,
          body.destacado ? 1 : 0, body.publicado === false ? 0 : 1, estadoBorrador, programadoPara, slugCongelado,
          programadoPara || body.fecha_publicacion || new Date().toISOString(),
          traducciones.titulo_eu, traducciones.subtitulo_eu, traducciones.contenido_eu,
          traducciones.titulo_ca, traducciones.subtitulo_ca, traducciones.contenido_ca,
          traducciones.titulo_gl, traducciones.subtitulo_gl, traducciones.contenido_gl,
          traducciones.titulo_en, traducciones.subtitulo_en, traducciones.contenido_en,
          origenWriteId
        ).run();

        const publicado = body.publicado !== false;
        const tipoLabel = { noticia: "Noticia", cronica: "Crónica", opinion: "Opinión", entrevista: "Entrevista" }[body.tipo] || "Artículo";
        const firmaAutores = coautorNombre ? `${autorNombre} y ${coautorNombre}` : autorNombre;
        if (programadoPara) {
          // No se manda aviso por email al programarla: se mandará el
          // aviso normal de "publicada" cuando el disparador programado
          // la publique de verdad a su hora.
        } else if (publicado) {
          ctx.waitUntil(enviarEmailNotificacion(env, {
            asunto: `Nueva ${tipoLabel.toLowerCase()} publicada: ${body.titulo}`,
            texto: `${payload.nombre} ha publicado "${body.titulo}" (${tipoLabel}) en ELOTROFÚTBOLTV, firmada por ${firmaAutores}.\n\nVerla en la web: ${SITIO_URL}/noticia.html?slug=${slug}`,
            html: plantillaEmail({
              etiqueta: `Nueva ${tipoLabel.toLowerCase()}`,
              titulo: body.titulo,
              parrafo: body.subtitulo || null,
              filas: [
                { etiqueta: "Autor", valor: firmaAutores },
                { etiqueta: "Subida por", valor: payload.nombre },
                { etiqueta: "Categoría", valor: body.club || body.categoria },
              ],
              boton: { texto: "Ver la noticia", url: `${SITIO_URL}/noticia.html?slug=${slug}` },
            }),
          }));
        } else if (estadoBorrador === "terminado") {
          // Los borradores marcados como "terminados" (el redactor ha
          // respondido que sí en la notificación de "¿está terminada la
          // noticia?" al guardar) avisan por correo, pero sin enlace
          // publico (todavia no existe: el articulo no es visible en la
          // web hasta que se publique) y con una etiqueta distinta para
          // no confundirlo con una publicacion real. Si el redactor ha
          // dicho que todavía la está escribiendo ("en_proceso") no se
          // manda ningún correo, para no generar avisos de más.
          ctx.waitUntil(enviarEmailNotificacion(env, {
            asunto: `Nuevo borrador terminado: ${body.titulo}`,
            texto: `${payload.nombre} ha guardado el borrador "${body.titulo}" (${tipoLabel}) en ELOTROFÚTBOLTV, firmado por ${firmaAutores}, marcándolo como terminado. Todavía no está publicado.`,
            html: plantillaEmail({
              etiqueta: "Borrador terminado",
              titulo: body.titulo,
              parrafo: body.subtitulo || null,
              filas: [
                { etiqueta: "Autor", valor: firmaAutores },
                { etiqueta: "Guardado por", valor: payload.nombre },
                { etiqueta: "Categoría", valor: body.club || body.categoria },
              ],
            }),
          }));
        }

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: programadoPara ? "programar_articulo" : (publicado ? "crear_articulo" : "guardar_borrador"), entidad: "articulo", entidad_id: slug,
          descripcion: programadoPara
            ? `Ha programado "${tipoLabel.toLowerCase()}": "${body.titulo}" para publicarse el ${programadoPara}`
            : `Ha ${publicado ? "publicado" : "guardado el borrador de"} "${tipoLabel.toLowerCase()}": "${body.titulo}"${estadoBorrador ? ` (${estadoBorrador === "terminado" ? "terminado" : "en proceso"})` : ""}${esUltimaHora ? " (Última hora)" : ""}`,
        }));

        return json({ ok: true, slug, publicado, estado_borrador: estadoBorrador, programado_para: programadoPara, avisos_traduccion: avisosTraduccion });
      }

      // ---------- ARTICLE individual ----------
      const articleMatch = path.match(/^\/api\/articles\/([^/]+)$/);
      if (articleMatch && method === "GET") {
        const key = articleMatch[1];
        let article = await env.DB.prepare(
          "SELECT * FROM articles WHERE (slug = ?1 OR id = ?2) AND publicado = 1"
        ).bind(key, isNaN(key) ? -1 : parseInt(key)).first();

        // Si no hay noticia publicada con ese slug/id, se comprueba si
        // quien pregunta está autenticado y tiene permiso para editarla
        // (autor, coautor o admin): así el panel puede cargar un
        // borrador sin publicar -por ejemplo para gestionar sus
        // alineaciones o collages mientras se edita- sin que la web
        // pública llegue nunca a ver noticias no publicadas.
        if (!article) {
          const payloadAuth = await requireAuth(request, env);
          if (payloadAuth) {
            const borrador = await env.DB.prepare(
              "SELECT * FROM articles WHERE (slug = ?1 OR id = ?2)"
            ).bind(key, isNaN(key) ? -1 : parseInt(key)).first();
            if (borrador && await puedeEditar(env, payloadAuth, "articulo", borrador.id, borrador.autor_id, borrador.coautor_id)) {
              article = borrador;
            }
          }
        }

        if (!article) {
          // No está publicada con ese slug/id. Puede ser por dos motivos
          // (aparte de que simplemente no exista, ver el 404 al final):
          //
          // 1) Es un slug antiguo de una noticia cuyo título cambió
          //    mientras estaba en borrador/programada, y el slug se
          //    recalculó (ver "slug_congelado" en schema.sql): se
          //    redirige al slug actual.
          // 2) Es una noticia programada que todavía no ha llegado a su
          //    hora de publicación: se devuelve la info mínima para que
          //    la web pueda pintar un contador, sin publicado.
          const redirect = await env.DB.prepare(
            `SELECT a.slug FROM article_slug_redirects r
             JOIN articles a ON a.id = r.article_id
             WHERE r.slug_antiguo = ?`
          ).bind(key).first();
          if (redirect && redirect.slug !== key) {
            return json({ redirect: redirect.slug });
          }

          const programada = await env.DB.prepare(
            `SELECT slug, titulo, tipo, categoria, imagen_url, programado_para
             FROM articles WHERE slug = ?1 AND publicado = 0 AND programado_para IS NOT NULL AND programado_para > datetime('now')`
          ).bind(key).first();
          if (programada) {
            return json({ programado: programada });
          }

          return json({ error: "No encontrado" }, 404);
        }

        const articleConIdiomas = conIdiomasDisponibles(article);
        Object.assign(article, articleConIdiomas);

        // Fotos adicionales: de JSON guardado a array de verdad. Se
        // normalizan aquí también para que las noticias guardadas antes de
        // tener posición/foco de recorte (solo URLs en texto) lleguen al
        // frontend con el mismo formato que las nuevas.
        try {
          article.imagenes = normalizarImagenes(article.imagenes ? JSON.parse(article.imagenes) : []);
        } catch {
          article.imagenes = [];
        }

        // Si la noticia/crónica está vinculada a un partido, se adjunta
        // aquí su marcador para que la web lo pueda mostrar.
        if (article.resultado_id) {
          const resultado = await env.DB.prepare("SELECT * FROM results WHERE id = ?").bind(article.resultado_id).first();
          if (resultado) {
            // Se adjuntan también los goles/tarjetas del partido (tabla
            // match_events) para poder mostrar el detalle completo
            // (goles, tarjetas, estadio...) directamente dentro de la
            // noticia, no solo el marcador.
            const { results: eventos } = await env.DB.prepare(
              "SELECT * FROM match_events WHERE resultado_id = ? ORDER BY minuto ASC, minuto_extra ASC, orden ASC"
            ).bind(article.resultado_id).all();
            resultado.eventos = eventos || [];
          }
          article.resultado = resultado || null;
        } else {
          article.resultado = null;
        }

        // Si la noticia está vinculada a un partido, las alineaciones son
        // una única entidad compartida colgada del partido (result_id),
        // no de la noticia: así una noticia y su partido siempre muestran
        // exactamente la misma alineación, sin duplicados ni versiones
        // desincronizadas entre sí. Solo cuando NO hay partido vinculado
        // la noticia puede tener alineaciones propias (article_id).
        article.alineaciones = article.resultado_id
          ? await obtenerAlineaciones(env, "result_id", article.resultado_id)
          : await obtenerAlineaciones(env, "article_id", article.id);

        return json({ article });
      }

      if (articleMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(articleMatch[1]);

        // Solo el autor (o coautor, o un admin, o alguien con una
        // solicitud de edición aprobada y vigente para esta noticia)
        // puede editarla.
        const articuloParaPermiso = await env.DB.prepare("SELECT slug, autor_id, coautor_id, publicado, estado_borrador, fecha_publicacion, slug_congelado, resultado_id FROM articles WHERE id = ?").bind(id).first();
        if (!articuloParaPermiso) return json({ error: "Noticia no encontrada" }, 404);
        if (!(await puedeEditar(env, payload, "articulo", id, articuloParaPermiso.autor_id, articuloParaPermiso.coautor_id))) {
          return json({ error: "No puedes editar esta noticia porque no es tuya. Solicita permiso al autor o a un administrador." }, 403);
        }
        // Para que quede constancia en el historial de que esta edición
        // es una "revisión" (Nivel 4 corrigiendo contenido de otra
        // persona) y no una edición normal de lo propio, salvo que
        // además tenga un permiso temporal aprobado por edit_requests
        // (en ese caso ya queda igualmente registrado como antes).
        const esEdicionAjenaPorNivel4 = payload.rol !== "admin"
          && articuloParaPermiso.autor_id !== payload.uid
          && articuloParaPermiso.coautor_id !== payload.uid
          && !(await tienePermisoTemporal(env, payload, "articulo", id));
        // Un borrador marcado como "terminado" ya ha avisado por email a
        // la redacción de que está listo para subir: se bloquea para que
        // nadie (salvo un admin, o un redactor Nivel 4 revisando/
        // corrigiendo contenido ajeno) lo siga tocando, para no publicar
        // por error una versión distinta de la que se avisó. En cuanto un
        // admin lo publica, "estado_borrador" se limpia (ver más abajo) y
        // recupera el poder de edición con normalidad.
        const nivelParaBloqueoTerminado = payload.rol === "admin"
          ? NIVEL_MAXIMO
          : await obtenerNivelUsuario(env, payload.uid);
        if (nivelParaBloqueoTerminado < 4 && !articuloParaPermiso.publicado && articuloParaPermiso.estado_borrador === "terminado") {
          return json({ error: "Esta noticia está marcada como \"terminada\" y en espera de que un administrador la publique. No se puede editar hasta entonces." }, 403);
        }

        const body = await request.json();

        // Un redactor de Nivel 1 no puede publicar directamente al editar:
        // si no es admin y no ha llegado a Nivel 2, cualquier intento de
        // dejarla publicada (true, o sin mandar el campo, que por defecto
        // publicaría) se guarda siempre sin publicar salvo que use
        // "Última hora" con su PIN.
        let nivelUsuario = payload.rol === "admin" ? NIVEL_MAXIMO : null;
        if (payload.rol !== "admin" && body.publicado !== false) {
          nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
          if (nivelUsuario < 2) {
            const puedeUltimaHora = await comprobarUltimaHora(env, body.ultima_hora_pin);
            if (!puedeUltimaHora) body.publicado = false;
          }
        }

        // Programar publicación (igual que al crear): un admin, o un
        // redactor de Nivel 2+, puede dejarla programada para una fecha/
        // hora futura.
        let programadoPara = null;
        if (nivelUsuario === null) nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
        if ((payload.rol === "admin" || nivelUsuario >= 2) && body.programado_para) {
          const fechaProgramada = new Date(body.programado_para);
          // Mismo criterio que al crear: comparar por minuto, no por
          // milisegundo exacto, para no perder la programación por la
          // latencia de red entre que se envía y llega al servidor.
          const inicioMinutoActual = Math.floor(Date.now() / 60000) * 60000;
          if (!isNaN(fechaProgramada.getTime()) && fechaProgramada.getTime() >= inicioMinutoActual) {
            programadoPara = aSqliteDatetimeUTC(fechaProgramada);
            body.publicado = false;
          }
        }

        if (body.contenido !== undefined) {
          const longitudContenido = longitudTextoPlano(body.contenido);
          if (longitudContenido < CONTENIDO_MIN) {
            return json({ error: `El contenido debe tener al menos ${CONTENIDO_MIN} caracteres (tiene ${longitudContenido}).` }, 400);
          }
          if (longitudContenido > CONTENIDO_MAX) {
            return json({ error: `El contenido no puede superar los ${CONTENIDO_MAX} caracteres (tiene ${longitudContenido}).` }, 400);
          }
        }

        const imagenes = normalizarImagenes(body.imagenes);
        const imagenPortada = body.imagen_url || (imagenes[0] && imagenes[0].url) || null;
        const resultadoId = body.resultado_id ? parseInt(body.resultado_id, 10) : null;

        // Igual que al crear: si se guarda como borrador, se registra si
        // el redactor lo ha marcado como "terminado" o "en_proceso" en la
        // notificación del panel, para decidir más abajo si se avisa por
        // email a la redacción o no.
        const estadoBorrador = body.publicado === false && !programadoPara
          ? (body.estado_borrador === "terminado" ? "terminado" : "en_proceso")
          : null;

        // Si se ha elegido un autor en el formulario, se actualiza; si no
        // se manda nada, se deja el autor que ya tenía la noticia. Se
        // busca siempre en la tabla de usuarios para firmar con el nombre
        // actual y no poder "firmar" con un nombre inventado.
        const articuloActual = await env.DB.prepare("SELECT autor_id, autor_nombre, coautor_id, coautor_nombre FROM articles WHERE id = ?").bind(id).first();
        const idAutorElegido = body.autor_id
          ? parseInt(body.autor_id, 10)
          : (articuloActual ? articuloActual.autor_id : payload.uid);
        const autorElegido = await env.DB.prepare("SELECT id, nombre FROM users WHERE id = ? AND activo = 1")
          .bind(idAutorElegido).first();
        const autorId = autorElegido ? autorElegido.id : (articuloActual ? articuloActual.autor_id : payload.uid);
        const autorNombre = autorElegido ? autorElegido.nombre : (articuloActual ? articuloActual.autor_nombre : payload.nombre);

        // Segundo autor (coautor) opcional, igual que al crear. Si se
        // manda explícitamente "coautor_id: null" (o vacío) se quita el
        // coautor que hubiera; si no se manda el campo, se deja el que
        // ya tenía.
        let coautorId = articuloActual ? articuloActual.coautor_id : null;
        let coautorNombre = articuloActual ? articuloActual.coautor_nombre : null;
        if (Object.prototype.hasOwnProperty.call(body, "coautor_id")) {
          coautorId = null; coautorNombre = null;
          if (body.coautor_id) {
            const idCoautorElegido = parseInt(body.coautor_id, 10);
            if (idCoautorElegido && idCoautorElegido !== autorId) {
              const coautorElegido = await env.DB.prepare("SELECT id, nombre FROM users WHERE id = ? AND activo = 1")
                .bind(idCoautorElegido).first();
              if (coautorElegido) { coautorId = coautorElegido.id; coautorNombre = coautorElegido.nombre; }
            }
          }
        }

        const { campos: traducciones, avisos: avisosTraduccion } = extraerTraducciones(body);

        // Slug: mientras la noticia no se haya publicado nunca todavía
        // (ni lo estaba ya, ni lo está quedando ahora mismo por esta
        // misma edición), el slug sigue "vivo" y se recalcula a partir
        // del título en cada guardado. En cuanto se publica de verdad
        // (aquí mismo, o -para las programadas- cuando el disparador
        // programado la publique sola, ver publicarArticulosProgramados),
        // se congela para siempre. Si el slug cambia, se guarda el
        // antiguo en article_slug_redirects para no romper enlaces ya
        // compartidos.
        const vaAPublicarseAhora = body.publicado !== false && !programadoPara;
        const slugSigueVivo = !articuloParaPermiso.slug_congelado && !articuloParaPermiso.publicado;
        let slug = articuloParaPermiso.slug;
        if (slugSigueVivo && body.titulo) {
          slug = await slugUnico(env, body.titulo, id);
        }
        const slugCongeladoFinal = (articuloParaPermiso.slug_congelado || vaAPublicarseAhora) ? 1 : 0;

        // La fecha de publicación no debe "saltar" al día de hoy solo por
        // editar una noticia que ya estaba publicada de antes (eso movería
        // también la fecha de la imagen para redes, que debe quedarse fija
        // en el día real en que se subió la noticia). Solo se usa la fecha
        // que manda el formulario (el momento de guardar) cuando el
        // artículo se publica por primera vez en esta edición; si ya
        // estaba publicado, se conserva la fecha_publicacion que ya tenía.
        const fechaPublicacionFinal = programadoPara
          ? programadoPara
          : (articuloParaPermiso.publicado && articuloParaPermiso.fecha_publicacion)
            ? articuloParaPermiso.fecha_publicacion
            : (body.fecha_publicacion || new Date().toISOString());

        await env.DB.prepare(
          `UPDATE articles SET slug=?, titulo=?, subtitulo=?, contenido=?, tipo=?, categoria=?, club=?, imagen_url=?, imagenes=?, resultado_id=?, autor_id=?, autor_nombre=?, coautor_id=?, coautor_nombre=?, destacado=?, publicado=?, estado_borrador=?, programado_para=?, slug_congelado=?, fecha_publicacion=?, updated_at=datetime('now'),
            titulo_eu=?, subtitulo_eu=?, contenido_eu=?, titulo_ca=?, subtitulo_ca=?, contenido_ca=?, titulo_gl=?, subtitulo_gl=?, contenido_gl=?, titulo_en=?, subtitulo_en=?, contenido_en=?
           WHERE id=?`
        ).bind(
          slug, body.titulo, body.subtitulo || null, body.contenido, body.tipo || "noticia",
          body.categoria || "hypermotion", body.club || null, imagenPortada,
          imagenes.length ? JSON.stringify(imagenes) : null, resultadoId,
          autorId, autorNombre, coautorId, coautorNombre,
          body.destacado ? 1 : 0, body.publicado === false ? 0 : 1, estadoBorrador, programadoPara, slugCongeladoFinal,
          fechaPublicacionFinal,
          traducciones.titulo_eu, traducciones.subtitulo_eu, traducciones.contenido_eu,
          traducciones.titulo_ca, traducciones.subtitulo_ca, traducciones.contenido_ca,
          traducciones.titulo_gl, traducciones.subtitulo_gl, traducciones.contenido_gl,
          traducciones.titulo_en, traducciones.subtitulo_en, traducciones.contenido_en,
          id
        ).run();
        await registrarRedirectSiCambia(env, id, articuloParaPermiso.slug, slug);

        // Si esta edición vincula por primera vez la noticia a un
        // partido (no lo tenía antes y ahora sí), cualquier alineación
        // que la noticia tuviera colgada de sí misma (article_id) pasa a
        // colgar del partido (result_id): a partir de ahora la noticia y
        // el partido comparten una única alineación sincronizada, en vez
        // de arriesgarse a que queden dos copias independientes que se
        // desincronicen entre sí. Si el partido ya tenía sus propias
        // alineaciones, las de la noticia quedarían "de más": se
        // descartan (se borran) para no dejar filas duplicadas del mismo
        // equipo colgando del mismo partido.
        if (resultadoId && !articuloParaPermiso.resultado_id) {
          const alineacionesPropias = await obtenerAlineaciones(env, "article_id", id);
          if (alineacionesPropias.length) {
            const alineacionesPartido = await obtenerAlineaciones(env, "result_id", resultadoId);
            const equiposYaEnPartido = new Set(alineacionesPartido.map((a) => a.equipo));
            for (const a of alineacionesPropias) {
              if (equiposYaEnPartido.has(a.equipo)) {
                // Ya hay una alineación de ese mismo equipo en el
                // partido: se descarta la de la noticia para no duplicar.
                await env.DB.prepare("DELETE FROM alineaciones WHERE id = ?").bind(a.id).run();
              } else {
                await env.DB.prepare("UPDATE alineaciones SET article_id = NULL, result_id = ? WHERE id = ?").bind(resultadoId, a.id).run();
              }
            }
          }
        }

        // Igual que al crear: solo se avisa por email la primera vez que
        // el borrador pasa a "terminado" (si ya lo estaba y se sigue
        // guardando sin publicar -p. ej. un admin retocándolo antes de
        // subirlo-, no se repite el aviso cada vez que se guarda). Si se
        // ha publicado, o si sigue "en_proceso", tampoco se manda correo
        // aquí (al publicar de verdad ya llega el aviso de "Última hora"/
        // publicación por otro sitio del flujo).
        const yaEstabaTerminado = articuloParaPermiso.estado_borrador === "terminado";
        if (body.publicado === false && estadoBorrador === "terminado" && !yaEstabaTerminado) {
          const tipoLabel = { noticia: "Noticia", cronica: "Crónica", opinion: "Opinión", entrevista: "Entrevista" }[body.tipo] || "Artículo";
          const firmaAutores = coautorNombre ? `${autorNombre} y ${coautorNombre}` : autorNombre;
          ctx.waitUntil(enviarEmailNotificacion(env, {
            asunto: `Borrador terminado: ${body.titulo}`,
            texto: `${payload.nombre} ha editado y marcado como terminado el borrador "${body.titulo}" (${tipoLabel}) en ELOTROFÚTBOLTV, firmado por ${firmaAutores}. Todavía no está publicado.`,
            html: plantillaEmail({
              etiqueta: "Borrador terminado",
              titulo: body.titulo,
              parrafo: body.subtitulo || null,
              filas: [
                { etiqueta: "Autor", valor: firmaAutores },
                { etiqueta: "Guardado por", valor: payload.nombre },
                { etiqueta: "Categoría", valor: body.club || body.categoria },
              ],
            }),
          }));
        }

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_articulo", entidad: "articulo", entidad_id: id,
          descripcion: `Ha editado la noticia/crónica "${body.titulo}"${estadoBorrador ? ` (${estadoBorrador === "terminado" ? "borrador terminado" : "borrador en proceso"})` : ""}${esEdicionAjenaPorNivel4 ? " (revisión de contenido ajeno, Nivel 4)" : ""}`,
        }));
        return json({ ok: true, slug, publicado: body.publicado === false ? 0 : 1, estado_borrador: estadoBorrador, programado_para: programadoPara, avisos_traduccion: avisosTraduccion });
      }

      if (articleMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(articleMatch[1]);
        const articuloBorrado = await env.DB.prepare("SELECT titulo, autor_id, coautor_id FROM articles WHERE id = ?").bind(id).first();
        if (!articuloBorrado) return json({ error: "Noticia no encontrada" }, 404);
        // El borrado NO se abre a Nivel 4 igual que la edición: el
        // documento de niveles dice "revisar y corregir", no "eliminar
        // lo de otros". Por eso aquí se comprueba autoría/coautoría/admin
        // o permiso temporal aprobado, sin el atajo de nivel que sí tiene
        // puedeEditar() para PUT.
        const puedeBorrar = payload.rol === "admin"
          || articuloBorrado.autor_id === payload.uid
          || articuloBorrado.coautor_id === payload.uid
          || (await tienePermisoTemporal(env, payload, "articulo", id));
        if (!puedeBorrar) {
          return json({ error: "No puedes eliminar esta noticia porque no es tuya. Solicita permiso al autor o a un administrador." }, 403);
        }
        await env.DB.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "eliminar_articulo", entidad: "articulo", entidad_id: id,
          descripcion: `Ha eliminado la noticia/crónica "${articuloBorrado ? articuloBorrado.titulo : id}"`,
        }));
        return json({ ok: true });
      }

      // ---------- ÚLTIMA HORA: PIN único, solo visible/regenerable por un admin ----------
      if (path === "/api/settings/ultima-hora-pin" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede ver el PIN de Última hora" }, 403);
        const pin = await obtenerUltimaHoraPin(env);
        return json({ pin });
      }
      // Lo regenera a mano (por si se ha compartido de más y quiere invalidarlo
      // ya, sin esperar a que se use). También se regenera solo tras cada uso.
      if (path === "/api/settings/ultima-hora-pin/regenerar" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede regenerar el PIN de Última hora" }, 403);
        const pin = await regenerarUltimaHoraPin(env);
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "regenerar_pin_ultima_hora", entidad: "settings", entidad_id: 0,
          descripcion: `Ha regenerado el PIN de "Última hora"`,
        }));
        return json({ ok: true, pin });
      }

      // ---------- SOLICITUDES DE EDICIÓN ----------
      // Un redactor pide permiso para editar una noticia/crónica/opinión/
      // entrevista o un resultado que no es suyo. Lo puede aprobar
      // cualquiera de los dos: un admin, o el autor original.
      if (path === "/api/edit-requests" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        // Sin filtro: un admin ve todas. Un redactor ve solo las que ha
        // hecho él, o las que le tocaría aprobar (porque es el autor
        // original de la entidad en cuestión).
        let query = `SELECT * FROM edit_requests WHERE 1=1`;
        const binds = [];
        if (payload.rol !== "admin") {
          query += ` AND (solicitante_id = ? OR autor_id = ?)`;
          binds.push(payload.uid, payload.uid);
        }
        const estado = url.searchParams.get("estado");
        if (estado) { query += " AND estado = ?"; binds.push(estado); }
        query += " ORDER BY created_at DESC LIMIT 200";
        const { results } = await env.DB.prepare(query).bind(...binds).all();

        // Se enriquece cada solicitud con los datos que necesita el panel
        // para mostrar el detalle completo a un admin: quién la pide, de
        // quién es originalmente el contenido, y qué noticia/resultado es
        // exactamente (título, tipo, estado de publicación...).
        const solicitudes = await Promise.all(results.map(async (s) => {
          const [solicitante, autor] = await Promise.all([
            env.DB.prepare("SELECT id, nombre, username, email FROM users WHERE id = ?").bind(s.solicitante_id).first(),
            s.autor_id ? env.DB.prepare("SELECT id, nombre, username, email FROM users WHERE id = ?").bind(s.autor_id).first() : null,
          ]);
          let entidad = null;
          if (s.tipo_entidad === "resultado") {
            entidad = await env.DB.prepare(
              "SELECT id, equipo_local, equipo_visitante, competicion, estado FROM results WHERE id = ?"
            ).bind(s.entidad_id).first();
          } else {
            entidad = await env.DB.prepare(
              "SELECT id, titulo, subtitulo, tipo, categoria, publicado, estado_borrador FROM articles WHERE id = ?"
            ).bind(s.entidad_id).first();
          }
          let resuelta_por = null;
          if (s.resuelta_por_id) {
            resuelta_por = await env.DB.prepare("SELECT id, nombre FROM users WHERE id = ?").bind(s.resuelta_por_id).first();
          }
          return {
            ...s,
            solicitante_nombre: solicitante ? solicitante.nombre : null,
            solicitante_username: solicitante ? solicitante.username : null,
            solicitante_email: solicitante ? solicitante.email : null,
            autor_nombre: autor ? autor.nombre : null,
            autor_username: autor ? autor.username : null,
            entidad_titulo: entidad ? (entidad.titulo || (entidad.equipo_local && entidad.equipo_visitante ? `${entidad.equipo_local} - ${entidad.equipo_visitante}` : null)) : null,
            entidad_subtitulo: entidad ? (entidad.subtitulo || null) : null,
            entidad_tipo: entidad ? (entidad.tipo || null) : null,
            entidad_categoria: entidad ? (entidad.categoria || entidad.competicion || null) : null,
            entidad_publicado: entidad ? (s.tipo_entidad === "resultado" ? null : Boolean(entidad.publicado)) : null,
            entidad_estado_borrador: entidad ? (entidad.estado_borrador || null) : null,
            entidad_existe: Boolean(entidad),
            resuelta_por_nombre: resuelta_por ? resuelta_por.nombre : null,
          };
        }));

        return json({ solicitudes });
      }

      if (path === "/api/edit-requests" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        const tipoEntidad = body.tipo_entidad === "resultado" ? "resultado" : "articulo";
        const entidadId = parseInt(body.entidad_id, 10);
        if (!entidadId) return json({ error: "Falta el elemento a solicitar" }, 400);

        const tabla = tipoEntidad === "resultado" ? "results" : "articles";
        const camposEntidad = tipoEntidad === "resultado" ? "autor_id" : "autor_id, coautor_id";
        const entidad = await env.DB.prepare(`SELECT ${camposEntidad} FROM ${tabla} WHERE id = ?`).bind(entidadId).first();
        if (!entidad) return json({ error: "El elemento no existe" }, 404);

        // Si ya puede editarlo (es suyo, es coautor, es admin, o ya tiene
        // un permiso vigente), no tiene sentido crear una solicitud nueva.
        if (await puedeEditar(env, payload, tipoEntidad, entidadId, entidad.autor_id, entidad.coautor_id)) {
          return json({ error: "Ya puedes editar este elemento, no hace falta solicitarlo." }, 400);
        }

        // Evita duplicar solicitudes: si ya hay una pendiente igual, no
        // se crea otra.
        const yaExiste = await env.DB.prepare(
          `SELECT id FROM edit_requests WHERE tipo_entidad=? AND entidad_id=? AND solicitante_id=? AND estado='pendiente'`
        ).bind(tipoEntidad, entidadId, payload.uid).first();
        if (yaExiste) return json({ error: "Ya tienes una solicitud pendiente para este elemento." }, 400);

        await env.DB.prepare(
          `INSERT INTO edit_requests (tipo_entidad, entidad_id, solicitante_id, autor_id, motivo, estado)
           VALUES (?, ?, ?, ?, ?, 'pendiente')`
        ).bind(tipoEntidad, entidadId, payload.uid, entidad.autor_id || null, body.motivo ? String(body.motivo).slice(0, 500) : null).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "solicitar_edicion", entidad: tipoEntidad, entidad_id: entidadId,
          descripcion: `${payload.nombre} ha solicitado permiso para editar ${tipoEntidad === "resultado" ? "un resultado" : "una noticia/crónica"} que no es suya`,
        }));
        return json({ ok: true });
      }

      const editRequestMatch = path.match(/^\/api\/edit-requests\/(\d+)$/);
      if (editRequestMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(editRequestMatch[1]);
        const body = await request.json();
        const accion = body.accion === "rechazar" ? "rechazar" : "aprobar";

        const solicitud = await env.DB.prepare("SELECT * FROM edit_requests WHERE id = ?").bind(id).first();
        if (!solicitud) return json({ error: "Solicitud no encontrada" }, 404);
        if (solicitud.estado !== "pendiente") return json({ error: "Esta solicitud ya se ha resuelto" }, 400);

        // Solo puede resolverla un admin o el autor original de la entidad.
        const esAutorOriginal = solicitud.autor_id && solicitud.autor_id === payload.uid;
        if (payload.rol !== "admin" && !esAutorOriginal) {
          return json({ error: "Solo un administrador o el autor original pueden responder a esta solicitud" }, 403);
        }

        if (accion === "rechazar") {
          await env.DB.prepare(
            `UPDATE edit_requests SET estado='rechazada', resuelta_por_id=?, resuelta_at=datetime('now') WHERE id=?`
          ).bind(payload.uid, id).run();
        } else {
          await env.DB.prepare(
            `UPDATE edit_requests SET estado='aprobada', resuelta_por_id=?, resuelta_at=datetime('now'),
              permiso_expira_at=datetime('now', '+${EDIT_GRANT_MINUTOS} minutes') WHERE id=?`
          ).bind(payload.uid, id).run();
        }

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: accion === "rechazar" ? "rechazar_solicitud_edicion" : "aprobar_solicitud_edicion",
          entidad: solicitud.tipo_entidad, entidad_id: solicitud.entidad_id,
          descripcion: `${payload.nombre} ha ${accion === "rechazar" ? "rechazado" : "aprobado"} una solicitud de edición`,
        }));
        return json({ ok: true });
      }

      // ---------- RESULTS ----------
      // ---------- CLUBES PERSONALIZADOS ("Otro equipo") ----------
      // Lista pública (no requiere login) de los clubes que se han ido
      // añadiendo a mano desde "Otro equipo (no está en la lista)". El
      // frontend los combina con los fijos de public/js/clubs.js para
      // que, a partir de la primera vez que se usa un equipo nuevo,
      // aparezca ya en el desplegable normal en vez de tener que volver
      // a escribirlo cada vez.
      if (path === "/api/custom-clubs" && method === "GET") {
        const categoria = url.searchParams.get("categoria");
        let query = "SELECT nombre, categoria, escudo_url FROM custom_clubs";
        const binds = [];
        if (categoria) {
          query += " WHERE categoria = ?";
          binds.push(categoria);
        }
        query += " ORDER BY nombre COLLATE NOCASE ASC";
        const { results: clubes } = await env.DB.prepare(query).bind(...binds).all();
        return json({ clubes });
      }

      // Da de alta un club nuevo (o actualiza su escudo si ya existía en
      // esa misma categoría). Requiere login, igual que crear un
      // resultado o una noticia, que es desde donde se llama.
      if (path === "/api/custom-clubs" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        const nombre = normalizarTexto(body.nombre);
        const categoria = normalizarTexto(body.categoria);
        if (!nombre) return json({ error: "Falta el nombre del club" }, 400);
        if (!categoria) return json({ error: "Falta la categoría del club" }, 400);
        const escudoUrl = normalizarTexto(body.escudo_url);
        await env.DB.prepare(
          `INSERT INTO custom_clubs (nombre, categoria, escudo_url, autor_id, autor_nombre)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(nombre, categoria) DO UPDATE SET
             escudo_url = COALESCE(excluded.escudo_url, custom_clubs.escudo_url)`
        ).bind(nombre, categoria, escudoUrl, payload.uid, payload.nombre).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "crear_club_personalizado", entidad: "club",
          descripcion: `Ha añadido "${nombre}" a la lista de clubes de ${categoria}`,
        }));
        return json({ ok: true });
      }

      // ---------- Comentarios de lectores ----------
      // Público: solo texto/nombre/email del propio comentario, sin
      // exponer nunca el email de otros comentarios ya aprobados.
      const comentariosArticuloMatch = path.match(/^\/api\/articles\/(\d+)\/comments$/);
      if (comentariosArticuloMatch && method === "GET") {
        const articleId = parseInt(comentariosArticuloMatch[1]);
        const { results: comentarios } = await env.DB.prepare(
          "SELECT id, nombre, texto, created_at FROM comments WHERE article_id = ? AND estado = 'aprobado' ORDER BY created_at ASC"
        ).bind(articleId).all();
        return json({ comentarios });
      }

      if (comentariosArticuloMatch && method === "POST") {
        const articleId = parseInt(comentariosArticuloMatch[1]);
        const articulo = await env.DB.prepare("SELECT id FROM articles WHERE id = ? AND publicado = 1").bind(articleId).first();
        if (!articulo) return json({ error: "Noticia no encontrada" }, 404);

        const body = await request.json();
        const nombre = normalizarTexto(body.nombre);
        const email = normalizarTexto(body.email);
        const texto = normalizarTexto(body.texto);
        if (!nombre) return json({ error: "Falta tu nombre" }, 400);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "El email no es válido" }, 400);
        if (!texto) return json({ error: "El comentario no puede estar vacío" }, 400);
        if (texto.length > 2000) return json({ error: "El comentario es demasiado largo (máximo 2000 caracteres)" }, 400);

        const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || null;
        await env.DB.prepare(
          `INSERT INTO comments (article_id, nombre, email, texto, ip) VALUES (?, ?, ?, ?, ?)`
        ).bind(articleId, nombre, email, texto, ip).run();

        return json({ ok: true, mensaje: "Comentario enviado. Se publicará en cuanto lo revise la redacción." });
      }

      // Admin: listar (por estado), aprobar/rechazar y borrar.
      if (path === "/api/admin/comments" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede moderar comentarios" }, 403);

        const estado = url.searchParams.get("estado") || "pendiente";
        const { results: comentarios } = await env.DB.prepare(
          `SELECT c.*, a.titulo AS articulo_titulo, a.slug AS articulo_slug
           FROM comments c JOIN articles a ON a.id = c.article_id
           WHERE c.estado = ? ORDER BY c.created_at DESC`
        ).bind(estado).all();
        return json({ comentarios });
      }

      const comentarioMatch = path.match(/^\/api\/admin\/comments\/(\d+)$/);
      if (comentarioMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede moderar comentarios" }, 403);

        const id = parseInt(comentarioMatch[1]);
        const body = await request.json();
        if (!["aprobado", "rechazado", "pendiente"].includes(body.estado)) {
          return json({ error: "Estado no válido" }, 400);
        }
        const resultado = await env.DB.prepare(
          "UPDATE comments SET estado = ?, moderado_por_id = ?, moderado_at = datetime('now') WHERE id = ?"
        ).bind(body.estado, payload.uid, id).run();
        if (!resultado.meta.changes) return json({ error: "Comentario no encontrado" }, 404);

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "moderar_comentario", entidad: "comentario", entidad_id: id,
          descripcion: `Ha marcado un comentario como "${body.estado}"`,
        }));
        return json({ ok: true });
      }

      if (comentarioMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede borrar comentarios" }, 403);

        const id = parseInt(comentarioMatch[1]);
        const resultado = await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
        if (!resultado.meta.changes) return json({ error: "Comentario no encontrado" }, 404);

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "borrar_comentario", entidad: "comentario", entidad_id: id,
          descripcion: "Ha borrado un comentario",
        }));
        return json({ ok: true });
      }

      // ---------- Ficha informativa de club (entrenador, estadio...) ----------
      if (path === "/api/club-info" && method === "GET") {
        const club = url.searchParams.get("club");
        if (!club) return json({ error: "Falta el club" }, 400);
        const info = await env.DB.prepare(
          "SELECT club, entrenador, estadio, fundacion, ciudad FROM club_info WHERE club = ?"
        ).bind(club).first();
        return json({ info: info || null });
      }

      if (path === "/api/admin/club-info" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const { results: fichas } = await env.DB.prepare(
          "SELECT * FROM club_info ORDER BY club COLLATE NOCASE ASC"
        ).all();
        return json({ fichas });
      }

      // Propuestas de ficha de club pendientes de revisión (las crea un
      // redactor de Nivel 1). Un admin o un redactor de Nivel 4 ve TODAS
      // las pendientes (para poder resolverlas); cualquier otro usuario
      // solo ve las suyas propias (para saber en qué punto están).
      if (path === "/api/admin/club-info/solicitudes" && method === "GET") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
        const puedeResolver = payload.rol === "admin" || nivelUsuario >= NIVEL_MAXIMO;
        const { results: solicitudes } = puedeResolver
          ? await env.DB.prepare("SELECT * FROM club_info_solicitudes WHERE estado = 'pendiente' ORDER BY created_at ASC").all()
          : await env.DB.prepare("SELECT * FROM club_info_solicitudes WHERE estado = 'pendiente' AND solicitante_id = ? ORDER BY created_at ASC").bind(payload.uid).all();
        return json({ solicitudes, puede_resolver: puedeResolver });
      }

      if (path === "/api/club-info" && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);

        const body = await request.json();
        const club = normalizarTexto(body.club);
        if (!club) return json({ error: "Falta el nombre del club" }, 400);
        const entrenador = normalizarTexto(body.entrenador);
        const estadio = normalizarTexto(body.estadio);
        const ciudad = normalizarTexto(body.ciudad);
        const fundacion = body.fundacion ? parseInt(body.fundacion) : null;
        if (fundacion !== null && (isNaN(fundacion) || fundacion < 1800 || fundacion > 2100)) {
          return json({ error: "El año de fundación no es válido" }, 400);
        }

        // Un redactor de Nivel 1 no aplica el cambio directamente: se
        // guarda como propuesta pendiente de aprobación (por un admin o
        // un redactor de Nivel 4). A partir de Nivel 2 se aplica
        // directo, igual que un admin.
        const nivelUsuario = payload.rol === "admin" ? NIVEL_MAXIMO : await obtenerNivelUsuario(env, payload.uid);
        if (payload.rol !== "admin" && nivelUsuario < 2) {
          await env.DB.prepare(
            `INSERT INTO club_info_solicitudes (club, entrenador, estadio, fundacion, ciudad, solicitante_id, solicitante_nombre)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(club, entrenador, estadio, fundacion, ciudad, payload.uid, payload.nombre).run();

          ctx.waitUntil(registrarActividad(env, request, payload, {
            accion: "proponer_club_info", entidad: "club",
            descripcion: `Ha propuesto una ficha para el ${club}, pendiente de aprobación`,
          }));
          return json({ ok: true, pendiente: true });
        }

        await env.DB.prepare(
          `INSERT INTO club_info (club, entrenador, estadio, fundacion, ciudad, autor_id, autor_nombre, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(club) DO UPDATE SET
             entrenador = excluded.entrenador,
             estadio = excluded.estadio,
             fundacion = excluded.fundacion,
             ciudad = excluded.ciudad,
             autor_id = excluded.autor_id,
             autor_nombre = excluded.autor_nombre,
             updated_at = datetime('now')`
        ).bind(club, entrenador, estadio, fundacion, ciudad, payload.uid, payload.nombre).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_club_info", entidad: "club",
          descripcion: `Ha actualizado la ficha del ${club}`,
        }));
        return json({ ok: true, pendiente: false });
      }

      // Aprobar o rechazar una propuesta de ficha de club. Solo un admin
      // o un redactor de Nivel 4 puede hacerlo.
      if (path.match(/^\/api\/admin\/club-info\/solicitudes\/\d+$/) && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const nivelUsuario = await obtenerNivelUsuario(env, payload.uid);
        if (payload.rol !== "admin" && nivelUsuario < NIVEL_MAXIMO) {
          return json({ error: "No tienes permiso para resolver propuestas" }, 403);
        }

        const id = parseInt(path.split("/").pop());
        const body = await request.json();
        const accion = body.accion === "rechazar" ? "rechazar" : "aprobar";

        const solicitud = await env.DB.prepare("SELECT * FROM club_info_solicitudes WHERE id = ?").bind(id).first();
        if (!solicitud) return json({ error: "Propuesta no encontrada" }, 404);
        if (solicitud.estado !== "pendiente") return json({ error: "Esta propuesta ya se ha resuelto" }, 400);

        if (accion === "aprobar") {
          await env.DB.prepare(
            `INSERT INTO club_info (club, entrenador, estadio, fundacion, ciudad, autor_id, autor_nombre, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(club) DO UPDATE SET
               entrenador = excluded.entrenador,
               estadio = excluded.estadio,
               fundacion = excluded.fundacion,
               ciudad = excluded.ciudad,
               autor_id = excluded.autor_id,
               autor_nombre = excluded.autor_nombre,
               updated_at = datetime('now')`
          ).bind(solicitud.club, solicitud.entrenador, solicitud.estadio, solicitud.fundacion, solicitud.ciudad, solicitud.solicitante_id, solicitud.solicitante_nombre).run();
        }

        await env.DB.prepare(
          `UPDATE club_info_solicitudes SET estado = ?, resuelta_por_id = ?, resuelta_por_nombre = ?, resuelta_at = datetime('now') WHERE id = ?`
        ).bind(accion === "aprobar" ? "aprobada" : "rechazada", payload.uid, payload.nombre, id).run();

        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: accion === "aprobar" ? "aprobar_club_info" : "rechazar_club_info",
          entidad: "club", entidad_id: id,
          descripcion: `${payload.nombre} ha ${accion === "aprobar" ? "aprobado" : "rechazado"} la propuesta de ficha del ${solicitud.club}`,
        }));
        return json({ ok: true });
      }

      if (path === "/api/club-info" && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        if (payload.rol !== "admin") return json({ error: "Solo un administrador puede borrar la ficha de un club" }, 403);
        const club = url.searchParams.get("club");
        if (!club) return json({ error: "Falta el club" }, 400);
        await env.DB.prepare("DELETE FROM club_info WHERE club = ?").bind(club).run();
        return json({ ok: true });
      }

      // Estados válidos de un partido. "retrasado" y "anulado" son
      // nuevos: un partido retrasado sigue "programado" a efectos de
      // cronómetro (no arranca hasta la nueva hora); uno anulado no
      // vuelve a arrancar nunca (se congela tal cual quedase).
      const ESTADOS_RESULTADO_VALIDOS = ["programado", "en_juego", "retrasado", "anulado", "finalizado"];

      // Minutos transcurridos entre la hora programada del partido
      // (fecha_partido) y ahora. Se usa cuando el estado se pone
      // "en_juego" a mano (desde el formulario manual) para arrancar el
      // cronómetro ya avanzado en vez de desde 0, igual que si el cron
      // lo hubiera arrancado a su hora y el redactor solo estuviera
      // corrigiendo el estado a posteriori. 0 si no hay fecha con hora,
      // o si la hora programada todavía no ha llegado.
      function minutosDesdeHoraProgramada(fechaPartido) {
        // fecha_partido es hora de Madrid, no UTC: se convierte con el
        // mismo helper que usa el cron (fechaPartidoAUtcSqlite) antes de
        // restar contra "ahora", si no el cálculo salía desviado 1-2h.
        const inicioUtcSqlite = fechaPartidoAUtcSqlite(fechaPartido);
        if (inicioUtcSqlite === null) return 0; // sin hora conocida ("YYYY-MM-DD" a secas)
        const inicio = new Date(inicioUtcSqlite.replace(" ", "T") + "Z").getTime();
        if (isNaN(inicio)) return 0;
        const minutos = Math.floor((Date.now() - inicio) / 60000);
        return minutos > 0 ? minutos : 0;
      }

      if (path === "/api/results" && method === "GET") {
        const competicion = url.searchParams.get("competicion");
        const estado = url.searchParams.get("estado");
        const grupo = url.searchParams.get("grupo");
        // Filtro por equipo (para la página de equipo y el desplegable de
        // Resultados): un partido "pertenece" a un club tanto si juega en
        // casa como fuera, así que se compara contra las dos columnas.
        const club = url.searchParams.get("club");
        // El límite era fijo (100) e ignoraba el "?limit=" que ya mandaba
        // el frontend (el panel de admin pide 200 para no dejarse partidos
        // fuera). Si un resultado quedaba fuera de esos 100 primeros, el
        // panel de Minuto a Minuto dejaba de encontrarlo al refrescar tras
        // "Iniciar partido" y se quedaba con los datos previos en memoria
        // (sin inicio_cronometro_at), así que el cronómetro no arrancaba
        // nunca aunque el backend sí lo hubiera guardado bien.
        const limitParam = parseInt(url.searchParams.get("limit"), 10);
        const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 500 ? limitParam : 100;
        let query = "SELECT * FROM results WHERE 1=1";
        const binds = [];
        if (competicion) { query += " AND competicion = ?"; binds.push(competicion); }
        if (estado) { query += " AND estado = ?"; binds.push(estado); }
        if (grupo) { query += " AND grupo = ?"; binds.push(grupo); }
        if (club) {
          query += " AND (equipo_local = ? OR equipo_visitante = ?)";
          binds.push(club, club);
        }
        query += ` ORDER BY jornada DESC, fecha_partido DESC LIMIT ${limit}`;
        const { results } = await env.DB.prepare(query).bind(...binds).all();
        return json({ results });
      }

      if (path === "/api/results" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        if (body.estado && !ESTADOS_RESULTADO_VALIDOS.includes(body.estado)) {
          return json({ error: "Estado no válido" }, 400);
        }
        // No se deja crear un resultado si falta algún dato básico (el
        // frontend ya valida esto mismo, pero se repite aquí para que
        // tampoco se pueda colar un partido incompleto llamando a la API
        // directamente). "jornada" no se exige para "amistoso", que no
        // usa jornadas.
        if (!body.competicion) return json({ error: "Falta la competición" }, 400);
        if (!body.equipo_local || !String(body.equipo_local).trim()) return json({ error: "Falta el equipo local" }, 400);
        if (!body.equipo_visitante || !String(body.equipo_visitante).trim()) return json({ error: "Falta el equipo visitante" }, 400);
        if (String(body.equipo_local).trim().toLowerCase() === String(body.equipo_visitante).trim().toLowerCase()) {
          return json({ error: "El equipo local y el visitante no pueden ser el mismo" }, 400);
        }
        if (!body.fecha_partido) return json({ error: "Falta la fecha del partido" }, 400);
        if (!body.estado) return json({ error: "Falta el estado del partido" }, 400);
        if (body.competicion !== "amistoso" && (body.jornada === undefined || body.jornada === null || body.jornada === "")) {
          return json({ error: "Falta la jornada" }, 400);
        }
        if (body.estado === "retrasado" && !body.fecha_partido_retrasado) {
          return json({ error: "Falta la nueva fecha/hora del partido retrasado" }, 400);
        }
        if ((body.estado === "en_juego" || body.estado === "finalizado") &&
            (body.goles_local === undefined || body.goles_local === null || body.goles_visitante === undefined || body.goles_visitante === null)) {
          return json({ error: "Falta el marcador (goles de ambos equipos)" }, 400);
        }
        // Aviso de posible duplicado: mismo partido (mismos equipos, en
        // cualquier orden -por si se han metido al revés local/visitante-,
        // misma competición, misma fecha/hora Y MISMO MARCADOR) ya
        // existente. Solo se avisa cuando es EXACTAMENTE igual -si el
        // marcador es distinto no tiene sentido el aviso, ya que
        // claramente no es el mismo resultado tecleado dos veces-. No se
        // bloquea la creación -puede ser un caso real, como un derbi que
        // efectivamente se repite en amistoso el mismo día con el mismo
        // resultado-, solo se avisa una vez: si el frontend reenvía la
        // petición con "confirmar_duplicado: true" (tras que el redactor
        // confirme), se crea igualmente sin volver a comprobar.
        if (!body.confirmar_duplicado && body.equipo_local && body.equipo_visitante && body.fecha_partido) {
          const golesLocalBody = body.goles_local ?? null;
          const golesVisitanteBody = body.goles_visitante ?? null;
          const posibleDuplicado = await env.DB.prepare(
            `SELECT id, competicion, grupo, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado
             FROM results
             WHERE competicion = ? AND fecha_partido = ?
               AND goles_local IS ? AND goles_visitante IS ?
               AND ((equipo_local = ? AND equipo_visitante = ?) OR (equipo_local = ? AND equipo_visitante = ?))
             LIMIT 1`
          ).bind(
            body.competicion, body.fecha_partido,
            golesLocalBody, golesVisitanteBody,
            body.equipo_local, body.equipo_visitante,
            body.equipo_visitante, body.equipo_local
          ).first();
          if (posibleDuplicado) {
            return json({ posible_duplicado: true, partido_existente: posibleDuplicado }, 409);
          }
        }
        const flashscoreUrl = flashscoreUrlValido(body.competicion, body.estado, body.flashscore_url);
        const insertResult = await env.DB.prepare(
          `INSERT INTO results (competicion, grupo, jornada, equipo_local, equipo_visitante, goles_local, goles_visitante, fecha_partido, estado, ubicacion, flashscore_url, escudo_local_url, escudo_visitante_url, autor_id, autor_nombre, origin_write_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          body.competicion, body.grupo || null, body.jornada, body.equipo_local, body.equipo_visitante,
          body.goles_local ?? null, body.goles_visitante ?? null, body.fecha_partido || null, body.estado || "programado",
          body.ubicacion || null, flashscoreUrl,
          body.escudo_local_url || null, body.escudo_visitante_url || null,
          payload.uid, payload.nombre, origenWriteId
        ).run();
        const nuevoId = insertResult.meta.last_row_id;
        // Si se crea directamente en estado "en_juego" a mano, se arranca
        // el cronómetro igual que si lo hubiera arrancado el cron a su
        // hora (mismo camino único, ver iniciarCronometroPartido): se
        // calcula cuántos minutos han pasado ya desde la hora programada
        // para no arrancar el reloj desde 0 si en realidad el partido
        // lleva un rato jugándose.
        if (body.estado === "en_juego") {
          await iniciarCronometroPartido(env, nuevoId, minutosDesdeHoraProgramada(body.fecha_partido));
        }
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "crear_resultado", entidad: "resultado",
          descripcion: `Ha creado el partido "${body.equipo_local} vs ${body.equipo_visitante}" (J${body.jornada})`,
        }));
        // Se devuelve el id recién creado para que el panel pueda, sin
        // necesidad de recargar ni entrar en modo edición, mostrar a
        // continuación el bloque de "Goles y tarjetas" del partido.
        return json({ ok: true, id: nuevoId });
      }

      const resultMatch = path.match(/^\/api\/results\/(\d+)$/);
      // Un único resultado por id (sin autenticar, igual que la lista: se
      // usa en el detalle público y, sobre todo, para que el panel de
      // Minuto a Minuto pueda refrescar el estado de "su" partido sin
      // depender de que aparezca dentro de la lista general (que tiene
      // límite y orden propios, y podía dejar el resultado fuera).
      if (resultMatch && method === "GET") {
        const id = parseInt(resultMatch[1]);
        const resultado = await env.DB.prepare("SELECT * FROM results WHERE id = ?").bind(id).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        resultado.alineaciones = await obtenerAlineaciones(env, "result_id", id);
        // Si hay una (o varias) noticia ya publicada vinculada a este
        // partido (crónica, previa...), se adjunta aquí para poder
        // enlazarla desde el propio modal de resultado en la web
        // pública: así, quien ve el marcador puede entrar directamente
        // a leer la noticia sin tener que buscarla aparte. Solo se
        // devuelven las publicadas (nunca un borrador o una programada
        // que todavía no ha salido) y, de haber varias, la más reciente
        // primero.
        const { results: noticiasVinculadas } = await env.DB.prepare(
          `SELECT slug, titulo, tipo FROM articles
           WHERE resultado_id = ? AND publicado = 1
           ORDER BY fecha_publicacion DESC LIMIT 5`
        ).bind(id).all();
        resultado.noticias_vinculadas = noticiasVinculadas || [];
        return json({ resultado });
      }
      if (resultMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(resultMatch[1]);
        const resultadoParaPermiso = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(id).first();
        if (!resultadoParaPermiso) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", id, resultadoParaPermiso.autor_id))) {
          return json({ error: "No puedes editar este resultado porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        const body = await request.json();
        if (body.estado && !ESTADOS_RESULTADO_VALIDOS.includes(body.estado)) {
          return json({ error: "Estado no válido" }, 400);
        }
        const estadoAnterior = await env.DB.prepare("SELECT estado, inicio_cronometro_at, fecha_partido FROM results WHERE id = ?").bind(id).first();
        const flashscoreUrl = flashscoreUrlValido(body.competicion, body.estado, body.flashscore_url);
        // Si viene "retrasado" y se manda una nueva hora, se conserva la
        // fecha_partido original y se guarda la nueva en un campo aparte
        // (fecha_partido_retrasado); si no es "retrasado", ese campo se
        // limpia siempre (evita que quede "colgado" de un retraso previo
        // si luego el partido se reprograma o se juega con normalidad).
        const fechaRetrasado = body.estado === "retrasado" ? (body.fecha_partido_retrasado || null) : null;
        await env.DB.prepare(
          `UPDATE results SET competicion=?, grupo=?, jornada=?, equipo_local=?, equipo_visitante=?, goles_local=?, goles_visitante=?, penaltis_local=?, penaltis_visitante=?, fecha_partido=?, estado=?, ubicacion=?, flashscore_url=?, escudo_local_url=?, escudo_visitante_url=?, fecha_partido_retrasado=? WHERE id=?`
        ).bind(
          body.competicion, body.grupo || null, body.jornada, body.equipo_local, body.equipo_visitante,
          body.goles_local ?? null, body.goles_visitante ?? null,
          body.penaltis_local ?? null, body.penaltis_visitante ?? null,
          body.fecha_partido || null, body.estado || "programado",
          body.ubicacion || null, flashscoreUrl,
          body.escudo_local_url || null, body.escudo_visitante_url || null, fechaRetrasado, id
        ).run();
        // Mismo camino único que la creación y que el cron: si el estado
        // pasa A "en_juego" (viniendo de cualquier otro estado) y el
        // cronómetro no estaba ya corriendo, se arranca ahora mismo,
        // calculando cuántos minutos han pasado desde la hora programada
        // en vez de arrancar desde 0 — por ejemplo, si el partido era a
        // las 14:00 y se marca "En juego" a mano a las 14:15, el
        // cronómetro arranca ya en el minuto 15.
        if (body.estado === "en_juego" && estadoAnterior?.estado !== "en_juego" && !estadoAnterior?.inicio_cronometro_at) {
          await iniciarCronometroPartido(env, id, minutosDesdeHoraProgramada(body.fecha_partido || estadoAnterior?.fecha_partido));
        }
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_resultado", entidad: "resultado", entidad_id: id,
          descripcion: `Ha editado el partido "${body.equipo_local} vs ${body.equipo_visitante}" (J${body.jornada})`,
        }));
        return json({ ok: true });
      }

      if (resultMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(resultMatch[1]);
        const resultadoBorrado = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(id).first();
        if (!resultadoBorrado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", id, resultadoBorrado.autor_id))) {
          return json({ error: "No puedes eliminar este resultado porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        await env.DB.prepare("DELETE FROM results WHERE id = ?").bind(id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "eliminar_resultado", entidad: "resultado", entidad_id: id,
          descripcion: `Ha eliminado el partido con id ${id}`,
        }));
        return json({ ok: true });
      }

      // MVP (jugador destacado) del partido: endpoint dedicado y ligero
      // en vez de reutilizar el PUT completo de arriba, para que tanto
      // el panel de Minuto a Minuto (que no tiene cargado el formulario
      // entero del partido) como el panel normal puedan marcarlo o
      // quitarlo con una sola llamada, sin arriesgarse a pisar el resto
      // de campos del resultado con un body parcial.
      const resultMvpMatch = path.match(/^\/api\/results\/(\d+)\/mvp$/);
      if (resultMvpMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(resultMvpMatch[1]);
        const resultado = await env.DB.prepare("SELECT autor_id, equipo_local, equipo_visitante FROM results WHERE id = ?").bind(id).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", id, resultado.autor_id))) {
          return json({ error: "No puedes editar este resultado porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        const body = await request.json();
        // Se admite mandar ambos a null/vacío para "quitar" el MVP ya
        // marcado (p.ej. si el redactor se ha equivocado de jugador y
        // prefiere dejarlo sin marcar de momento en vez de corregirlo).
        const mvpJugador = (body.mvp_jugador || "").trim() || null;
        const mvpEquipo = mvpJugador ? body.mvp_equipo : null;
        if (mvpJugador && !["local", "visitante"].includes(mvpEquipo)) {
          return json({ error: "Equipo del MVP no válido (debe ser 'local' o 'visitante')" }, 400);
        }
        await env.DB.prepare("UPDATE results SET mvp_jugador=?, mvp_equipo=? WHERE id=?")
          .bind(mvpJugador, mvpEquipo, id).run();
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "editar_resultado", entidad: "resultado", entidad_id: id,
          descripcion: mvpJugador
            ? `Ha marcado a "${mvpJugador}" como MVP del partido "${resultado.equipo_local} vs ${resultado.equipo_visitante}"`
            : `Ha quitado el MVP del partido "${resultado.equipo_local} vs ${resultado.equipo_visitante}"`,
        }));
        return json({ ok: true });
      }

      // ---------- ALINEACIONES ----------
      // Once inicial dibujado sobre un campo de fútbol, vinculado a una
      // noticia o a un partido (ver worker/migracion_alineaciones.sql).
      // Se gestionan como su propia entidad (no embebidas dentro de
      // articles/results) porque una noticia o un partido pueden llevar
      // dos alineaciones (local y visitante) y porque así el mismo panel
      // de edición sirve para ambos contextos sin duplicar código.
      if (path === "/api/alineaciones" && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const body = await request.json();
        const articleId = body.article_id ? parseInt(body.article_id, 10) : null;
        const resultId = body.result_id ? parseInt(body.result_id, 10) : null;
        if ((!articleId && !resultId) || (articleId && resultId)) {
          return json({ error: "La alineación debe ir ligada a una noticia o a un partido (no a ambos)." }, 400);
        }
        if (!body.equipo || !String(body.equipo).trim()) {
          return json({ error: "Falta el nombre del equipo" }, 400);
        }
        // Permiso: se comprueba sobre la noticia o el partido al que se
        // engancha la alineación, igual que se haría para editarlos.
        if (articleId) {
          const art = await env.DB.prepare("SELECT autor_id, coautor_id, resultado_id FROM articles WHERE id = ?").bind(articleId).first();
          if (!art) return json({ error: "Noticia no encontrada" }, 404);
          if (!(await puedeEditar(env, payload, "articulo", articleId, art.autor_id, art.coautor_id))) {
            return json({ error: "No puedes editar esta noticia." }, 403);
          }
          // Si la noticia ya está vinculada a un partido, la alineación
          // debe colgar del partido (result_id), no de la noticia, para
          // que ambos compartan siempre la misma fila y no se desincronicen.
          if (art.resultado_id) {
            return json({ error: "Esta noticia está vinculada a un partido: la alineación se gestiona desde el partido, no desde la noticia." }, 400);
          }
        } else {
          const res = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(resultId).first();
          if (!res) return json({ error: "Resultado no encontrado" }, 404);
          if (!(await puedeEditar(env, payload, "resultado", resultId, res.autor_id))) {
            return json({ error: "No puedes editar este resultado." }, 403);
          }
        }
        const jugadores = normalizarJugadoresAlineacion(body.jugadores);
        const insertAlineacion = await env.DB.prepare(
          `INSERT INTO alineaciones (article_id, result_id, equipo, escudo_url, formacion, jugadores, autor_id, autor_nombre, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          articleId, resultId, String(body.equipo).trim(), body.escudo_url || null,
          body.formacion || "4-3-3", JSON.stringify(jugadores), payload.uid, payload.nombre
        ).run();
        return json({ ok: true, id: insertAlineacion.meta.last_row_id });
      }

      const alineacionMatch = path.match(/^\/api\/alineaciones\/(\d+)$/);
      if (alineacionMatch && (method === "PUT" || method === "DELETE")) {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const id = parseInt(alineacionMatch[1]);
        const alineacion = await env.DB.prepare("SELECT * FROM alineaciones WHERE id = ?").bind(id).first();
        if (!alineacion) return json({ error: "Alineación no encontrada" }, 404);

        // Mismo criterio de permisos que la noticia/el partido al que
        // pertenece (no tiene sentido poder editar la alineación de un
        // partido que no es tuyo, aunque la hayas creado tú misma).
        let autorizado = false;
        if (alineacion.article_id) {
          const art = await env.DB.prepare("SELECT autor_id, coautor_id FROM articles WHERE id = ?").bind(alineacion.article_id).first();
          autorizado = art ? await puedeEditar(env, payload, "articulo", alineacion.article_id, art.autor_id, art.coautor_id) : payload.rol === "admin";
        } else if (alineacion.result_id) {
          const res = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(alineacion.result_id).first();
          autorizado = res ? await puedeEditar(env, payload, "resultado", alineacion.result_id, res.autor_id) : payload.rol === "admin";
        }
        if (!autorizado) return json({ error: "No puedes editar esta alineación." }, 403);

        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM alineaciones WHERE id = ?").bind(id).run();
          return json({ ok: true });
        }

        const body = await request.json();
        if (!body.equipo || !String(body.equipo).trim()) {
          return json({ error: "Falta el nombre del equipo" }, 400);
        }
        const jugadores = normalizarJugadoresAlineacion(body.jugadores);
        await env.DB.prepare(
          `UPDATE alineaciones SET equipo=?, escudo_url=?, formacion=?, jugadores=?, updated_at=datetime('now') WHERE id=?`
        ).bind(
          String(body.equipo).trim(), body.escudo_url || null, body.formacion || "4-3-3",
          JSON.stringify(jugadores), id
        ).run();
        return json({ ok: true });
      }

      // ---------- PANEL MINUTO A MINUTO: cronómetro ----------
      // Solo el día del partido (con un margen de un par de horas antes y
      // después) puede accederse al panel. Se comprueba también en el
      // backend, no solo escondiendo el botón en el frontend, para que no
      // se pueda editar el cronómetro de un partido de otro día llamando
      // directamente a la API.
      const MARGEN_ACCESO_HORAS = 3;
      function dentroDelDiaDelPartido(fechaPartido) {
        if (!fechaPartido) return false;
        const inicio = new Date(fechaPartido.length === 10 ? `${fechaPartido}T00:00:00Z` : `${fechaPartido}:00Z`);
        if (isNaN(inicio.getTime())) return false;
        const ahora = Date.now();
        const desde = inicio.getTime() - MARGEN_ACCESO_HORAS * 3600 * 1000;
        // Día completo del partido (hasta las 23:59 de esa fecha) más el
        // margen de después, para partidos que se alargan.
        const finDelDia = new Date(inicio);
        finDelDia.setUTCHours(23, 59, 59, 999);
        const hasta = finDelDia.getTime() + MARGEN_ACCESO_HORAS * 3600 * 1000;
        return ahora >= desde && ahora <= hasta;
      }

      const cronometroMatch = path.match(/^\/api\/results\/(\d+)\/cronometro$/);
      if (cronometroMatch && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const resultadoId = parseInt(cronometroMatch[1]);
        const resultado = await env.DB.prepare("SELECT autor_id, fecha_partido FROM results WHERE id = ?").bind(resultadoId).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", resultadoId, resultado.autor_id))) {
          return json({ error: "No puedes gestionar el minuto a minuto de este partido porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        if (!dentroDelDiaDelPartido(resultado.fecha_partido)) {
          return json({ error: "Solo se puede acceder al panel de Minuto a Minuto el día del partido." }, 403);
        }
        const body = await request.json();
        // acciones: "iniciar" (arranca/reanuda el cronómetro desde 0 o
        // desde el minuto pausado — misma función que usan el cron y el
        // "En juego" manual, así los tres caminos quedan siempre
        // sincronizados), "pausar" (congela en un minuto dado, p.ej. al
        // pitar el descanso, la pausa de hidratación o el final), y
        // "ajustar_minuto" (editar a mano el minuto que marca el reloj
        // en este momento, sin tocar el instante real de inicio).
        if (body.accion === "iniciar") {
          // "minuto_inicial" permite retomar el cronómetro justo donde se
          // dejó (p. ej. al empezar la 2ª parte tras el descanso) en vez
          // de volver a contar desde 0.
          const minutoInicial = Number.isInteger(body.minuto_inicial) && body.minuto_inicial > 0 ? body.minuto_inicial : 0;
          await iniciarCronometroPartido(env, resultadoId, minutoInicial);
        } else if (body.accion === "pausar") {
          const minuto = Number.isInteger(body.minuto) ? body.minuto : 0;
          await env.DB.prepare(
            "UPDATE results SET cronometro_pausado_en = ? WHERE id = ?"
          ).bind(minuto, resultadoId).run();
        } else if (body.accion === "ajustar_minuto") {
          // El redactor corrige a mano el minuto que debería marcar el
          // reloj AHORA (p.ej. si el cronómetro se desvió). Si el
          // cronómetro está pausado (descanso/hidratación), se corrige
          // directamente cronometro_pausado_en; si está corriendo, se
          // guarda como desplazamiento sobre inicio_cronometro_at para
          // no perder la referencia real de cuándo empezó el partido.
          if (!Number.isInteger(body.minuto) || body.minuto < 0 || body.minuto > 130) {
            return json({ error: "Minuto no válido" }, 400);
          }
          const actual = await env.DB.prepare("SELECT inicio_cronometro_at, cronometro_pausado_en FROM results WHERE id = ?").bind(resultadoId).first();
          if (actual?.cronometro_pausado_en !== null && actual?.cronometro_pausado_en !== undefined) {
            await env.DB.prepare("UPDATE results SET cronometro_pausado_en = ? WHERE id = ?").bind(body.minuto, resultadoId).run();
          } else if (actual?.inicio_cronometro_at) {
            const inicioMs = new Date(actual.inicio_cronometro_at.replace(" ", "T") + "Z").getTime();
            // "referencia_at" es el instante (mandado por el panel) en
            // que el minuto introducido era realmente ese: el momento
            // en que se leyó "minutoEnVivo()" para precargar el
            // formulario, no el momento en que llega esta petición.
            // Sin esto, el servidor usaba Date.now() -ya más tarde,
            // después de que el redactor pensara/escribiera/confirmara
            // el prompt- y restaba de más esos segundos, dando lugar al
            // desfase de "-1"/"-2" minutos que se veía al corregir.
            // Se valida que sea una fecha real y no esté muy lejos del
            // "ahora" del servidor (60s de margen por si el reloj del
            // navegador está algo desviado); si no, se cae al
            // comportamiento anterior (Date.now()) por seguridad.
            let instanteReferenciaMs = Date.now();
            if (typeof body.referencia_at === "string") {
              const parsed = new Date(body.referencia_at).getTime();
              if (!isNaN(parsed) && Math.abs(parsed - Date.now()) <= 60000) {
                instanteReferenciaMs = parsed;
              }
            }
            const minutosTranscurridos = isNaN(inicioMs) ? 0 : Math.floor((instanteReferenciaMs - inicioMs) / 60000);
            const ajuste = body.minuto - minutosTranscurridos;
            await env.DB.prepare("UPDATE results SET ajuste_cronometro_minutos = ? WHERE id = ?").bind(ajuste, resultadoId).run();
          } else {
            return json({ error: "El cronómetro no se ha iniciado todavía." }, 400);
          }
        } else {
          return json({ error: "Acción no válida (usa 'iniciar', 'pausar' o 'ajustar_minuto')" }, 400);
        }
        // Nota: antes aquí se limpiaba un flag "aviso_desatendido_enviado"
        // con cada acción del cronómetro para permitir un nuevo aviso más
        // adelante. Ya no hace falta: ahora el límite es "máximo un aviso
        // por mitad" (aviso_desatendido_mitad, ver revisarPartidosDesatendidos),
        // así que no hay que resetear nada aquí -- resetear en cada acción
        // era precisamente lo que podía generar varios avisos seguidos
        // dentro de una misma mitad si el partido volvía a quedarse
        // desatendido poco después de un toque suelto.
        // Se devuelve el resultado actualizado para que el panel no tenga
        // que recalcular a mano el instante de inicio del cronómetro.
        const actualizado = await env.DB.prepare("SELECT * FROM results WHERE id = ?").bind(resultadoId).first();
        return json({ ok: true, resultado: actualizado });
      }

      // ---------- MATCH EVENTS (goles, tarjetas) ----------
      // Lista pública de eventos de un partido (se pinta en el modal de
      // detalle de resultados.html). No requiere autenticación, igual que
      // GET /api/results.
      // Tipos de evento admitidos por el panel de Minuto a Minuto. Los
      // primeros cuatro ya existían (goles y tarjetas, con equipo
      // obligatorio); el resto son nuevos y varios de ellos no llevan
      // equipo asociado (se guarda "ninguno").
      const TIPOS_EVENTO_VALIDOS = [
        "gol", "gol_var", "gol_pp", "amarilla", "doble_amarilla", "roja",
        "cambio", "penalti_fallado", "var",
        "inicio_partido", "descanso", "fin_descanso",
        "pausa_hidratacion", "fin_pausa_hidratacion",
        "partido_retrasado", "partido_anulado",
        "penalti_marcado", "penalti_fallado_tanda",
        "fin_partido", "otro",
      ];
      const TIPOS_EVENTO_SIN_EQUIPO = [
        "inicio_partido", "descanso", "fin_descanso",
        "pausa_hidratacion", "fin_pausa_hidratacion",
        "partido_retrasado", "partido_anulado",
        "fin_partido", "otro",
      ];

      // Recalcula goles_local/goles_visitante de un resultado a partir de
      // sus eventos de tipo "gol", y lo marca como "en_juego" si todavía
      // estaba "programado". Se llama después de crear/editar/borrar un
      // evento, para que el marcador del panel de Minuto a Minuto (y el
      // de toda la web) esté siempre sincronizado con los goles
      // registrados, sin que el redactor tenga que ir aparte al
      // formulario de "Editar resultado" a teclear el marcador a mano.
      //
      // Un "gol_var" (gol anulado por el VAR) solo resta uno al
      // marcador del equipo correspondiente si su columna bajar_gol
      // está marcada: eso indica que el gol ya se había pitado y
      // contado antes de que el VAR lo revisara. Si bajar_gol es 0 (el
      // redactor no lo marcó), se registra el evento en el timeline sin
      // tocar el marcador, porque ese gol nunca llegó a sumar. Esta
      // distinción evita restar de más si el redactor solo quiere dejar
      // constancia de una revisión que anula el gol antes de que
      // cambiara el marcador.
      // Un "gol_pp" (gol en propia puerta) se guarda con "equipo" = el
      // equipo del jugador que se lo mete en su propia portería, pero el
      // gol beneficia al equipo CONTRARIO: por eso, a la hora de sumar,
      // se le da la vuelta al equipo (rival() más abajo).
      function rival(equipo) {
        return equipo === "local" ? "visitante" : "local";
      }

      async function recalcularMarcadorDesdeEventos(env, resultadoId) {
        const { results: eventos } = await env.DB.prepare(
          "SELECT tipo, equipo, bajar_gol FROM match_events WHERE resultado_id = ? AND tipo IN ('gol', 'gol_var', 'gol_pp')"
        ).bind(resultadoId).all();
        const contar = (equipo) => eventos.filter((e) => e.tipo === "gol" && e.equipo === equipo).length
          + eventos.filter((e) => e.tipo === "gol_pp" && rival(e.equipo) === equipo).length
          - eventos.filter((e) => e.tipo === "gol_var" && e.equipo === equipo && e.bajar_gol).length;
        const golesLocal = Math.max(0, contar("local"));
        const golesVisitante = Math.max(0, contar("visitante"));
        await env.DB.prepare(
          `UPDATE results SET goles_local = ?, goles_visitante = ?,
             estado = CASE WHEN estado = 'programado' THEN 'en_juego' ELSE estado END
           WHERE id = ?`
        ).bind(golesLocal, golesVisitante, resultadoId).run();
      }

      // Recalcula penaltis_local/penaltis_visitante a partir de los
      // eventos "penalti_marcado" (solo cuentan los marcados; los
      // fallados/parados quedan en el timeline pero no suman). Si no hay
      // ningún evento de tanda todavía, deja ambas columnas en NULL (no
      // hubo tanda de penaltis en este partido), en vez de 0-0.
      async function recalcularPenaltisDesdeEventos(env, resultadoId) {
        const { results: eventos } = await env.DB.prepare(
          "SELECT tipo, equipo FROM match_events WHERE resultado_id = ? AND tipo IN ('penalti_marcado', 'penalti_fallado_tanda')"
        ).bind(resultadoId).all();
        if (!eventos.length) {
          await env.DB.prepare("UPDATE results SET penaltis_local = NULL, penaltis_visitante = NULL WHERE id = ?").bind(resultadoId).run();
          return;
        }
        const contar = (equipo) => eventos.filter((e) => e.tipo === "penalti_marcado" && e.equipo === equipo).length;
        await env.DB.prepare("UPDATE results SET penaltis_local = ?, penaltis_visitante = ? WHERE id = ?")
          .bind(contar("local"), contar("visitante"), resultadoId).run();
      }

      const eventosMatch = path.match(/^\/api\/results\/(\d+)\/eventos$/);
      if (eventosMatch && method === "GET") {
        const resultadoId = parseInt(eventosMatch[1]);
        const { results: eventos } = await env.DB.prepare(
          `SELECT id, tipo, equipo, jugador, jugador_sale, jugador_asistencia, minuto, minuto_extra, orden, bajar_gol
           FROM match_events WHERE resultado_id = ?
           ORDER BY minuto ASC, minuto_extra ASC, orden ASC, id ASC`
        ).bind(resultadoId).all();
        return json({ eventos });
      }

      // Crear un evento. Requiere el mismo permiso de edición que el
      // resultado al que pertenece (autoría, admin, o permiso temporal
      // aprobado por solicitud de edición).
      if (eventosMatch && method === "POST") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const resultadoId = parseInt(eventosMatch[1]);
        const resultado = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(resultadoId).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", resultadoId, resultado.autor_id))) {
          return json({ error: "No puedes editar los eventos de este partido porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        const body = await request.json();
        if (!TIPOS_EVENTO_VALIDOS.includes(body.tipo)) {
          return json({ error: "Tipo de evento no válido" }, 400);
        }
        const equipoRequerido = !TIPOS_EVENTO_SIN_EQUIPO.includes(body.tipo);
        if (equipoRequerido && !["local", "visitante"].includes(body.equipo)) {
          return json({ error: "Equipo no válido (debe ser 'local' o 'visitante')" }, 400);
        }
        if (body.minuto === undefined || body.minuto === null || body.minuto === "") {
          return json({ error: "Falta el minuto" }, 400);
        }
        // "inicio_partido" es un hito único: solo puede haber uno por
        // partido. Sin esta comprobación, si el cron ya había arrancado
        // el partido solo (y ya insertado su "Comienza el partido") y el
        // redactor entraba al panel de Minuto a Minuto y pulsaba
        // "Iniciar partido" igualmente (p.ej. porque cargó el panel un
        // instante antes de que el cron actuase, viendo todavía el botón
        // de inicio), se insertaba un segundo evento idéntico y aparecía
        // duplicado en el timeline. Se devuelve el evento ya existente
        // en vez de crear otro, para no romper el flujo del botón.
        if (body.tipo === "inicio_partido") {
          const existente = await env.DB.prepare(
            "SELECT id FROM match_events WHERE resultado_id = ? AND tipo = 'inicio_partido' LIMIT 1"
          ).bind(resultadoId).first();
          if (existente) return json({ ok: true, id: existente.id, ya_existia: true });
        }
        const { meta } = await env.DB.prepare(
          `INSERT INTO match_events (resultado_id, tipo, equipo, jugador, jugador_sale, jugador_asistencia, minuto, minuto_extra, orden, bajar_gol)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          resultadoId, body.tipo, equipoRequerido ? body.equipo : "ninguno",
          body.jugador || null, body.jugador_sale || null,
          body.tipo === "gol" ? (body.jugador_asistencia || null) : null,
          parseInt(body.minuto, 10), body.minuto_extra ? parseInt(body.minuto_extra, 10) : null,
          body.orden ? parseInt(body.orden, 10) : 0,
          body.tipo === "gol_var" && body.bajar_gol ? 1 : 0
        ).run();
        // Nota: antes aquí se limpiaba un flag "aviso_desatendido_enviado"
        // con cada evento nuevo para permitir otro aviso más adelante.
        // Ya no hace falta: el límite ahora es "máximo un aviso por
        // mitad" (aviso_desatendido_mitad, ver revisarPartidosDesatendidos)
        // y se mantiene tal cual aunque lleguen eventos sueltos dentro de
        // la misma mitad, que es justo lo que evita "la petada" de varios
        // correos seguidos por un solo despiste.
        // Un gol anulado por VAR ("gol_var") no suma como gol normal,
        // pero si el redactor ha marcado "bajar_gol" (porque el gol ya
        // se había pitado y contado antes de la revisión) resta uno del
        // marcador (ver recalcularMarcadorDesdeEventos), así que también
        // hay que recalcular en este caso. Igual que un gol normal, de
        // paso confirma que el partido ya está en juego si seguía
        // "programado".
        if (body.tipo === "gol" || body.tipo === "gol_var" || body.tipo === "gol_pp") await recalcularMarcadorDesdeEventos(env, resultadoId);
        if (body.tipo === "penalti_marcado" || body.tipo === "penalti_fallado_tanda") await recalcularPenaltisDesdeEventos(env, resultadoId);
        if (body.tipo === "fin_partido") {
          await env.DB.prepare("UPDATE results SET estado = 'finalizado' WHERE id = ?").bind(resultadoId).run();
        }
        if (body.tipo === "partido_retrasado") {
          await env.DB.prepare("UPDATE results SET estado = 'retrasado' WHERE id = ?").bind(resultadoId).run();
        }
        if (body.tipo === "partido_anulado") {
          await env.DB.prepare("UPDATE results SET estado = 'anulado', cronometro_pausado_en = COALESCE(cronometro_pausado_en, ?) WHERE id = ?")
            .bind(parseInt(body.minuto, 10) || 0, resultadoId).run();
        }
        ctx.waitUntil(registrarActividad(env, request, payload, {
          accion: "crear_evento_partido", entidad: "resultado", entidad_id: resultadoId,
          descripcion: `Ha añadido un evento (${body.tipo}) al partido con id ${resultadoId}`,
        }));
        return json({ ok: true, id: meta.last_row_id });
      }

      const eventoMatch = path.match(/^\/api\/results\/(\d+)\/eventos\/(\d+)$/);
      if (eventoMatch && method === "PUT") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const resultadoId = parseInt(eventoMatch[1]);
        const eventoId = parseInt(eventoMatch[2]);
        const resultado = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(resultadoId).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", resultadoId, resultado.autor_id))) {
          return json({ error: "No puedes editar los eventos de este partido porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        const body = await request.json();
        if (!TIPOS_EVENTO_VALIDOS.includes(body.tipo)) {
          return json({ error: "Tipo de evento no válido" }, 400);
        }
        const equipoRequerido = !TIPOS_EVENTO_SIN_EQUIPO.includes(body.tipo);
        if (equipoRequerido && !["local", "visitante"].includes(body.equipo)) {
          return json({ error: "Equipo no válido (debe ser 'local' o 'visitante')" }, 400);
        }
        await env.DB.prepare(
          `UPDATE match_events SET tipo=?, equipo=?, jugador=?, jugador_sale=?, jugador_asistencia=?, minuto=?, minuto_extra=?, orden=?, bajar_gol=?
           WHERE id=? AND resultado_id=?`
        ).bind(
          body.tipo, equipoRequerido ? body.equipo : "ninguno", body.jugador || null, body.jugador_sale || null,
          body.tipo === "gol" ? (body.jugador_asistencia || null) : null,
          parseInt(body.minuto, 10), body.minuto_extra ? parseInt(body.minuto_extra, 10) : null,
          body.orden ? parseInt(body.orden, 10) : 0,
          body.tipo === "gol_var" && body.bajar_gol ? 1 : 0,
          eventoId, resultadoId
        ).run();
        await recalcularMarcadorDesdeEventos(env, resultadoId);
        await recalcularPenaltisDesdeEventos(env, resultadoId);
        return json({ ok: true });
      }

      if (eventoMatch && method === "DELETE") {
        const payload = await requireAuth(request, env);
        if (!payload) return json({ error: "No autorizado" }, 401);
        const resultadoId = parseInt(eventoMatch[1]);
        const eventoId = parseInt(eventoMatch[2]);
        const resultado = await env.DB.prepare("SELECT autor_id FROM results WHERE id = ?").bind(resultadoId).first();
        if (!resultado) return json({ error: "Resultado no encontrado" }, 404);
        if (!(await puedeEditar(env, payload, "resultado", resultadoId, resultado.autor_id))) {
          return json({ error: "No puedes editar los eventos de este partido porque no es tuyo. Solicita permiso al autor o a un administrador." }, 403);
        }
        await env.DB.prepare("DELETE FROM match_events WHERE id=? AND resultado_id=?").bind(eventoId, resultadoId).run();
        await recalcularMarcadorDesdeEventos(env, resultadoId);
        await recalcularPenaltisDesdeEventos(env, resultadoId);
        return json({ ok: true });
      }

      return json({ error: "Ruta no encontrada" }, 404);
    } catch (err) {
      return json({ error: "Error del servidor", detail: err.message }, 500);
    }
  },

  // Disparador programado (cron trigger, ver "crons" en wrangler.toml):
  // revisa cada minuto si hay alguna noticia programada cuya hora ya ha
  // llegado y, si es así, la publica sola sin que nadie tenga que entrar
  // al panel a esa hora.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(publicarArticulosProgramados(env));
    ctx.waitUntil(iniciarPartidosProgramadosCuyaHoraHaLlegado(env));
    ctx.waitUntil(revisarPartidosDesatendidos(env, ctx));
  },
};
