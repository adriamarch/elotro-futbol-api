// Inicio · Fase 3A (public/admin/js/inicio-personalizar.js): lógica de orden/ocultado de tarjetas, metas del mes
// y récords, más comprobaciones de que todo está conectado (ids, eventos, orden de carga).
// Ejecutar:  node worker/tests/inicio-personalizar.test.mjs
import fs from "fs";
import vm from "vm";
const root = new URL("../../", import.meta.url).pathname;
let ok = 0, fail = 0;
const t = (n, x, extra = "") => { x ? ok++ : fail++; console.log(x ? "OK   " : "FALLO", n, x ? "" : extra); };
const leer = (p) => fs.readFileSync(root + p, "utf8");
const codigo = leer("public/admin/js/inicio-personalizar.js");
const resumen = leer("public/admin/js/inicio-resumen.js");
const html = leer("public/admin/panel.html");

// Carga el módulo con un «navegador» mínimo y sin la página de Inicio: solo se publica la lógica pura.
function cargar(rol, nivel = 1) {
  const win = { matchMedia: () => ({ matches: false }) };
  const ctx = { window: win, document: { getElementById: () => null, addEventListener() {} }, USER: { id: 7, username: "u", rol }, nivelUsuarioConectado: () => nivel,
    localStorage: { getItem: () => null, setItem() {} }, Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map };
  vm.runInNewContext(codigo, ctx);
  return win.EOFInicioLogica;
}
const L = cargar("redactor");
t("el módulo publica su lógica aunque no haya página de Inicio", !!L && typeof L.normalizarOrden === "function");

// ---------- Tarjetas ----------
const ids = L.WIDGETS.map((w) => w.id);
t("ids de tarjetas únicos", new Set(ids).size === ids.length);
t("solo «Requiere tu atención» y «Cola de revisión» son fijas (no se pueden ocultar)", L.WIDGETS.filter((w) => w.fijo).map((w) => w.id).join() === "pendientes,revision");
t("cada tarjeta apunta a un id que existe en inicio-resumen.js o lo crea el propio módulo", L.WIDGETS.every((w) => {
  const id = w.host || w.dentro;
  return resumen.includes(`id="${id}"`) || codigo.includes(`"${id}"`);
}), L.WIDGETS.filter((w) => !(resumen.includes(`id="${w.host || w.dentro}"`) || codigo.includes(`"${w.host || w.dentro}"`))).map((w) => w.id).join());

const defs = [{ id: "a", col: "izq" }, { id: "b", col: "izq" }, { id: "c", col: "izq" }, { id: "x", col: "der" }, { id: "y", col: "der" }];
t("sin nada guardado: orden por defecto", JSON.stringify(L.normalizarOrden(null, defs)) === JSON.stringify({ izq: ["a", "b", "c"], der: ["x", "y"] }));
t("respeta lo guardado y mete las tarjetas nuevas al final de su columna", JSON.stringify(L.normalizarOrden({ izq: ["c", "a"], der: ["y", "b"] }, defs)) === JSON.stringify({ izq: ["c", "a"], der: ["y", "b", "x"] }),
  JSON.stringify(L.normalizarOrden({ izq: ["c", "a"], der: ["y", "b"] }, defs)));
t("ignora ids que ya no existen y repetidos", JSON.stringify(L.normalizarOrden({ izq: ["a", "a", "zzz"], der: ["a"] }, defs)) === JSON.stringify({ izq: ["a", "b", "c"], der: ["x", "y"] }));
t("tolera datos rotos", JSON.stringify(L.normalizarOrden("basura", defs)) === JSON.stringify({ izq: ["a", "b", "c"], der: ["x", "y"] }) && JSON.stringify(L.normalizarOrden({ izq: 5 }, defs)) === JSON.stringify({ izq: ["a", "b", "c"], der: ["x", "y"] }));

const o = { izq: ["a", "b", "c"], der: ["x", "y"] };
t("bajar «a» la pone detrás de «b»", L.moverTarjeta(o, [], "a", 1, false).izq.join() === "b,a,c");
t("subir «c» la pone delante de «b»", L.moverTarjeta(o, [], "c", -1, false).izq.join() === "a,c,b");
t("al bajar se salta las ocultas (b oculta: a pasa detrás de c)", L.moverTarjeta(o, ["b"], "a", 1, false).izq.join() === "b,c,a");
t("en dos columnas, subir la primera no hace nada", L.moverTarjeta(o, [], "a", -1, false) === null && L.moverTarjeta(o, [], "y", 1, false) === null);
t("en una columna, subir la primera de la derecha la pasa al final de la izquierda", (() => { const r = L.moverTarjeta(o, [], "x", -1, true); return r.izq.join() === "a,b,c,x" && r.der.join() === "y"; })());
t("en una columna, bajar la última de la izquierda la pasa al principio de la derecha", (() => { const r = L.moverTarjeta(o, [], "c", 1, true); return r.izq.join() === "a,b" && r.der.join() === "c,x,y"; })());
t("moverTarjeta no modifica el original", o.izq.join() === "a,b,c");
t("tarjeta desconocida: null", L.moverTarjeta(o, [], "q", 1, false) === null);
t("cambiar de columna la pone al final de la otra", (() => { const r = L.cambiarColumna(o, "a"); return r.izq.join() === "b,c" && r.der.join() === "x,y,a"; })());

