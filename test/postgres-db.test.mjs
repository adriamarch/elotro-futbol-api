import assert from "node:assert/strict";
import { translateSql } from "../src/sql-compat.js";
const a=translateSql("SELECT * FROM users WHERE id = ? AND activo = ?");
assert.equal(a.sql,"SELECT * FROM users WHERE id = $1 AND activo = $2");
assert.deepEqual(a.params,[]);
const b=translateSql("UPDATE results SET inicio_cronometro_at = datetime('now', ?), estado='en_juego' WHERE id=?");
assert.equal(b.sql,"UPDATE results SET inicio_cronometro_at = (CURRENT_TIMESTAMP + $1::interval), estado='en_juego' WHERE id=$2");
const c=translateSql("SELECT * FROM articles WHERE programado_para <= datetime('now') AND id = ?");
assert.equal(c.sql,"SELECT * FROM articles WHERE programado_para::timestamptz <= CURRENT_TIMESTAMP AND id = $1");
console.log("postgres-db translation tests: OK");

const d=translateSql("SELECT * FROM articles WHERE slug = ?1 AND publicado = ?2");
assert.equal(d.sql,"SELECT * FROM articles WHERE slug = $1 AND publicado = $2");
console.log("numbered placeholder test: OK");
