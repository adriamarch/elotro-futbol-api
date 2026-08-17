# Validación Railway / PostgreSQL

El smoke test valida conexión, migración, esquema, secuencias, constraints y CRUD con rollback.

La tabla `sessions` usa el esquema real:
`id TEXT`, `user_id`, `user_agent`, `ip`, `created_at`, `last_seen_at`, `revoked_at`.
No se presupone `token` ni `expires_at`.

Ejecutar:

```powershell
$env:DATABASE_URL="TU_DATABASE_PUBLIC_URL"
npm run test:railway
```

Los registros creados por el smoke test se ejecutan dentro de una transacción y se revierten.
