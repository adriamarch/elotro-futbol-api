// Aviso de conflicto en acreditaciones: si OTRA persona ya pidió la misma función (tipo de acreditación)
// para el mismo equipo, evento y partido, el formulario no guarda y avisa (409). Quien insiste con
// `forzar: true` la envía igualmente y llega al equipo marcada como FORZADA.
//   node --no-warnings --test tests/acreditaciones-conflicto.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/acreditaciones-conflicto.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { cabeceraSesion } from "./ayuda-sesion-acreditacion.mjs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../migracion_acreditaciones_v2.sql", import.meta.url), "utf8"));
const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...limpiar(args)) ?? null,
      all: async () => ({ results: st.all(...limpiar(args)) }),
      run: async () => { const r = st.run(...limpiar(args)); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    });
    return { ...mk([]), bind: (...args) => mk(args) };
  },
};
const env = { DB, JWT_SECRET: "secreto-de-pruebas-0123456789abcdef", TURNSTILE_DESACTIVADO: "1", RESEND_API_KEY: "re_test", RESEND_FROM: "Test <no-reply@elotrofutbol.media>" };
const pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

const correos = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes("resend")) { try { correos.push(JSON.parse(init.body)); } catch {} }
  return new Response("{}", { status: 200 });
};

let ip = 0;
async function enviar(extra = {}) {
  ip++;
  const cuerpo = {
    nombre: "Ana López", email: "ana@example.com", dni: "12345678Z",
    equipo: "Arosa SC", tipo_evento: "Partido de fútbol", tipo_acreditacion: "Fotógrafo / Césped",
    funciones: "Fotos del partido", jornada_partido: "Jornada 5: Arosa SC - Bergantiños", confirmo: true,
    ...extra,
  };
  const res = await worker.fetch(new Request("https://api.test/api/acreditaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.0.${ip}`, ...(await cabeceraSesion(sqlite, "secreto-de-pruebas-0123456789abcdef")) },
    body: JSON.stringify(cuerpo),
  }), env, ctx);
  await Promise.all(pendientes.splice(0));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const filas = () => sqlite.prepare("SELECT * FROM acreditaciones ORDER BY id").all();

test("la primera solicitud se guarda sin aviso", async () => {
  const r = await enviar();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.equal(filas().length, 1);
  assert.equal(filas()[0].nota_admin, null);
});

test("otra persona pidiendo lo mismo: 409 con aviso y no se guarda", async () => {
  const r = await enviar({ nombre: "Beto Ruiz", email: "beto@example.com", dni: "87654321X" });
  assert.equal(r.status, 409);
  assert.equal(r.data.conflicto, true);
  assert.equal(filas().length, 1, "no debe crearse la segunda solicitud");
  // No se filtra quién la pidió.
  assert.ok(!JSON.stringify(r.data).includes("Ana"));
  assert.ok(!JSON.stringify(r.data).includes("ana@example.com"));
});

test("se detecta aunque cambien mayúsculas, tildes o signos en el partido", async () => {
  const r = await enviar({ nombre: "Beto Ruiz", email: "beto@example.com", jornada_partido: "JORNADA 5 — arosa sc  bergantinos", equipo: "AROSA  sc" });
  assert.equal(r.status, 409);
});

test("otra función en el mismo partido NO es conflicto", async () => {
  const r = await enviar({ nombre: "Beto Ruiz", email: "beto@example.com", tipo_acreditacion: "Prensa / Pupitre" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(filas().length, 2);
});

test("la misma función en otro partido NO es conflicto", async () => {
  const r = await enviar({ nombre: "Cris Pons", email: "cris@example.com", jornada_partido: "Jornada 6: Bergantiños - Coruxo" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("forzar: se guarda marcada como FORZADA y avisa al equipo", async () => {
  correos.length = 0;
  const r = await enviar({ nombre: "Beto Ruiz", email: "beto@example.com", forzar: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  const f = filas().find((x) => x.email === "beto@example.com" && x.tipo_acreditacion === "Fotógrafo / Césped");
  assert.ok(f, "debe existir la solicitud forzada");
  assert.match(f.nota_admin, /FORZADA/);
  assert.equal(f.estado, "pendiente");
  assert.ok(correos.some((c) => /\[FORZADA\]/.test(c.subject || "")), "el correo al equipo debe ir marcado");
});

test("quien ya la pidió y reenvía sigue recibiendo OK silencioso (no es conflicto consigo mismo)", async () => {
  const antes = filas().length;
  const r = await enviar();
  assert.equal(r.status, 200);
  assert.equal(r.data.duplicada, true);
  assert.equal(filas().length, antes);
});

test("una solicitud rechazada o cancelada libera el hueco", async () => {
  sqlite.prepare("UPDATE acreditaciones SET estado = 'rechazada'").run();
  const r = await enviar({ nombre: "Dani Soto", email: "dani@example.com" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
