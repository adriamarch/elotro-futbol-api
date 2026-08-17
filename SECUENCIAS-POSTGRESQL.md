# Reparación de secuencias PostgreSQL

El validador sincroniza únicamente IDs numéricos autogenerados.

- `smallint`, `integer`, `bigint`: se comprueba la secuencia.
- `IDENTITY`: se usa `ALTER COLUMN ... RESTART WITH`.
- `SERIAL`: se usa `pg_get_serial_sequence()` + `setval()`.
- IDs `TEXT`/UUID no se tratan como números y no se aplica `COALESCE(..., 0)`.

La reparación no elimina filas.

Prueba:

```powershell
$env:DATABASE_URL="TU_DATABASE_PUBLIC_URL"
npm run test:railway
```

Reparación independiente:

```powershell
npm run db:sync-sequences
```
