// Correo de despedida y agradecimiento al eliminar una cuenta del panel.
//   node --no-warnings --test tests/correo-despedida-cuenta.test.mjs
//   WORKER_ENTRY=../../worker-secondary/src/index.js node --no-warnings --test tests/correo-despedida-cuenta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const entrada = process.env.WORKER_ENTRY
  ? new URL(process.env.WORKER_ENTRY, import.meta.url).href
  : new URL("../src/index.js", import.meta.url).href;
const worker = (await import(entrada)).default;
const JWT_SECRET = "secreto-de-pruebas-0123456789abcdef";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
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
const env = { DB, JWT_SECRET, RESEND_API_KEY: "re_test", RESEND_FROM: "Test <no-reply@elotrofutbol.media>" };
let pendientes = [];
const ctx = { waitUntil(p) { pendientes.push(Promise.resolve(p).catch(() => {})); } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(payload) {
  const data = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return data + "." + Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url");
}

const alta = (username, nombre, rol, email) =>
  Number(sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, email) VALUES (?,?,?,?,?,?)")
    .run(username, "x", "y", nombre, rol, email).lastInsertRowid);
const admin = alta("boss", "Boss", "admin", "boss@x.es");

let enviados = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === "https://api.resend.com/emails" && init.method === "POST") {
    enviados.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "e_" + enviados.length }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

let token;
async function borrar(id) {
  token ||= await jwt({ uid: admin, rol: "admin", nombre: "Boss", tfa: true });
  const res = await worker.fetch(
    new Request("https://api.test/api/users/" + id, { method: "DELETE", headers: { Authorization: "Bearer " + token } }),
    env, ctx
  );
  await Promise.all(pendientes); pendientes = [];
  return res.status;
}

test("al borrar una cuenta con correo se envía la despedida a esa persona", async () => {
  enviados = [];
  const id = alta("lucia", "Lucía Pérez", "redactor", "lucia@x.es");
  assert.equal(await borrar(id), 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(id).n, 0);
  assert.equal(enviados.length, 1);
  const m = enviados[0];
  assert.deepEqual(m.to, ["lucia@x.es"]);
  assert.match(m.subject, /Gracias por todo, Lucía/);
  assert.match(m.html, /Gracias por todo, Lucía/);
  assert.match(m.text, /gracias/i);
  assert.equal(m.reply_to, "elotrofutbolmedio@gmail.com");
});

test("sin correo o con correo sintético de X no se envía nada, pero la cuenta se borra", async () => {
  enviados = [];
  const sin = alta("sinmail", "Sin Correo", "redactor", null);
  const sintetico = alta("conx", "Con X", "fotografo", "123@x.elotrofutbol.media");
  assert.equal(await borrar(sin), 200);
  assert.equal(await borrar(sintetico), 200);
  assert.equal(enviados.length, 0);
});

test("si Resend falla, el borrado sigue siendo correcto", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  try {
    const id = alta("fallo", "Fallo Resend", "redactor", "fallo@x.es");
    assert.equal(await borrar(id), 200);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(id).n, 0);
  } finally { globalThis.fetch = original; }
});

test("el nombre se escapa en el HTML del correo", async () => {
  enviados = [];
  const id = alta("xss", "<b>Mal</b>", "redactor", "xss@x.es");
  assert.equal(await borrar(id), 200);
  assert.equal(enviados.length, 1);
  assert.ok(!enviados[0].html.includes("<b>Mal</b>"));
});

test("a un fotógrafo le llega la despedida con texto de fotografía y legible en modo oscuro", async () => {
  enviados = [];
  const id = alta("foto", "Pablo Ruiz", "fotografo", "pablo@x.es");
  assert.equal(await borrar(id), 200);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].to, ["pablo@x.es"]);
  assert.match(enviados[0].html, /cada foto/);
  // El recuadro del mensaje debe llevar eof-texto: sin esa clase, en modo oscuro quedaba texto oscuro sobre fondo oscuro.
  assert.match(enviados[0].html, /class="eof-ficha eof-texto"/);
});
