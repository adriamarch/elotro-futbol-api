// Filtro automático de comentarios: enlaces y lenguaje ofensivo.
//
// Se ejecuta ANTES de guardar el comentario (POST /api/articles/:id/comments),
// también para lectores con sesión (Turnstile solo frena bots; esto frena a
// personas). Lo que se bloquea no llega a la bandeja de la redacción.
//
// Este archivo debe ser IDÉNTICO en worker/src y worker-secondary/src
// (lo comprueba .github/workflows/paridad-workers.yml, igual que busqueda.js).
//
// Decisiones de diseño:
//  - Solo se bloquean insultos y expresiones discriminatorias o amenazas.
//    Las palabrotas "de campo" (joder, hostia...) NO se bloquean: en un
//    medio de fútbol bloquearlas genera más frustración que beneficio.
//  - La coincidencia es por PALABRA completa, no por subcadena, para evitar
//    falsos positivos tipo "computadora" -> "puta".
//  - El mensaje de error nunca repite la palabra detectada.
//  - La lista es un punto de partida: ajústala con lo que vaya llegando a
//    la bandeja de moderación.

// ---------- Insultos (ya normalizados: minúsculas, sin tildes) ----------
// Una sola palabra. Se compara también con las letras repetidas colapsadas.
// Criterio: insultos dirigidos a personas, expresiones discriminatorias y
// amenazas. NO entran "puto" (en "puto amo" es un elogio), "mierda", "joder",
// "coño" ni críticas duras tipo "equipo de mierda": son habituales en
// comentarios de fútbol y bloquearlas solo genera frustración.
const INSULTOS = [
  // castellano
  "puta", "putas", "hijoputa", "hijoputas", "hijueputa", "hdp", "hdlgp",
  "gilipollas", "gilipuertas", "capullo", "capulla", "cabron", "cabrona", "cabrones",
  "imbecil", "imbeciles", "idiota", "idiotas", "subnormal", "subnormales",
  "retrasado", "retrasada", "mongolo", "mongola", "zorra", "zorras", "furcia",
  "malnacido", "malparido", "pendejo", "pendeja", "pelotudo", "comemierda",
  // discriminación
  "maricon", "maricones", "marica", "bollera", "sudaca", "sudacas", "negrata", "negratas",
  // catalán
  "malparit", "malparits", "imbecils", "gilipolles",
  // amenazas
  "muerete", "suicidate",
];

// Expresiones de varias palabras (ya normalizadas, con espacios simples).
const FRASES_OFENSIVAS = [
  "hijo de puta", "hijos de puta", "hija de puta", "hijo de la gran puta", "fill de puta", "fills de puta",
  "tu puta madre", "vete a la mierda", "vete a tomar por culo",
  "ojala te mueras", "ojala os mueran", "te voy a matar", "os voy a matar", "te vamos a matar",
  "moro de mierda", "gitano de mierda", "negro de mierda", "sudaca de mierda",
  "puto negro", "puto moro", "puta gitana", "puto gitano",
];

// ---------- Normalización ----------
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "€": "e" };

function quitarInvisibles(s) {
  // Espacios de ancho cero, marcas direccionales, guion blando...
  return s.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, "");
}

function normalizar(s) {
  return quitarInvisibles(String(s || ""))
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quita tildes (y la ñ pasa a n)
}

function colapsar(palabra) {
  return palabra.replace(/(.)\1+/g, "$1");
}

const INSULTOS_SET = new Set(INSULTOS);
const INSULTOS_COLAPSADOS = new Set(INSULTOS.map(colapsar));

function esInsulto(palabra) {
  if (palabra.length < 3) return false;
  return INSULTOS_SET.has(palabra) || INSULTOS_COLAPSADOS.has(colapsar(palabra));
}

