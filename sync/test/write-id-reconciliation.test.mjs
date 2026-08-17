import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliarFilasPorOriginWriteId } from "../pg-writer.mjs";

// Mock mínimo de un client de "pg": solo implementa .query(sql, params) y
// deja que cada test decida qué responder según el texto de la consulta.
// No se prueba contra Postgres real aquí (eso vive en
// sync/test/integration.test.mjs, que sí requiere DATABASE_URL) -- este
// test cubre la LÓGICA de reconciliarFilasPorOriginWriteId de forma
// aislada, que es justo lo que faltaba: la función se escribió para
// resolver un límite documentado en 003_pending_writes.sql pero no tenía
// ningún test que la ejerciera antes de esta reescritura.
function crearClientMock({ filasHuerfanasPorWriteId = {}, fallaDeleteParaPk = null } = {}) {
  const deletes = [];
  const inserts = [];
  const client = {
    async query(sql, params) {
      if (sql.startsWith("SELECT") && sql.includes("WHERE origin_write_id")) {
        const writeId = params[0];
        const filas = filasHuerfanasPorWriteId[writeId] || [];
        return { rows: filas, rowCount: filas.length };
      }
      if (sql.startsWith("DELETE FROM")) {
        deletes.push(params);
        if (fallaDeleteParaPk && JSON.stringify(params) === JSON.stringify(fallaDeleteParaPk)) {
          throw new Error("update or delete on table violates foreign key constraint");
        }
        return { rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO sync_write_id_conflicts")) {
        inserts.push(params);
        return { rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en el mock: ${sql}`);
    },
  };
  return { client, deletes, inserts };
}

test("reconciliarFilasPorOriginWriteId: sin origin_write_id en ninguna fila, no hace nada", async () => {
  const { client, deletes } = crearClientMock();
  const resultado = await reconciliarFilasPorOriginWriteId(
    client,
    "articles",
    [{ id: 501, origin_write_id: null }],
    ["id"]
  );
  assert.equal(resultado.huerfanasEliminadas, 0);
  assert.deepEqual(resultado.conflictos, []);
  assert.equal(deletes.length, 0);
});

test("reconciliarFilasPorOriginWriteId: fila huérfana con PK distinto se elimina", async () => {
  const writeId = "11111111-1111-1111-1111-111111111111";
  const { client, deletes } = crearClientMock({
    filasHuerfanasPorWriteId: { [writeId]: [{ id: 42 }] }, // id de PostgreSQL creado durante el failover
  });
  const filasD1 = [{ id: 501, origin_write_id: writeId }]; // id definitivo que le asignó D1
  const resultado = await reconciliarFilasPorOriginWriteId(client, "articles", filasD1, ["id"]);
  assert.equal(resultado.huerfanasEliminadas, 1);
  assert.deepEqual(resultado.conflictos, []);
  assert.deepEqual(deletes, [[42]]);
});

test("reconciliarFilasPorOriginWriteId: si el PK ya coincide (pasada anterior ya reconciliada), no borra nada", async () => {
  const writeId = "22222222-2222-2222-2222-222222222222";
  const { client, deletes } = crearClientMock({
    filasHuerfanasPorWriteId: { [writeId]: [{ id: 501 }] }, // ya es el mismo id que trae D1
  });
  const filasD1 = [{ id: 501, origin_write_id: writeId }];
  const resultado = await reconciliarFilasPorOriginWriteId(client, "articles", filasD1, ["id"]);
  assert.equal(resultado.huerfanasEliminadas, 0);
  assert.deepEqual(deletes, []);
});

test("reconciliarFilasPorOriginWriteId: sin fila huérfana previa (no hubo failover para esa fila), no hace nada", async () => {
  const { client, deletes } = crearClientMock({ filasHuerfanasPorWriteId: {} });
  const filasD1 = [{ id: 501, origin_write_id: "33333333-3333-3333-3333-333333333333" }];
  const resultado = await reconciliarFilasPorOriginWriteId(client, "articles", filasD1, ["id"]);
  assert.equal(resultado.huerfanasEliminadas, 0);
  assert.deepEqual(deletes, []);
});

test("reconciliarFilasPorOriginWriteId: si el DELETE falla (p.ej. FK), se registra el conflicto y no se aborta", async () => {
  const writeId = "44444444-4444-4444-4444-444444444444";
  const pkHuerfana = [42];
  const { client, deletes, inserts } = crearClientMock({
    filasHuerfanasPorWriteId: { [writeId]: [{ id: 42 }] },
    fallaDeleteParaPk: pkHuerfana,
  });
  const filasD1 = [{ id: 501, origin_write_id: writeId }];
  const resultado = await reconciliarFilasPorOriginWriteId(client, "articles", filasD1, ["id"]);
  assert.equal(resultado.huerfanasEliminadas, 0);
  assert.equal(resultado.conflictos.length, 1);
  assert.equal(resultado.conflictos[0].origin_write_id, writeId);
  assert.deepEqual(deletes, [[42]]);
  // El conflicto debe quedar además persistido en sync_write_id_conflicts,
  // no solo devuelto en memoria -- si el proceso muere justo después, no
  // debe perderse constancia de que hay una fila duplicada sin resolver.
  assert.equal(inserts.length, 1);
});

test("reconciliarFilasPorOriginWriteId: varias filas huérfanas para el mismo write_id (caso raro) se eliminan todas", async () => {
  const writeId = "55555555-5555-5555-5555-555555555555";
  const { client, deletes } = crearClientMock({
    filasHuerfanasPorWriteId: { [writeId]: [{ id: 42 }, { id: 43 }] },
  });
  const filasD1 = [{ id: 501, origin_write_id: writeId }];
  const resultado = await reconciliarFilasPorOriginWriteId(client, "articles", filasD1, ["id"]);
  assert.equal(resultado.huerfanasEliminadas, 2);
  assert.deepEqual(deletes.sort(), [[42], [43]]);
});
