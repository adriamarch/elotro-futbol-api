// Ayuda común de los tests del formulario de acreditación: el formulario exige cuenta
// (Responsable, o redactor/fotógrafo de Nivel 2+), así que crea una cuenta y firma su JWT.
export async function cabeceraSesion(sqlite, secreto, { username, rol = "admin", nivel = 4 } = {}) {
  const usuario = username || `acred.${rol}.${nivel}`;
  let fila = sqlite.prepare("SELECT id FROM users WHERE username = ?").get(usuario);
  if (!fila) {
    sqlite.prepare("INSERT INTO users (username, password_hash, salt, nombre, rol, nivel, email, activo) VALUES (?, 'x', 'x', ?, ?, ?, ?, 1)")
      .run(usuario, "Cuenta Prueba", rol, nivel, usuario + "@x.es");
    fila = sqlite.prepare("SELECT id FROM users WHERE username = ?").get(usuario);
  }
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const datos = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ uid: Number(fila.id), rol, nombre: "Cuenta Prueba", tfa: true, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(datos)));
  return { Authorization: `Bearer ${datos}.${Buffer.from(new TextEncoder().encode(String.fromCharCode(...firma))).toString("base64url")}` };
}
