export function translateSql(sql, params = []) {
  let n = 0;
  let out = sql
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/datetime\('now',\s*\?\)/gi, "(CURRENT_TIMESTAMP + ?::interval)")
    .replace(/datetime\('now',\s*'([+-])([^']+) minutes'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1$2 minutes')")
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  out = out.replace(/programado_para\s*(<=|>)\s*CURRENT_TIMESTAMP/gi, "programado_para::timestamptz $1 CURRENT_TIMESTAMP");
  out = out.replace(/\?(\d+)/g, (_, index) => { n = Math.max(n, Number(index)); return `$${index}`; });
  out = out.replace(/\?/g, () => `$${++n}`);
  return { sql: out, params };
}
