# Operations

Day-to-day running of a live instance: deploying safely, checking health,
recovering from data problems.

## Deploying without stepping on yourself

Arciin serves the production build from `apps/web/.next`. A `next dev` writing to
the same directory, or two builds at once, corrupts the running site — this has
caused a live 500 outage. Use the lock:

```bash
pnpm deploy:lock:status
pnpm deploy:safe          # acquire → build → restart → release
```

Manual sequence:

```bash
node scripts/deploy-lock.mjs acquire
pnpm exec prisma migrate deploy
ARCIIN_ENV_NAMESPACE=production pnpm build:web
pm2 restart arciin-api arciin-worker arciin-web
node scripts/deploy-lock.mjs release
```

The lock records pid, user, command and start time, and treats a lock older than
30 minutes whose process is gone as stale.

**Never `pm2 restart all`** — that would take down `arciin-mobile`, `arceclaw`
and `arceclaw-tunnel`, which are separate applications.

**Restart web after every build.** `next start` reads the build manifest at boot;
rebuilding underneath a running server leaves it serving a stale manifest and
404ing new chunks.

## Health checks

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/api/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/             # 307 → /login
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/             # 200
pm2 list
```

`307` from the web app is correct — the root redirects to `/login` when
unauthenticated.

Climbing PM2 restart counts mean something is crash-looping; check
`pm2 logs arciin-api --err`.

## Logs

`/srv/arciin-storage/arciin/logs/api.log`, JSON lines from pino.

The API trims oversized logs every 15 minutes, so **startup entries disappear
from a busy instance within the hour**. Do not conclude a boot-time event never
happened just because you cannot find it — check process start times instead:

```bash
ps -o lstart= -p $(pgrep -f "apps/api/src/index.ts" | head -1)
```

## Data integrity

### Assets whose bytes are missing

```bash
node scripts/repair-missing-assets.mjs           # dry run, always safe
node scripts/repair-missing-assets.mjs --apply
```

Finds live assets whose storage object is absent, tries to recover them by
SHA-256 from backup snapshots, dev storage, library mirrors and temp, and marks
whatever cannot be recovered as `FAILED` with an explanation.

It deliberately never writes a thumbnail back as an original — a 400px WebP is
not the photograph someone uploaded, and substituting one turns missing data
into *wrong* data. It never deletes the asset row, and it never marks anything
`READY`. Every previous status is snapshotted to `reports/` before any write,
and the update is guarded on `status: "READY"` so a concurrent edit is never
overwritten.

See [`UPLOAD_RECOVERY.md`](./UPLOAD_RECOVERY.md) for the 2026-08-12 run: 115 assets, 0
recoverable, all marked `FAILED`.

### Uploads that never finished

Uploads are committed in one transaction with an **outbox** row per background
job (`UploadOutbox`), so the intent to process is as durable as the asset.
Dispatch to Redis happens after commit and may fail freely — a reconciler drains
anything still pending every 60 seconds.

```sql
SELECT status, count(*) FROM "UploadOutbox" GROUP BY status;
```

A growing `PENDING` count means Redis is unreachable or the worker is down.
Job ids are derived from the work, so re-dispatch is a no-op rather than a
duplicate.

Before this existed, a `queue.add` that threw stranded the asset in `PROCESSING`
forever; that is how 1,278 sessions were lost.

## Backups

Snapshots live in `/srv/arce-projects/arciin-backups/<timestamp>/`:

```
MANIFEST.txt  database.dump  env.backup  storage/
```

Restore is a `pg_restore` of `database.dump` plus copying `storage/` back over
the storage root. **Verify a backup contains the objects you expect** — the
2026-08-12 investigation found five snapshots, none of which held the 115
missing files, because the bytes were already gone when the earliest was taken.

## Environment isolation

Development must never share production's database, Redis DB, BullMQ prefix,
storage root or Next build directory. `ARCIIN_ENV_NAMESPACE` selects the set and
**defaults to `dev`** — the safe direction. Startup asserts isolation and
refuses to run a dev stack against production resources.

```bash
pnpm dev:doctor    # reports which resources the current env resolves to
```

A rogue `pnpm dev` has previously consumed production BullMQ jobs and
overwritten the production `.next`. If uploads stall or the site serves an
unexpected build, check for stray dev processes first.
