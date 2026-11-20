// Etiquetas (tags) reales de las noticias: «Ascenso 2026», «Fichajes»...
//
// Este archivo es IDÉNTICO en worker/src y worker-secondary/src (lo comprueba
// .github/workflows/paridad-workers.yml con diff, igual que busqueda.js). No
// importa nada del resto del worker para poder probarse solo
// (worker/tests/etiquetas.test.mjs).
//
// Cómo se guardan, en dos columnas de "articles" (ver
// worker/migracion_etiquetas.sql y worker-secondary/db/migrations/079):
//   etiquetas        JSON con los nombres tal como los escribió el redactor:
//                    '["Ascenso 2026","Fichajes"]'. Es lo que se muestra.
//   etiquetas_slugs  los mismos nombres normalizados y entre comas:
//                    ',ascenso-2026,fichajes,'. Es lo que se consulta
//                    (LIKE '%,fichajes,%'): las comas de los extremos evitan
//                    que «liga» case con «liga-2» o «copa-liga».
// Si dos redactores escriben «Fichajes» y «fichajes», comparten etiqueta
// (mismo slug) y por tanto la misma página, /etiqueta/fichajes.

export const MAX_ETIQUETAS = 8;
export const MAX_LONGITUD_ETIQUETA = 40;
// Una página de etiqueta con una sola noticia es contenido casi duplicado de
// esa noticia: no se anuncia en el sitemap ni se deja indexar por debajo de
// este número de noticias.
export const MIN_NOTICIAS_ETIQUETA_INDEXABLE = 2;

