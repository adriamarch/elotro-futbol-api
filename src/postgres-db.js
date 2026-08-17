import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  ssl: process.env.PGSSL === "disable" ? false : undefined,
});

console.log("[postgres] DATABASE_URL configurada:", Boolean(process.env.DATABASE_URL));

try {
  const u = new URL(process.env.DATABASE_URL);
  console.log("[postgres] host:", u.hostname);
  console.log("[postgres] port:", u.port || "5432");
  console.log("[postgres] database:", u.pathname);
} catch (error) {
  console.error("[postgres] DATABASE_URL inválida:", error.message);
}

const TABLES_WITH_ID = new Set([
  "users","articles","results","match_events","media","custom_clubs",
  "edit_requests","comments","club_info_solicitudes","activity_log",
  "nivel_historial","alineaciones"
]);

import { translateSql } from "./sql-compat.js";
function maybeAddReturning(sql) {
  if (!/^INSERT\s+INTO\s+/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  const m = sql.match(/^INSERT\s+INTO\s+([\"`]?)([a-zA-Z_][\w]*)\1/i);
  if (!m || !TABLES_WITH_ID.has(m[2])) return sql;
  return `${sql} RETURNING id`;
}

function bindable(sql, params) { return translateSql(sql, params); }

class PreparedStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
  const q = bindable(this.sql, this.params);
  try {
    const r = await this.db.query(q.sql, q.params);
    return r.rows[0] ?? null;
  } catch (error) {
    console.error("[postgres:first]", {
      originalSql: this.sql,
      translatedSql: q.sql,
      params: q.params,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
    });
    throw error;
  }
}
  async all() {
    const q = bindable(this.sql, this.params);
    const r = await this.db.query(q.sql, q.params);
    return { results: r.rows };
  }
  async run() {
    let sql = maybeAddReturning(this.sql);
    const q = bindable(sql, this.params);
    const r = await this.db.query(q.sql, q.params);
    const row = r.rows[0];
    return {
      success: true,
      meta: {
        changes: r.rowCount ?? 0,
        last_row_id: row?.id ?? null,
      },
    };
  }
}

export function createD1CompatDb() {
  return {
    prepare(sql) { return new PreparedStatement(pool, sql); },
    async batch(statements) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results = [];
        for (const statement of statements) {
          const sql = maybeAddReturning(statement.sql);
          const q = bindable(sql, statement.params || []);
          const r = await client.query(q.sql, q.params);
          results.push({ success: true, meta: { changes: r.rowCount ?? 0, last_row_id: r.rows[0]?.id ?? null }, results: r.rows });
        }
        await client.query("COMMIT");
        return results;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally { client.release(); }
    },
  };
}

export async function checkPostgres() {
  const started = Date.now();
  const r = await pool.query("SELECT 1 AS ok");
  return { ok: r.rows[0]?.ok === 1, responseTime: Date.now() - started };
}

export async function closePostgres() { await pool.end(); }