// ---------- Metas ----------
t("redactor: metas de publicaciones y visitas", L.defsMetas("redactor").map((d) => d.k).join() === "pub,vis");
t("fotógrafo: metas de fotos y días activos", L.defsMetas("fotografo").map((d) => d.k).join() === "fotos,dias");
t("Responsable: metas del equipo", L.defsMetas("admin").map((d) => d.k).join() === "pub,vis" && L.defsMetas("admin")[0].etq.includes("equipo"));
const fila = { publicaciones: 4, visitas: 90, fotos: 7, dias_activos: 3 };
t("cada meta lee su cifra de la fila del mes", L.defsMetas("redactor")[0].f(fila) === 4 && L.defsMetas("fotografo")[0].f(fila) === 7 && L.defsMetas("fotografo")[1].f(fila) === 3);
t("días de cada mes (incluye bisiesto)", L.diasDelMes("2026-11") === 30 && L.diasDelMes("2026-12") === 31 && L.diasDelMes("2028-02") === 29 && L.diasDelMes("2027-02") === 28);
t("progreso: 9 de 12 a mitad de mes = 75 %, en ritmo, faltan 3", (() => { const p = L.progresoMeta(9, 12, 15, 30); return p.pct === 75 && p.esperado === 50 && p.estado === "ritmo" && p.faltan === 3 && p.quedan === 15; })());
t("progreso: meta cumplida = hecha, 100 % y no pasa de ahí", (() => { const p = L.progresoMeta(15, 12, 15, 30); return p.estado === "hecha" && p.pct === 100 && p.faltan === 0; })());
t("progreso: muy por debajo del ritmo = atrás", L.progresoMeta(2, 20, 20, 30).estado === "atras");
t("progreso: los primeros días del mes nunca salen «atrás»", L.progresoMeta(0, 20, 2, 30).estado === "ritmo");
t("progreso: hasta el 85 % del ritmo esperado aún cuenta como en ritmo (a día 20 de 30, 20 de meta: esperado 13,3 → mínimo 11,3)", L.progresoMeta(12, 20, 20, 30).estado === "ritmo" && L.progresoMeta(11, 20, 20, 30).estado === "atras");
t("progreso: último día", L.progresoMeta(3, 20, 30, 30).quedan === 0);
t("meta sugerida: algo más que el mes pasado", L.metaSugerida(10, 6) === 11 && L.metaSugerida(3, 6) === 4 && L.metaSugerida(100, 6) === 110);
t("meta sugerida: sin referencia usa la del rol", L.metaSugerida(0, 6) === 6);

// ---------- Récords ----------
const ev = [{ mes: "2026-06", publicaciones: 3 }, { mes: "2026-07", publicaciones: 8 }, { mes: "2026-08", publicaciones: 5 }, { mes: "2026-11", publicaciones: 9 }];
const f = (x) => x.publicaciones;
t("récord: mejor mes anterior y mes en que fue", (() => { const r = L.recordMes(ev, "2026-11", f); return r.mejor === 8 && r.mesMejor === "2026-07" && r.valor === 9; })());
t("récord: supera al mejor mes → nuevo récord", L.recordMes(ev, "2026-11", f).esRecord === true);
t("récord: el mes actual no cuenta como «mejor mes anterior»", L.recordMes(ev, "2026-11", f).mejor === 8);
t("récord: sin superarlo no hay récord y se calcula el porcentaje", (() => { const r = L.recordMes([...ev.slice(0, 3), { mes: "2026-11", publicaciones: 4 }], "2026-11", f); return !r.esRecord && r.pct === 50; })());
t("récord: igualar no es batir", !L.recordMes([...ev.slice(0, 3), { mes: "2026-11", publicaciones: 8 }], "2026-11", f).esRecord);
t("récord: con cifras mínimas (1 frente a 0..) no se celebra", !L.recordMes([{ mes: "2026-10", publicaciones: 1 }, { mes: "2026-11", publicaciones: 2 }], "2026-11", f).esRecord);
t("récord: si la evolución aún no trae el mes actual, vale 0", (() => { const r = L.recordMes(ev.slice(0, 3), "2026-11", f); return r.valor === 0 && r.mejor === 8 && r.pct === 0 && !r.esRecord; })());
t("récord: sin ningún mes anterior no hay referencia", (() => { const r = L.recordMes([{ mes: "2026-11", publicaciones: 5 }], "2026-11", f); return r.mejor === 0 && r.pct === null && !r.esRecord; })());
t("récord: evolución vacía o inválida no rompe", L.recordMes(null, "2026-11", f).valor === 0 && L.recordMes([], "2026-11", f).mejor === 0);

// ---------- Conexión con el resto ----------
for (const e of ["eof:inicio-montado", "eof:inicio-pintado", "eof:inicio-visible"]) {
  t(`inicio-resumen.js emite «${e}» y el módulo lo escucha`, resumen.includes(`CustomEvent("${e}")`) && codigo.includes(`addEventListener("${e}"`));
}
t("inicio-resumen.js expone EOFInicio.estado()", /estado: \(\) => \(\{ datos, resumen/.test(resumen));
t("el módulo se carga ANTES que inicio-resumen.js", html.indexOf('<script src="/admin/js/inicio-personalizar.js') > 0 && html.indexOf('<script src="/admin/js/inicio-personalizar.js') < html.indexOf('<script src="/admin/js/inicio-resumen.js'));
t("panel.html enlaza la hoja de estilos nueva", /inicio-personalizar\.css\?v=[0-9a-f]+/.test(html));
t("no usa nada de red ni endpoints nuevos", !/apiFetch|fetch\(/.test(codigo));
t("la clave de almacenamiento es por usuario", /eof_inicio_v1_\$\{USER\.id/.test(codigo));
t("respeta «reducir movimiento» (confeti y barras)", /prefers-reduced-motion/.test(codigo) && /REDUCIR\(\)\) return;\n    const c = document\.createElement/.test(codigo));

console.log(`\n${ok} OK, ${fail} FALLO`);
process.exit(fail ? 1 : 0);
