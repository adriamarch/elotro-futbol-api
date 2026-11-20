// Filtro automático de enlaces e insultos en comentarios (src/moderacion.js).
//   node --no-warnings --test tests/moderacion-comentarios.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { analizarComentario, contieneEnlace, contieneInsulto } from "../src/moderacion.js";

const motivo = (texto, nombre = "Marc") => {
  const r = analizarComentario({ texto, nombre });
  return r.ok ? null : r.motivo;
};

test("bloquea enlaces con protocolo, www y dominios sueltos", () => {
  for (const t of [
    "mira esto https://ejemplo.com/oferta",
    "http://x.y",
    "entra en www.apuestas.net ya",
    "www . algo . org",
    "gana dinero en casinoreal.com",
    "visita tienda.shop hoy",
    "escribeme a spam@correo.com",
    "apuestas[.]xyz",
    "mi web: miweb punto com",
    "pasate por t.me/canal",
    "bit.ly/3abcde",
    "whatsapp +34 600 123 456",
  ]) assert.equal(motivo(t), "enlace", t);
});

test("el enlace también se detecta en el nombre", () => {
  assert.equal(motivo("Gran partido", "Ofertas www.spam.com"), "enlace");
});

test("no bloquea texto normal de una crónica ni abreviaturas con punto", () => {
  for (const t of [
    "Gran partido del equipo, merece la pena verlo.",
    "El min.90 fue clave. Y el 1.5 de ventaja en la tabla.",
    "Qué golazo!!! Vamos Gimnàstic",
    "Lo dijo el míster en rueda de prensa.es verdad",
    "Final 2-1, mañana a las 21.30 en el estadio",
    "gol.es increíble",
    "Escribe a @elotrofutbol en redes",
  ]) assert.equal(motivo(t), null, t);
});

test("bloquea insultos directos, con tildes, mayúsculas y letras repetidas", () => {
  for (const t of [
    "Eres un gilipollas",
    "ÁRBITRO IMBÉCIL",
    "sois unos subnormales",
    "cabrooooon",
    "puuuuta",
    "hijo de puta",
    "HIJOS   DE   PUTA",
    "malparit",
  ]) assert.equal(motivo(t), "insulto", t);
});

test("bloquea insultos disfrazados (leet, asteriscos, letras separadas)", () => {
  for (const t of [
    "gilip0llas",
    "idi0ta",
    "p*ta",
    "m4lnacido",
    "i.d.i.o.t.a",
    "i d i o t a",
    "capu\u200Bllo",
  ]) assert.equal(motivo(t), "insulto", t);
});

test("bloquea expresiones discriminatorias y amenazas", () => {
  for (const t of ["moro de mierda", "ojalá te mueras", "te voy a matar", "vete a la mierda"]) {
    assert.equal(motivo(t), "insulto", t);
  }
});

test("no bloquea críticas duras ni expresiones habituales en fútbol", () => {
  for (const t of [
    "Qué puto amo es el delantero, golazo",
    "Arbitraje vergonzoso, otra vez nos perjudican",
    "Este equipo de mierda no gana nunca",
    "Joder, qué partido",
    "Menudo coño de penalti",
    "El míster es un inútil y debería dimitir",
    "Hostia, qué remontada",
  ]) assert.equal(motivo(t), null, t);
});

test("no hay falsos positivos por subcadenas (problema de Scunthorpe)", () => {
  for (const t of [
    "La computadora del club falló",
    "Su disputa con el árbitro terminó mal",
    "Se reputa como el mejor del grupo",
    "Un concierto después del partido, en la capital",
    "Cabrera marcó de cabeza y Mariano Díaz de penalti",
  ]) assert.equal(motivo(t), null, t);
});

test("el mensaje nunca repite la palabra detectada", () => {
  const r = analizarComentario({ texto: "eres un gilipollas", nombre: "Ana" });
  assert.equal(r.ok, false);
  assert.ok(!/gilipollas/i.test(r.mensaje));
});

test("entradas vacías o no válidas no lanzan error", () => {
  assert.deepEqual(analizarComentario(), { ok: true });
  assert.deepEqual(analizarComentario({ texto: null, nombre: undefined }), { ok: true });
  assert.equal(contieneEnlace(undefined), false);
  assert.equal(contieneInsulto(12345), false);
});
