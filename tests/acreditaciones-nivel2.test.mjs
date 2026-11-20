// El formulario de acreditación está cerrado: solo con cuenta y a partir del Nivel 2.
//   node --no-warnings --test tests/acreditaciones-nivel2.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/acreditaciones-nivel2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { cabeceraSesion } from "./ayuda-sesion-acreditacion.mjs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;

const SECRETO = "secreto-de-pruebas-0123456789abcdef";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../migracion_acreditaciones_v2.sql", import.meta.url), "utf8"));
// Aunque un admin dejara guardado el modo libre o con PIN, el formulario sigue exigiendo cuenta.
sqlite.prepare("INSERT INTO settings (key, value) VALUES ('acreditacion_acceso', 'solicitar')").run();
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
const env = { DB, JWT_SECRET: SECRETO, TURNSTILE_DESACTIVADO: "1", RESEND_API_KEY: "re_test", RESEND_FROM: "Test <no-reply@elotrofutbol.media>" };
const pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };
globalThis.fetch = async () => new Response("{}", { status: 200 });

let ip = 0;
async function llamar(ruta, metodo, cabeceras, cuerpo) {
  ip++;
  const res = await worker.fetch(new Request("https://api.test" + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.1.0.${ip}`, ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }), env, ctx);
  await Promise.all(pendientes.splice(0));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const solicitud = (equipo) => ({
  nombre: "Ana López", email: "ana@example.com", dni: "12345678Z", equipo,
  tipo_evento: "Partido de fútbol", tipo_acreditacion: "Prensa / Pupitre",
  funciones: "Crónica", jornada_partido: "Jornada 5: " + equipo + " - Rival", confirmo: true,
});
const sesion = (rol, nivel, nombre) => cabeceraSesion(sqlite, SECRETO, { username: `${rol}.n${nivel}.${nombre || ""}`, rol, nivel });
const guardadas = () => sqlite.prepare("SELECT COUNT(*) AS n FROM acreditaciones").get().n;

test("sin sesión no entra nadie, ni en modo libre ni con PIN: 401", async () => {
  const comprobar = await llamar("/api/acreditaciones/pin", "POST", {}, { pin: "1234" });
  assert.equal(comprobar.status, 401);
  assert.equal(comprobar.data.motivo, "sin_sesion");
  const envio = await llamar("/api/acreditaciones", "POST", {}, solicitud("Arosa SC"));
  assert.equal(envio.status, 401);
  assert.equal(guardadas(), 0);
});

test("la configuración pública anuncia siempre el acceso con cuenta", async () => {
  const r = await llamar("/api/acreditaciones/config", "GET", {});
  assert.equal(r.status, 200);
  assert.equal(r.data.acceso, "login");
});

test("redactor de Nivel 1: 403 con su nivel y el progreso hacia el Nivel 2; no se guarda", async () => {
  const h = await sesion("redactor", 1);
  const comprobar = await llamar("/api/acreditaciones/pin", "POST", h, {});
  assert.equal(comprobar.status, 403);
  assert.equal(comprobar.data.motivo, "nivel");
  assert.equal(comprobar.data.bloqueo.nivel, 1);
  assert.equal(comprobar.data.bloqueo.nivel_minimo, 2);
  assert.ok(Array.isArray(comprobar.data.bloqueo.progreso) && comprobar.data.bloqueo.progreso.length > 0);
  assert.match(comprobar.data.error, /Nivel 2/);
  const envio = await llamar("/api/acreditaciones", "POST", h, solicitud("Arosa SC"));
  assert.equal(envio.status, 403);
  assert.equal(guardadas(), 0);
});

test("redactor de Nivel 2 y superiores: pueden", async () => {
  for (const n of [2, 3, 4]) {
    const h = await sesion("redactor", n);
    const comprobar = await llamar("/api/acreditaciones/pin", "POST", h, {});
    assert.equal(comprobar.status, 200, `nivel ${n}`);
    assert.equal(comprobar.data.ok, true);
  }
  const envio = await llamar("/api/acreditaciones", "POST", await sesion("redactor", 2), solicitud("Arosa SC"));
  assert.equal(envio.status, 200, JSON.stringify(envio.data));
  assert.equal(guardadas(), 1);
});

test("el nivel se lee de la base: un ascenso vale al momento con el mismo token", async () => {
  const h = await sesion("redactor", 1, "asciende");
  assert.equal((await llamar("/api/acreditaciones/pin", "POST", h, {})).status, 403);
  sqlite.prepare("UPDATE users SET nivel = 2 WHERE username = ?").run("redactor.n1.asciende");
  assert.equal((await llamar("/api/acreditaciones/pin", "POST", h, {})).status, 200);
});

test("fotógrafos: todos pueden, F1 y F2", async () => {
  assert.equal((await llamar("/api/acreditaciones/pin", "POST", await sesion("fotografo", 1), {})).status, 200);
  assert.equal((await llamar("/api/acreditaciones/pin", "POST", await sesion("fotografo", 2), {})).status, 200);
  const envio = await llamar("/api/acreditaciones", "POST", await sesion("fotografo", 1, "envia"), { ...solicitud("Racing Villalbés"), tipo_acreditacion: "Fotógrafo / Césped" });
  assert.equal(envio.status, 200, JSON.stringify(envio.data));
});

test("los Responsables (admin) siempre pueden", async () => {
  assert.equal((await llamar("/api/acreditaciones/pin", "POST", await sesion("admin", 1), {})).status, 200);
});

test("el panel ya no puede reabrir el formulario con PIN o libre", async () => {
  const h = await sesion("admin", 4);
  const libre = await llamar("/api/acreditaciones/acceso", "PUT", h, { acceso: "solicitar" });
  assert.equal(libre.status, 400);
  const pin = await llamar("/api/acreditaciones/acceso", "PUT", h, { acceso: "pin" });
  assert.equal(pin.status, 400);
});
