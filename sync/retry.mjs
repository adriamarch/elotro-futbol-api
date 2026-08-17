// Reintentos con backoff exponencial (FASE4.md sección 9).
// No distingue "errores permanentes" de "temporales" de forma muy fina:
// en la práctica los errores más probables aquí (conexión caída, timeout,
// deadlock/serialización de Postgres) son todos reintentables, y un error
// de datos (violación de constraint) fallará igual en el reintento sin
// bloquear el resto -por eso el bucle exterior de tabla/registro sigue
// adelante tras agotar los reintentos, ver sync/incremental.mjs-.

export async function conReintentos(fn, { intentos = 4, esperaBaseMs = 500, onRetry } = {}) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn(intento);
    } catch (error) {
      ultimoError = error;
      if (intento === intentos) break;
      const espera = esperaBaseMs * 2 ** (intento - 1);
      if (onRetry) onRetry({ intento, error, esperaMs: espera });
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }
  throw ultimoError;
}
