import assert from "node:assert/strict";
import { test } from "node:test";
import { TABLES, TABLES_IN_ORDER, getTable } from "../tables.mjs";
import { conReintentos } from "../retry.mjs";
import { escaparValorD1 } from "../d1-client.mjs";
import { CAMPOS_VOLATILES_COMPARADOR } from "../comparator-config.mjs";

test("las 16 tablas del documento de Fase 4 están configuradas", () => {
  const nombres = TABLES.map((t) => t.name).sort();
  const esperadas = [
    "activity_log",
    "alineaciones",
    "article_slug_redirects",
    "articles",
    "club_info",
    "club_info_solicitudes",
    "comments",
    "custom_clubs",
    "edit_requests",
    "match_events",
    "media",
    "nivel_historial",
    "results",
    "sessions",
    "settings",
    "users",
  ].sort();
  assert.deepEqual(nombres, esperadas);
});

test("el orden de sincronización no repite posiciones y respeta dependencias básicas", () => {
  const posiciones = TABLES.map((t) => t.order);
  assert.equal(new Set(posiciones).size, posiciones.length, "hay posiciones de orden duplicadas");

  const indice = Object.fromEntries(TABLES_IN_ORDER.map((t, i) => [t.name, i]));
  // users antes que articles (autor_id -> users)
  assert.ok(indice.users < indice.articles);
  // results antes que articles (resultado_id -> results)
  assert.ok(indice.results < indice.articles);
  // results antes que match_events (resultado_id -> results)
  assert.ok(indice.results < indice.match_events);
  // articles antes que article_slug_redirects (article_id -> articles)
  assert.ok(indice.articles < indice.article_slug_redirects);
  // articles antes que comments (article_id -> articles)
  assert.ok(indice.articles < indice.comments);
  // users antes que sessions (user_id -> users)
  assert.ok(indice.users < indice.sessions);
});

test("toda tabla con changeStrategy updated_at tiene cursorColumn = updated_at", () => {
  for (const t of TABLES) {
    if (t.changeStrategy === "updated_at") {
      assert.equal(t.cursorColumn, "updated_at", `${t.name} debería usar updated_at como cursor`);
    }
    if (t.changeStrategy === "immutable") {
      assert.equal(t.cursorColumn, "created_at", `${t.name} debería usar created_at como cursor`);
    }
  }
});

test("getTable lanza para nombres no configurados", () => {
  assert.throws(() => getTable("tabla_inexistente"));
  assert.equal(getTable("users").name, "users");
});

test("conReintentos reintenta y finalmente lanza tras agotar intentos", async () => {
  let llamadas = 0;
  await assert.rejects(
    conReintentos(
      async () => {
        llamadas++;
        throw new Error("fallo simulado");
      },
      { intentos: 3, esperaBaseMs: 1 }
    )
  );
  assert.equal(llamadas, 3);
});

test("conReintentos devuelve el resultado si un intento posterior tiene éxito", async () => {
  let llamadas = 0;
  const resultado = await conReintentos(
    async () => {
      llamadas++;
      if (llamadas < 2) throw new Error("fallo temporal");
      return "ok";
    },
    { intentos: 3, esperaBaseMs: 1 }
  );
  assert.equal(resultado, "ok");
  assert.equal(llamadas, 2);
});

test("escaparValorD1 escapa comillas simples y respeta null/number/boolean", () => {
  assert.equal(escaparValorD1(null), "NULL");
  assert.equal(escaparValorD1(undefined), "NULL");
  assert.equal(escaparValorD1(42), "42");
  assert.equal(escaparValorD1(true), "1");
  assert.equal(escaparValorD1("O'Brien"), "'O''Brien'");
});


test("users, settings y sessions son autoritativas desde D1", () => {
  for (const name of ["users", "settings", "results", "comments", "club_info_solicitudes", "edit_requests", "sessions"]) {
    const t = getTable(name);
    assert.equal(t.syncMode, "authoritative", `${name} debe reconciliarse desde D1`);
    assert.equal(t.deleteDetection, true, `${name} debe eliminar sobrantes en PostgreSQL`);
  }
});


test("el comparador trata sessions.last_seen_at como campo volátil, sin dejar de sincronizarlo", () => {
  assert.equal(CAMPOS_VOLATILES_COMPARADOR.sessions.has("last_seen_at"), true);
  assert.equal(CAMPOS_VOLATILES_COMPARADOR.sessions.has("user_id"), false);
  assert.equal(CAMPOS_VOLATILES_COMPARADOR.sessions.has("expires_at"), false);
});