// "Ascenso 2026" -> "ascenso-2026"; "Fichajes de invierno" -> "fichajes-de-invierno".
// Sin acentos ni eñes ("España" -> "espana"). Devuelve "" si el texto no tiene
// ninguna letra ni número (p. ej. "###"), que se trata como no válido.
export function slugEtiqueta(texto) {
  return String(texto ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

// Limpia un nombre tal como lo escribió el redactor: sin "#" inicial, espacios
// colapsados y sin caracteres que no tienen sitio en un nombre (< > " y de control).
export function limpiarNombreEtiqueta(texto) {
  return String(texto ?? "")
    .replace(/[<>"\u0000-\u001f\u007f]/g, "")
    .replace(/^[#\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Lee lo guardado en la columna "etiquetas" (JSON en texto) como array de
// nombres. [] si no hay ninguna o el valor no se entiende.
export function parsearEtiquetas(valor) {
  if (Array.isArray(valor)) return valor.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (!valor || typeof valor !== "string") return [];
  try {
    const parsed = JSON.parse(valor);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  } catch { /* texto que no es JSON: se ignora */ }
  return [];
}

// Valida lo que manda el panel en "etiquetas": un array de nombres o un texto
// separado por comas / saltos de línea. Sin repetidos (por slug), máximo
// MAX_ETIQUETAS. Devuelve { error } o { etiquetas: [nombre...], slugs: [slug...] }
// (ambos [] si no hay ninguna). undefined/null/"" equivalen a "sin etiquetas".
export function validarEtiquetas(valorRecibido) {
  let lista;
  if (Array.isArray(valorRecibido)) lista = valorRecibido;
  else if (typeof valorRecibido === "string") lista = valorRecibido.split(/[,\n;]+/);
  else if (valorRecibido === undefined || valorRecibido === null) return { etiquetas: [], slugs: [] };
  else return { error: "Las etiquetas no tienen un formato válido." };

  const etiquetas = [];
  const slugs = [];
  for (const crudo of lista) {
    if (typeof crudo !== "string") return { error: "Las etiquetas no tienen un formato válido." };
    const nombre = limpiarNombreEtiqueta(crudo);
    if (!nombre) continue;
    if (nombre.length > MAX_LONGITUD_ETIQUETA) {
      return { error: `Cada etiqueta admite como máximo ${MAX_LONGITUD_ETIQUETA} caracteres («${nombre.slice(0, 20)}…»).` };
    }
    const slug = slugEtiqueta(nombre);
    if (!slug) return { error: `La etiqueta «${nombre}» debe llevar al menos una letra o un número.` };
    if (slugs.includes(slug)) continue;
    etiquetas.push(nombre);
    slugs.push(slug);
  }
  if (etiquetas.length > MAX_ETIQUETAS) {
    return { error: `Puedes poner como máximo ${MAX_ETIQUETAS} etiquetas.` };
  }
  return { etiquetas, slugs };
}

// Valores a escribir en las dos columnas (NULL cuando no hay ninguna, igual que
// categorias_adicionales).
export function columnasEtiquetas({ etiquetas = [], slugs = [] } = {}) {
  return {
    etiquetas: etiquetas.length ? JSON.stringify(etiquetas) : null,
    etiquetas_slugs: slugs.length ? `,${slugs.join(",")},` : null,
  };
}

// Guarda las etiquetas de una noticia con una sentencia propia (en vez de
// añadir dos "?" más a los INSERT/UPDATE de POST/PUT /api/articles, que tienen
// más de 40 parámetros posicionales). Un fallo aquí (p. ej. migración
// pendiente de aplicar) NO debe impedir guardar o publicar la noticia: se
// registra y se devuelve false.
export async function guardarEtiquetasArticulo(env, id, validadas) {
  try {
    const col = columnasEtiquetas(validadas);
    await env.DB.prepare("UPDATE articles SET etiquetas = ?, etiquetas_slugs = ? WHERE id = ?")
      .bind(col.etiquetas, col.etiquetas_slugs, id).run();
    return true;
  } catch (err) {
    console.error("No se pudieron guardar las etiquetas de la noticia", id, err);
    return false;
  }
}

// "articles" devuelve la fila con "etiquetas_slugs" (columna de consulta, sin
// valor para quien lee la API): se quita de la respuesta.
export function quitarColumnaSlugs(articulo) {
  if (!articulo || typeof articulo !== "object" || !("etiquetas_slugs" in articulo)) return articulo;
  const { etiquetas_slugs, ...resto } = articulo;
  return resto;
}

// A partir de filas { etiquetas, fecha_publicacion } de noticias publicadas,
// cuenta cuántas noticias tiene cada etiqueta: [{ nombre, slug, total, ultima }],
// de más a menos noticias (empate: alfabético). Cada noticia cuenta una vez por
// etiqueta. Si una misma etiqueta se escribió de varias formas («Fichajes» /
// «fichajes»), se muestra la más usada.
export function agregarEtiquetas(filas) {
  const porSlug = new Map();
  for (const fila of filas || []) {
    const vistos = new Set();
    for (const nombre of parsearEtiquetas(fila?.etiquetas)) {
      const slug = slugEtiqueta(nombre);
      if (!slug || vistos.has(slug)) continue;
      vistos.add(slug);
      let e = porSlug.get(slug);
      if (!e) { e = { slug, total: 0, ultima: null, variantes: new Map() }; porSlug.set(slug, e); }
      e.total += 1;
      e.variantes.set(nombre, (e.variantes.get(nombre) || 0) + 1);
      const f = fila?.fecha_publicacion || null;
      if (f && (!e.ultima || String(f) > String(e.ultima))) e.ultima = f;
    }
  }
  return [...porSlug.values()].map((e) => {
    let nombre = "";
    let mejor = 0;
    for (const [v, n] of e.variantes) if (n > mejor) { nombre = v; mejor = n; }
    return { nombre, slug: e.slug, total: e.total, ultima: e.ultima };
  }).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

// Nombres de club de la columna "club": un nombre en texto plano (caso normal)
// o un array JSON de 2 clubes (previa/crónica de un partido). Mismo criterio
// que parsearClubArticulo.
export function clubesDeColumna(valor) {
  if (!valor || typeof valor !== "string") return [];
  try {
    const parsed = JSON.parse(valor);
    if (Array.isArray(parsed)) return parsed.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim());
  } catch { /* club único en texto plano */ }
  return valor.trim() ? [valor.trim()] : [];
}
