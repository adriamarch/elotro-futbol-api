// Capa centralizada de acceso a PostgreSQL (vía Cloudflare Hyperdrive).
//
// IMPORTANTE:
// - Este archivo NO sustituye nada todavía. src/index.js sigue usando
//   env.DB (D1) exactamente igual que antes. Esta capa solo queda lista
//   para cuando empecemos a migrar consultas bloque a bloque.
// - Usa el driver "pg" (node-postgres), que es el recomendado por
//   Cloudflare para Hyperdrive (mejor compatibilidad con su caché que
//   otros drivers). Requiere compatibility_flags = ["nodejs_compat"] en
//   wrangler.toml (o "nodejs_compat_v2"), y el binding [[hyperdrive]].
// - Cada llamada crea un Client nuevo y lo cierra al terminar. Es el
//   patrón recomendado en Workers: no hay "servidor" persistente entre
//   peticiones como en Node tradicional, así que no tiene sentido
//   mantener un pool abierto entre invocaciones distintas del Worker.
//   Hyperdrive ya hace el pooling real por detrás; aquí solo abrimos una
//   conexión ligera hacia Hyperdrive, no hacia Railway directamente.

import { Client } from "pg";

/**
 * Crea y conecta un cliente nuevo contra Hyperdrive.
 * Uso interno: las funciones de abajo ya se encargan de abrir y cerrar.
 */
async function conectar(env) {
  if (!env.HYPERDRIVE || !env.HYPERDRIVE.connectionString) {
    throw new Error(
      "No hay binding HYPERDRIVE configurado en wrangler.toml (o falta el ID). " +
      "Revisa el bloque [[hyperdrive]] antes de usar esta capa."
    );
  }
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  return client;
}

/**
 * Ejecuta una consulta cualquiera y devuelve el resultado completo de "pg"
 * (incluye .rows, .rowCount, etc.). Úsala si necesitas algo más que solo
 * las filas (por ejemplo, saber cuántas filas afectó un UPDATE).
 *
 * @param {object} env - el "env" del Worker (para acceder a env.HYPERDRIVE)
 * @param {string} text - SQL con placeholders $1, $2, ... (sintaxis PostgreSQL)
 * @param {Array} params - valores para los placeholders, en orden
 */
export async function query(env, text, params = []) {
  const client = await conectar(env);
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

/**
 * Equivalente a env.DB.prepare(...).bind(...).first() de D1: devuelve la
 * PRIMERA fila como objeto, o null si no hay ninguna. Misma forma de
 * objeto que devolvía D1 (columnas como propiedades directas).
 */
export async function queryOne(env, text, params = []) {
  const result = await query(env, text, params);
  return result.rows[0] ?? null;
}

/**
 * Equivalente a env.DB.prepare(...).bind(...).all() de D1: devuelve un
 * array con todas las filas. D1 envolvía esto en { results: [...] };
 * aquí devolvemos directamente el array, así que en el código migrado
 * hay que ajustar "const { results } = await ...all()" a
 * "const results = await queryMany(...)". Se documentará caso por caso
 * al migrar cada bloque, no se hace un cambio ciego.
 */
export async function queryMany(env, text, params = []) {
  const result = await query(env, text, params);
  return result.rows;
}

/**
 * Equivalente a env.DB.prepare(...).bind(...).run() de D1: para
 * INSERT/UPDATE/DELETE donde no nos interesan las filas devueltas, solo
 * confirmar que se ejecutó. Devuelve { rowCount } para poder comprobar
 * cuántas filas se vieron afectadas si hace falta (D1 no siempre daba
 * esto de forma directa, así que es una mejora, no un cambio de
 * comportamiento visible para el frontend).
 */
export async function execute(env, text, params = []) {
  const result = await query(env, text, params);
  return { rowCount: result.rowCount };
}

/**
 * Ejecuta varias operaciones dentro de una transacción real
 * (BEGIN ... COMMIT, con ROLLBACK automático si algo falla).
 *
 * Uso:
 *   await transaction(env, async (tx) => {
 *     await tx.query("UPDATE ...", [...]);
 *     await tx.query("DELETE ...", [...]);
 *   });
 *
 * "tx" expone tx.query(text, params) usando el MISMO cliente/conexión
 * durante toda la transacción (necesario: cada llamada normal a
 * query() de arriba abre una conexión nueva, lo cual rompería una
 * transacción si se usara tal cual dentro de una).
 *
 * Pensada para casos como el borrado de usuario (13 sentencias
 * seguidas): se usará solo si decidimos explícitamente envolver ese
 * endpoint en una transacción, no se aplica en ningún sitio todavía.
 */
export async function transaction(env, callback) {
  const client = await conectar(env);
  try {
    await client.query("BEGIN");
    const tx = {
      query: (text, params = []) => client.query(text, params),
    };
    const resultado = await callback(tx);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Si el rollback falla (p. ej. conexión ya caída), no ocultamos
      // el error original: lo relanzamos tal cual más abajo.
    }
    throw err;
  } finally {
    await client.end();
  }
}
