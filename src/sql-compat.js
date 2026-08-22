export function translateSql(sql, params = []) {
  let n = 0;
  let out = sql
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/datetime\('now',\s*\?\)/gi, "(CURRENT_TIMESTAMP + ?::interval)")
    .replace(/datetime\('now',\s*'([+-])([^']+) minutes'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1$2 minutes')")
    // "datetime('now', '-28 days')" / "'+3 days'": usado por el panel de
    // analíticas para acotar el rango (ver /api/admin/analiticas/* en
    // index.js). Mismo patrón que la traducción de "minutes" de arriba,
    // pero con "days" y sin límite en el número de dígitos.
    .replace(/datetime\('now',\s*'([+-])([^']+) days'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1$2 days')")
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    // "date(columna)" (SQLite) -> "columna::date" (Postgres), usado para
    // agrupar la evolución diaria de vistas por día en vez de por
    // timestamp exacto.
    .replace(/\bdate\(([a-zA-Z_][\w.]*)\)/gi, "$1::date");
  out = out.replace(/programado_para\s*(<=|>)\s*CURRENT_TIMESTAMP/gi, "programado_para::timestamptz $1 CURRENT_TIMESTAMP");
  // "columna IS ?" es válido en SQLite (comparación tolerante a NULL, se
  // comporta como "=" salvo que alguno de los dos lados sea NULL), pero en
  // PostgreSQL "IS" solo admite los literales NULL/TRUE/FALSE a su derecha
  // -- nunca un parámetro bindeado ($1, $2...). Con un parámetro ahí,
  // Postgres lanza un error de sintaxis en tiempo de ejecución (no al
  // arrancar, así que pasa desapercibido hasta la primera vez que se
  // ejecuta esa consulta en producción). El equivalente exacto en Postgres
  // es "IS NOT DISTINCT FROM", que si compara con NULL se comporta igual
  // que "IS NULL", y si compara con un valor no nulo se comporta como "=".
  // Se traduce ANTES de convertir "?" en "$n" para no interferir con esa
  // conversión (que ya cuenta cuántos "?" hay en la cadena).
  out = out.replace(/\bIS\s+\?/gi, "IS NOT DISTINCT FROM ?");
  // "<columna> COLLATE NOCASE" (típicamente en ORDER BY, para que la a-z
  // ignore mayúsculas/minúsculas) es una collation de SQLite que no existe
  // en PostgreSQL de serie -- "collation \"nocase\" for encoding \"UTF8\"
  // does not exist". El equivalente sin depender de tener esa collation
  // instalada en el servidor de Postgres es envolver la columna en
  // LOWER(...): mismo efecto práctico (orden alfabético insensible a
  // mayúsculas), sin requerir configuración adicional en la base de datos.
  // Se captura la palabra/columna inmediatamente anterior a "COLLATE
  // NOCASE" (nombres de columna válidos: letras, dígitos, guión bajo).
  out = out.replace(/(\w+)\s+COLLATE\s+NOCASE/gi, "LOWER($1)");
  out = out.replace(/\?(\d+)/g, (_, index) => { n = Math.max(n, Number(index)); return `$${index}`; });
  out = out.replace(/\?/g, () => `$${++n}`);
  return { sql: out, params };
}
