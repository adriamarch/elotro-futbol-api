// Campos deliberadamente volátiles que pueden cambiar durante una comparación.
// Se siguen sincronizando desde D1 a PostgreSQL; únicamente se excluyen del
// veredicto del comparador para evitar falsos positivos por cambios en vuelo.
export const CAMPOS_VOLATILES_COMPARADOR = Object.freeze({
  sessions: Object.freeze(new Set(["last_seen_at"])),
});
