# Packages

Shared libraries for the Arciin monorepo. Apps import these packages — **never PostgreSQL directly** from web or mobile clients.

| Package | Purpose |
|---------|---------|
| `@arciin/types` | Shared TypeScript types, socket events, job payloads |
| `@arciin/config` | App constants, env schemas, AI/user settings defaults |
| `@arciin/storage` | Storage roots, paths, layout, migration helpers |
| `@arciin/ui` | Shared UI tokens, toast styles, `cn()` utility |
| `@arciin/database` | Prisma client (API + worker only) |
| `@arciin/shared` | Domain helpers + backward-compatible re-exports |

## Import guidance

```ts
// Prefer specific packages
import { APP_VERSION, apiEnvSchema } from "@arciin/config"
import type { RealtimeEvent } from "@arciin/types"
import { ARCIIN_DEFAULT_STORAGE_ROOT } from "@arciin/storage"
import { cn, TOAST_STYLES } from "@arciin/ui"

// Legacy (still supported)
import { inferMediaType } from "@arciin/shared"
```

## Server vs client

Only **server processes** (`apps/api`, `apps/worker`) use `@arciin/database`.  
`apps/web` and external clients (`arciin-app`) use the HTTP API as the gatekeeper.
