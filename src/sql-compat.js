export function translateSql(sql, params = []) {
  let n = 0;
  let out = sql
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/datetime\('now',\s*\?\)/gi, "(CURRENT_TIMESTAMP + ?::interval)")
    .replace(/datetime\('now',\s*'([+-])([^']+) minutes'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1$2 minutes')")
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
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
  out = out.replace(/\?(\d+)/g, (_, index) => { n = Math.max(n, Number(index)); return `$${index}`; });
  out = out.replace(/\?/g, () => `$${++n}`);
  return { sql: out, params };
}
