// LaLiga Hypermotion es fútbol profesional: no se cubre a pie de campo y el formulario no admite sus solicitudes.
//   node --no-warnings --test tests/acreditaciones-hypermotion.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/acreditaciones-hypermotion.test.mjs
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

let ip = 100;
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

const HYPERMOTION = [
  "AD Ceuta FC", "Albacete Balompié", "Burgos CF", "Cádiz CF", "CD Castellón", "CD Eldense", "CD Leganés", "CD Tenerife",
  "CE Sabadell", "Celta Fortuna", "Córdoba CF", "FC Andorra", "Girona FC", "Granada CF", "Real Sociedad B", "RCD Mallorca",
  "Real Oviedo", "Real Sporting", "Real Valladolid CF", "SD Eibar", "UD Almería", "UD Las Palmas",
];

test("los 22 clubes de Hypermotion se rechazan con 422 y no se guarda nada", async () => {
  for (const equipo of HYPERMOTION) {
    const r = await enviar({ equipo });
    assert.equal(r.status, 422, equipo + " -> " + JSON.stringify(r.data));
    assert.equal(r.data.categoria_no_cubierta, "hypermotion");
  }
  assert.equal(filas().length, 0);
});

test("nombres cortos, otras grafías y mayúsculas también se rechazan", async () => {
  for (const equipo of ["Almería", "almeria", "UD ALMERÍA", "Celta B", "RC Celta B", "Sporting de Gijón", "Tenerife", "Real Valladolid", "las palmas", "cadiz"]) {
    const r = await enviar({ equipo });
    assert.equal(r.status, 422, equipo);
  }
  assert.equal(filas().length, 0);
});

test("\"forzar\" no salta el bloqueo de Hypermotion", async () => {
  const r = await enviar({ equipo: "Granada CF", forzar: true });
  assert.equal(r.status, 422);
  assert.equal(filas().length, 0);
});

test("filiales y clubes parecidos de otras categorías NO se bloquean", async () => {
  const permitidos = ["Girona FC B", "Real Oviedo Vetusta", "CD Castellón B", "CD Tenerife B", "RCD Mallorca B", "Las Palmas Atlético", "Atlético Albacete", "Real Valladolid Promesas", "SD Eibar B", "Sporting Atlético", "Arosa SC", "Real Zaragoza"];
  let i = 0;
  for (const equipo of permitidos) {
    i++;
    const r = await enviar({ equipo, email: `p${i}@example.com`, jornada_partido: "Jornada " + i + ": A - B" });
    assert.equal(r.status, 200, equipo + " -> " + JSON.stringify(r.data));
  }
  assert.equal(filas().length, permitidos.length);
});

test("un club dado de alta a mano en Hypermotion también se bloquea", async () => {
  sqlite.exec("CREATE TABLE IF NOT EXISTS custom_clubs (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, categoria TEXT NOT NULL, escudo_url TEXT, autor_id INTEGER)");
  sqlite.prepare("INSERT INTO custom_clubs (nombre, categoria) VALUES ('Racing de Santander', 'hypermotion')").run();
  const r = await enviar({ equipo: "racing  de santander", email: "rs@example.com" });
  assert.equal(r.status, 422);
});
