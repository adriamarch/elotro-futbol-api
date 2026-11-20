// Quitar/cambiar el rol de alguien (o desactivarlo / eliminarlo) CIERRA sus sesiones abiertas,
// en la API principal y en la secundaria, y el panel lo detecta solo (vigilante de sesión).
// Uso: node --test tests/cierre-sesion-al-quitar-rol.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const leer = (r) => fs.readFileSync(new URL(r, import.meta.url), "utf8");

function bloquePutUsuarios(src) {
  const a = src.indexOf('if (userMatch && method === "PUT")');
  const b = src.indexOf('if (userMatch && method === "DELETE")', a);
  assert.ok(a > 0 && b > a, "no se encuentra el PUT /api/users/:id");
  return src.slice(a, b);
}
function bloqueDeleteUsuarios(src) {
  const a = src.indexOf('if (userMatch && method === "DELETE")');
  assert.ok(a > 0, "no se encuentra el DELETE /api/users/:id");
  return src.slice(a, a + 12000);
}

for (const [nombre, ruta] of [["principal", "../src/index.js"], ["secundaria", "../../worker-secondary/src/index.js"]]) {
  const src = leer(ruta);

  test(`API ${nombre}: cambiar el rol o desactivar revoca las sesiones y vacía la caché de sesión`, () => {
    const put = bloquePutUsuarios(src);
    const i = put.indexOf("rolFinalUsuario !== user.rol || seDesactivaUsuario");
    assert.ok(i > 0, "falta la condición de cierre de sesiones");
    const tras = put.slice(i, i + 400);
    assert.match(tras, /UPDATE sessions SET revoked_at = datetime\('now'\) WHERE user_id = \? AND revoked_at IS NULL/);
    assert.match(tras, /invalidarCacheCorta\("sesion:"\)/);
  });

  test(`API ${nombre}: editar nombre/correo/equipos NO cierra sesión (solo rol o desactivar)`, () => {
    const put = bloquePutUsuarios(src);
    assert.match(put, /const seDesactivaUsuario = Number\(user\.activo\) === 1 && body\.activo !== undefined && !body\.activo;/);
    assert.equal((put.match(/UPDATE sessions SET revoked_at/g) || []).length, 1);
  });

  test(`API ${nombre}: eliminar la cuenta borra o revoca sus sesiones`, () => {
    const del = bloqueDeleteUsuarios(src);
    assert.match(del, /(DELETE FROM sessions WHERE user_id = \?|UPDATE sessions SET revoked_at = datetime\('now'\) WHERE user_id = \?)/);
    assert.match(del, /invalidarCacheCorta\("sesion:"\)/);
  });

  test(`API ${nombre}: la validación de sesión rechaza revocadas y cuentas inactivas`, () => {
    assert.match(src, /if \(sesion && sesion\.revoked_at\) return null;/);
    assert.match(src, /if \(!estado \|\| Number\(estado\.activo\) !== 1\) return null;/);
  });
}

test("panel: el vigilante de sesión está cargado y cierra al confirmarse el 401", () => {
  const html = leer("../../public/admin/panel.html");
  assert.match(html, /vigilante-sesion\.js/);
  const v = leer("../../public/admin/js/vigilante-sesion.js");
  assert.match(v, /res\.status === 401/);
  assert.match(v, /avisarYCerrar/);
  assert.match(v, /se ha cambiado tu rol/);
});