// "p*ta", "m**rda": el asterisco comodín casa con una letra de un insulto de la misma longitud.
function coincideConAsteriscos(token) {
  if (!token.includes("*") || token.length < 4 || /^\*+$/.test(token)) return false;
  const re = new RegExp("^" + token.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z]") + "$");
  return INSULTOS.some((p) => p.length === token.length && re.test(p));
}

// Prepara dos variantes: con leet (m13rd4) y sin él (para no romper números legítimos).
function variantes(texto) {
  const base = normalizar(texto);
  const conLeet = base.replace(/[013457@$€]/g, (c) => LEET[c]);
  return [base, conLeet];
}

// Une letras sueltas separadas por puntos, guiones o espacios: "p.u.t.a", "p u t a".
function unirLetrasSueltas(texto) {
  return texto.replace(/(?:^|[^a-z0-9])((?:[a-z][\s.\-_*]+){2,}[a-z])(?=$|[^a-z0-9])/g, (m, run) => " " + run.replace(/[\s.\-_*]+/g, "") + " ");
}

function contieneInsulto(texto) {
  for (const v of variantes(texto)) {
    const limpio = unirLetrasSueltas(v);
    // Frases: se comparan con todo lo que no sea letra convertido en un espacio.
    const plano = " " + limpio.replace(/[^a-z*]+/g, " ").replace(/\s+/g, " ").trim() + " ";
    for (const f of FRASES_OFENSIVAS) if (plano.includes(" " + f + " ")) return true;
    // Palabras sueltas.
    for (const token of limpio.split(/[^a-z*]+/)) {
      if (!token) continue;
      if (esInsulto(token) || coincideConAsteriscos(token)) return true;
    }
  }
  return false;
}

// ---------- Enlaces ----------
// TLD que se detectan aunque no lleven http:// ni www. Se omiten a propósito
// los que chocan con palabras normales al teclear sin espacio tras el punto
// ("gol.es", "dime.me", "partido.tv", "ya.co").
const TLDS = "com|net|org|info|biz|xyz|top|click|link|site|online|shop|store|bet|casino|ru|cn|tk|ly|gg|cc|io|app|cat|eus|gal|club|live|vip|win|pro|fun|buzz|icu|cfd|sbs";

const RE_ENLACE = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\s*\./i,
  new RegExp("\\b[a-z0-9][a-z0-9-]{1,62}\\s?(?:\\.|\\[\\.\\]|\\(\\.\\)|\\bpunto\\b|\\bdot\\b)\\s?(?:" + TLDS + ")\\b", "i"),
  /\b(?:t\.me|wa\.me|bit\.ly|tinyurl\.com|goo\.gl|linktr\.ee|discord\.gg)\b/i,
  /\b(?:whatsapp|telegram)\b[^\n]{0,40}\+?\d[\d\s-]{7,}/i,
];
const RE_EMAIL_EN_TEXTO = /[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}/i;

function contieneEnlace(texto) {
  const t = quitarInvisibles(String(texto || ""));
  return RE_ENLACE.some((re) => re.test(t)) || RE_EMAIL_EN_TEXTO.test(t);
}

// ---------- API ----------
export const MENSAJE_ENLACE = "Los comentarios no pueden incluir enlaces, direcciones web ni correos electrónicos.";
export const MENSAJE_INSULTO = "Tu comentario contiene lenguaje ofensivo. Reescríbelo sin insultos para poder enviarlo.";

// Devuelve { ok: true } o { ok: false, motivo: "enlace" | "insulto", mensaje }.
// Se revisan el texto y el nombre (el nombre también se publica).
export function analizarComentario({ texto, nombre } = {}) {
  for (const campo of [texto, nombre]) {
    if (campo && contieneEnlace(campo)) return { ok: false, motivo: "enlace", mensaje: MENSAJE_ENLACE };
  }
  for (const campo of [texto, nombre]) {
    if (campo && contieneInsulto(campo)) return { ok: false, motivo: "insulto", mensaje: MENSAJE_INSULTO };
  }
  return { ok: true };
}

export { contieneEnlace, contieneInsulto };
