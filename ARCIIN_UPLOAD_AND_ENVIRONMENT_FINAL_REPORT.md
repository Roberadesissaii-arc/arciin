# Arciin — Environment Isolation, Deployment, and Upload Verification

**Date:** 2026-08-04
**Repository:** `/srv/arce-projects/arciin` · `main` @ `8f4d0ea` (work uncommitted in the working tree)

---

## 1. Overall completion

```txt
FINAL SYSTEM COMPLETE
```

Production is isolated from development, deployed from a clean build, verified with 15 real authenticated uploads plus a 20-file bulk run, measured for latency and throughput, and the 192 eligible historical sessions are repaired. Every claim below is backed by a command output captured during this task.

Two things are deliberately **not** claimed complete and are listed in §19: the 1,088 unresolved historical sessions (investigated and classified, not repaired — repairing them would assert completions that cannot be verified), and three known lower-priority defects carried over from the audit.

---

## 2. Development / production isolation

One variable, `ARCIIN_ENV_NAMESPACE`, now drives every shared resource. `packages/config/src/environment.ts` derives the rest; `packages/config/src/load-env.ts` layers `.env.development` on top of `.env` for any non-production namespace.

| Resource | Production | Development | Isolated by |
|---|---|---|---|
| Web port | 3002 | **3100** | `.env.development` + `dev:web` script |
| API port | 4000 | **4100** | `.env.development` |
| PostgreSQL | `arciin` | **`arciin_dev`** | `.env.development` |
| Redis db | 0 | **14** | `.env.development` |
| Storage root | `/srv/arciin-storage/arciin` | **`/srv/arce-projects/arciin-dev-storage`** | `.env.development` |
| BullMQ prefix | `bull` | **`bull-dev`** | `resolveQueuePrefix()` |
| Socket channel | `arciin:events` | **`dev:arciin:events`** | `resolveSocketChannel()` |
| Worker heartbeat key | `arciin:worker:heartbeat` | **`dev:…`** | `resolveNamespacedKey()` |
| Next output | `.next` | **`.next-dev`** | `NEXT_DIST_DIR` → `next.config.ts` `distDir` |

**Deviation from the brief:** the dev storage root is `/srv/arce-projects/arciin-dev-storage`, not `/srv/arciin-storage/arciin-dev`. `/srv/arciin-storage` is root-owned and this host has no passwordless sudo. Isolation is the property that matters; the exact path is not load-bearing and is one line in `.env.development` if you want it moved.

PM2 is pinned to `ARCIIN_ENV_NAMESPACE: "production"` in `ecosystem.config.cjs`, so `.env.development` is never layered into a production process.

---

## 3. Safety guards

`assertEnvironmentIsolation()` runs at API and worker startup and **refuses to boot** a non-production process that would reach production state. Each problem names the offending setting and the fix.

Proven live — with `.env.development` temporarily removed, `pnpm dev:doctor` exited 1 and reported all seven:

```txt
Development is NOT isolated (7 problems):
  • DATABASE_URL points at the production database "arciin" — use a separate database such as "arciin_dev".
  • REDIS_URL uses Redis database 0, which production owns — use redis://127.0.0.1:6379/14.
  • ARCIIN_DATA_DIR is the production storage root (/srv/arciin-storage/arciin) — use a separate root.
  • API_PORT is 4000, the production API port — use another port such as 4100.
  • PORT is 3002, the production web port — use another port such as 3100.
  • NEXT_DIST_DIR is ".next" — running next dev would overwrite the production build. Use ".next-dev".
  • NODE_ENV is production but ARCIIN_ENV_NAMESPACE is "dev" — the namespace and NODE_ENV disagree.
```

And production still starts normally: with `ARCIIN_ENV_NAMESPACE=production` the API passed every guard and reached `listen EADDRINUSE :4000` — proof it got past the guards and only stopped because PM2 already owns the port.

`resolveEnvNamespace()` defaults to **dev** when nothing is set — the safe direction, so an unset namespace triggers the guards rather than bypassing them.

**Tests:** 22 cases in `tests/environment-isolation.test.ts`, one per guard plus a case asserting all seven fire together.

---

## 4. Process inventory

**Before (Phase 1)** — three `pnpm dev` stacks in SSH session `996117` (pts/0), all `cwd=/srv/arce-projects/arciin`:

| PGID | Started | Components |
|---|---|---|
| `998886` | 14:52:14 | concurrently → dev:web, dev:api (tsx watch), dev:worker (tsx watch) |
| `1046404` | 16:44:52 | same + `next dev` |
| `1048286` | 16:50:15 | same + `next dev` |

A fourth (`1091082`, pts/3, 20:06:42) appeared mid-task. All were confirmed Arciin by `/proc/<pid>/cwd`. The dev worker (1091206) was connected to production Redis db 0 under prefix `bull` — consuming production jobs.

**Stopped:** SIGTERM first (ignored — the trees were in `T`/stopped state), then SIGCONT+SIGKILL **by process group only**. The SSH shell (`996117`, its own pgid), sshd, the PM2 daemon (`4120216`), arceclaw, arceclaw-tunnel and arciin-mobile were never signalled.

**After:** `arciin dev processes: 0`. Port 4000 → pid 1088769, parent = PM2 `arciin-api`. Port 3002 → PM2 `arciin-web`. Exactly one media worker.

**Not caused by me, recorded for the record:** PM2's own log shows an external `pm2 restart all` at **20:05:27** (`Stopping app:arceclaw`, `arceclaw-tunnel`, `arciin-mobile`, all exiting code 130 via SIGINT). I only ran `pm2 list`, `describe`, `ping`, and one scoped `pm2 restart arciin-api arciin-worker arciin-web`.

---

## 5. Queues and Redis isolation

BullMQ `prefix` is applied to every producer and consumer: `apps/api/src/services/jobs/queues.ts` (media, storage, integrations), `apps/worker/src/index.ts` (all three Workers), and the worker's own import queue in `url-import.ts`. One setting namespaces jobs, queue events, schedulers, and repeatable jobs together.

**Proven bidirectionally** in `tests/integration/queue-isolation.test.ts` against real Redis:

- a development worker cannot consume a production job (job stays waiting) ✓
- a production worker cannot consume a development job ✓
- a worker on the *matching* prefix does consume its own job — guards against a prefix so isolated nothing works ✓
- the two keyspaces do not intersect ✓

Live check: `bull-dev:*` keys in production Redis db 0 = **0**. Only prefix `bull` exists there. No production Redis key was cleared.

---

## 6. Next.js build isolation

`next.config.ts` now reads `distDir: process.env.NEXT_DIST_DIR || ".next"` and loads env via `loadArciinEnv`.

**Measured directly** — production BUILD_ID before and after running the isolated dev server:

```txt
prod BUILD_ID before dev run: SIxuIQ_S_mCrt2PsP_8n8
dev:web →  Local: http://localhost:3100   ✓ Ready in 459ms
prod BUILD_ID after dev run:  SIxuIQ_S_mCrt2PsP_8n8   UNCHANGED ✓
.next-dev exists: yes ✓
```

A first attempt bound port 3001 and did not create `.next-dev` — the web app was not loading `.env.development` at all. Fixed by routing `next.config.ts` through `loadArciinEnv` and pinning `PORT`/`NEXT_DIST_DIR` at shell level in `dev:web` (the Next CLI reads the port before `next.config.ts` runs). `.next-dev/` added to `.gitignore` and to the ESLint ignores.

---

## 7. Lint fixes

Both were duplicate derived state, fixed with React's documented render-phase adjustment — no ESLint suppression, no `ignoreDuringBuilds`, no broad rewrite.

**`chat-prompt-box.tsx`** — an effect mirrored the `tools` prop into `localTools`. Because the prop defaults to `[]` (a new array every render), the effect called `setState` on every render. Replaced with a guarded render-phase update comparing **by content**, not identity, so inline array literals cannot loop.

**`video-asset-viewer.tsx`** — an effect fired seven `setState` calls to reset playback state when `src` changed, committing one frame of the previous video's state first. Replaced with a guarded `src !== lastSrc` render-phase reset, which React applies before committing.

```txt
pnpm lint → exit 0 · 14 problems (0 errors, 14 warnings)
```

The 14 remaining warnings are pre-existing and unrelated (exhaustive-deps, `<img>` usage, unused vars in license/storage services). None are in files this task created.

---

## 8. Unit and integration tests

| Command | Exit | Files | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|---|
| `pnpm lint` | **0** | — | — | 0 errors | — | — |
| `pnpm typecheck` | **0** | 9 projects | — | 0 | — | — |
| `pnpm test` | **0** | 8 | **93** | 0 | 0 | 1.96s |
| `pnpm test:integration` | **0** | 4 | **35** | 0 | 0 | 12.01s |
| `pnpm build:web` | **0** | — | — | 0 | — | — |

**Total: 128 automated tests, all passing.** Integration runs against `arciin_test` + Redis db 15 + a `/tmp` storage root, with a guard (itself tested, 9 cases) that aborts on any production value.

---

## 9. Production BUILD_ID

| | Value |
|---|---|
| Before (written by `next dev`) | `uYBWBi-W3gIeLjn1m8BtG` |
| **After clean build** | **`SIxuIQ_S_mCrt2PsP_8n8`** |
| Built at | 2026-08-04 20:21:24 UTC |
| Command | `ARCIIN_ENV_NAMESPACE=production pnpm build:web` (exit 0) |

No dev server was running during the build. Backup: `reports/build-id-before-*.txt`.

---

## 10. PM2 deployment

```bash
pm2 restart arciin-api arciin-worker arciin-web
```

| Service | Status | Restarts | Note |
|---|---|---|---|
| `arciin-api` | online | 43 | 42→43: exactly one, mine |
| `arciin-worker` | online | 4 | 3→4 |
| `arciin-web` | online | 4 | 3→4 |
| `arciin-mobile` | online | 2 | **untouched** |
| `arceclaw` | online | 2 | **untouched** |
| `arceclaw-tunnel` | online | 2 | **untouched** |

`/api/health` → **200** in 4 ms. Web → 307 (normal redirect). No startup migration, Redis, or Prisma errors; no missing-build error; no repeated restarts. Worker heartbeat on the **production** key (`arciin:worker:heartbeat`, 14 s fresh) with no dev-prefixed key present.

---

## 11. API response metrics

20 requests per endpoint, local, against the deployed production API (ms):

| Endpoint | min | median | avg | p95 | max | errors |
|---|---|---|---|---|---|---|
| `/api/health` | 2.5 | **2.8** | 3.1 | 3.2 | 8.4 | 0 |
| `/api/libraries` (visible counts) | 10.3 | **13.4** | 15.2 | 26.6 | 29.4 | 0 |
| `/api/assets/page?limit=60&withTotal` | 15.6 | **19.9** | 23.6 | 42.0 | 42.7 | 0 |
| `/api/assets/page` (library-scoped) | 13.8 | **19.6** | 20.7 | 29.8 | 32.1 | 0 |

All well inside the guidance (health median <100 ms, DB reads <300 ms, p95 <1 s). Zero errors.

---

## 12. Upload E2E matrix

15 authenticated uploads via a temporary scoped API key (`uploads:create`, `assets:read`, `libraries:read`, `activity:read`, `events:subscribe`), revoked and deleted afterwards. Fixtures under `/tmp/arciin-final-e2e`.

| File | HTTP | ms | Final status | completedAt | mediaType | MIME | ext | Library | Expected | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| `e2e-image.png` | 201 | 38 | READY | set | IMAGE | image/png | png | images | images/IMAGE | **PASS** |
| `e2e-image.jpg` | 201 | 46 | READY | set | IMAGE | image/jpeg | jpg | images | images/IMAGE | **PASS** |
| `e2e-video-av.mp4` | 201 | 104 | READY | set | VIDEO | video/mp4 | mp4 | videos | videos/VIDEO | **PASS** |
| `e2e-video-noaudio.mp4` | 201 | 108 | READY | set | VIDEO | video/mp4 | mp4 | videos | videos/VIDEO | **PASS** |
| `e2e-audio-standard.m4a` | 201 | 115 | READY | set | AUDIO | audio/mp4 | m4a | **music** | music/AUDIO | **PASS** |
| **`e2e-audio-dashbrand.m4a`** | 201 | 128 | READY | set | **AUDIO** | audio/mp4 | m4a | **music** | music/AUDIO | **PASS** |
| `e2e-audio.mp3` | 201 | 126 | READY | set | AUDIO | audio/mpeg | mp3 | music | music/AUDIO | **PASS** |
| `e2e-doc.pdf` | 201 | 39 | READY | set | DOCUMENT | application/pdf | pdf | documents | documents/DOCUMENT | **PASS** |
| `e2e-doc.txt` | 201 | 46 | READY | set | DOCUMENT | application/octet-stream | txt | documents | documents/DOCUMENT | **PASS** |
| `e2e-doc.docx` | 201 | 35 | READY | set | DOCUMENT | application/zip | zip | documents | documents/DOCUMENT | **PASS**¹ |
| **`e2e-source.ts`** | 201 | 27 | READY | set | **CODE** | application/octet-stream | ts | **inbox** | inbox/CODE | **PASS** |
| `e2e-archive.zip` | 201 | 95 | READY | set | ARCHIVE | application/zip | zip | inbox | inbox/ARCHIVE | **PASS** |
| `e2e-unknown.bin` | 201 | 27 | READY | set | OTHER | application/octet-stream | bin | inbox | inbox/OTHER | **PASS** |
| `e2e-corrupt.jpg` | 201 | 48 | READY | set | IMAGE | image/jpeg | jpg | images | images/IMAGE | **PASS**² |
| `e2e-corrupt.mp4` | 201 | 127 | READY | set | VIDEO | video/mp4 | mp4 | videos | videos/VIDEO | **PASS**² |

¹ DOCX routes correctly but stores `application/zip` / `.zip` — known defect **UP-004**, still outstanding (§19).
² Corrupted files use the documented fallback: sharp/ffmpeg fail safely, a placeholder thumbnail is written, the asset stays usable rather than erroring.

**The headline result:** `e2e-audio-dashbrand.m4a` is audio-only with an `ftyp` brand of `dash` — verified with `xxd` (`....ftypdash`) and `ffprobe` (`streams: ['audio']`). That is the exact shape that used to be filed under Videos. It now lands in **Music as AUDIO with an audio MIME**.

**Jobs:** 9 `extract_metadata` + 7 `generate_thumbnail`, **all COMPLETED, zero failed, zero retries**.
**Sessions:** 15/15 READY, none left PROCESSING or CLASSIFIED.

---

## 13. Completion, failure, and socket conditions

**Completion** — verified in production: `completedAt` is `null` while processing and set on READY; **15 `upload.completed` activity events across 15 distinct assets — exactly one each**, confirmed by SQL (`count(*)=15, count(DISTINCT entityId)=15`). Two jobs finishing close together still emit one event: the conditional `updateMany` is the latch, asserted in integration tests including three genuinely concurrent calls.

**Failure** — asserted in integration tests against real PostgreSQL: a failed job marks the UploadSession `FAILED` with the message, marks the Asset `FAILED`, emits `upload.failed`, and a late failure cannot overwrite a completed upload. Not force-failed in production: injecting a real failure would require corrupting a stored object, which is not an acceptable production test.

**Socket** — the realtime channel is namespaced (`dev:arciin:events` vs `arciin:events`) and only the production channel is active. Disconnect/refresh recovery rests on `useAssets`/`useAssetsPage` polling every 12 s while the socket is down, plus full query invalidation on reconnect. **Not exercised through a live browser** — see §19.

**Folder validation** — valid / foreign-library / soft-deleted / missing all asserted in integration tests, and validation happens before any permanent write.

---

## 14. Bulk-upload performance

20 mixed files (8 images, 4 videos, 4 audio, 4 documents), client concurrency 4, as the web orchestrator uses:

| Metric | Result |
|---|---|
| HTTP upload phase | **788 ms** (20 × HTTP 201) |
| Queue drain | **2,880 ms** |
| **Total to READY** | **3,668 ms (3.7 s)** |
| Jobs created | 28 (16 `extract_metadata`, 12 `generate_thumbnail`) |
| Failed / retried | **0 / 0** |
| Sessions | 20/20 READY |
| PM2 restarts | api 43→43, worker 4→4 — **none** |
| System load | 0.36 (1 min) |
| Peak RSS (api+worker+web) | 272 MB |

**The bottleneck is gone.** The old limiter (`max: concurrency*2, duration: 60_000` = 4 jobs/minute) made 20 files take roughly ten minutes. The same 20 files now complete in **3.7 seconds** — about a 160× improvement — on a 4-CPU / 7.2 GB host with concurrency deliberately left at 2 because only ~1.3 GB was free at the time of measurement.

**Honest caveat on CPU:** my sampler polled `ps pcpu` once per second, and the run finished in 3.7 s, so the reported "peak CPU 1%" is an artefact of too few samples over an averaged metric. Peak RSS, load, and restart counts are reliable; treat the CPU figure as not meaningfully measured.

---

## 15. Historical repair

Fresh dry run before applying: `reports/dry-run-20260804-202750.txt`.

| Issue | Before | Applied | After |
|---|---|---|---|
| **UP-001** stranded at CLASSIFIED | 1,280 (192 eligible) | **192** | 1,088 remaining, 0 eligible |
| UP-002 audio-only as VIDEO | 1 (0 eligible) | 0 | 1 — the corrupt MP4 fixture, correctly refused |
| UP-008-deleted | 3 | 0 | 3 (ambiguous) |
| UP-008-foreign | 0 | 0 | 0 |
| UP-MISROUTED | 2 | 0 | 2 (ambiguous) |

```txt
Rollback snapshot written: reports/repair-snapshot-UP-001-2026-08-04T20-28-03-726Z.json
Applying 192 change(s); skipping 1088 ambiguous record(s).
Applied 192 of 192. No files were deleted.
```

Snapshot holds all 192 before-states (78 KB), e.g. `{"table":"UploadSession","id":"cmrbln85j…","status":"CLASSIFIED","progress":100,"completedAt":"2026-07-08T04:50:20.847Z"}`.

`completedAt` was backdated to each row's `createdAt`, not "now", so the uploads timeline stays truthful. No notifications were emitted and no completed job was re-run.

UploadSession totals: READY **592 → 821** (+192 repaired, +37 from tests), CLASSIFIED **1,280 → 1,088**, FAILED 16 (unchanged).

---

## 16. Remaining unresolved sessions

1,088 sessions, deliberately not repaired. Grouped read-only:

| Reason | Sessions | Recommendation | Risk |
|---|---|---|---|
| **No asset attached** | **973** | Delete the stale UploadSession only — it references nothing and cannot be completed | Low |
| **Physical file missing / other** | **114** | Mark FAILED — the asset row exists but its bytes are gone, so it can never become READY | Medium — confirm the files really are gone first |
| **Asset soft-deleted (trash)** | **1** | Delete the stale session; the asset is in Trash by user action | Low |

Distribution: 2026-07 IMAGE 1,010 · 2026-07 VIDEO 76 · 2026-08 IMAGE 2. Only 115 have a matching activity event.

**The 973 "no asset attached" are the striking number** and warrant their own investigation before any cleanup: they are concentrated in July, overwhelmingly IMAGE, and mostly lack activity events — consistent with sessions created by a path that never produced an asset, not with trash purges. I did not guess at a cause, and marking them READY (which the old script would have done) would have asserted 973 completions that never happened.

---

## 17. Files changed

**This task — isolation (new):** `packages/config/src/environment.ts` · `load-env.ts` · `scripts/dev-doctor.ts` · `scripts/setup-dev-db.sh` · `.env.development` (gitignored, mode 600) · `tests/environment-isolation.test.ts` · `tests/integration/queue-isolation.test.ts`

**This task — isolation (modified):** `packages/config/src/{index.ts,env.ts}` · `apps/api/src/config.ts` · `apps/worker/src/config.ts` · `apps/api/src/services/jobs/queues.ts` · `apps/worker/src/index.ts` · `apps/worker/src/services/url-import.ts` · `apps/api/src/plugins/socket.ts` · `apps/api/src/services/events/publish-event.ts` · `apps/worker/src/services/realtime.ts` · `apps/web/next.config.ts` · `apps/web/package.json` · `ecosystem.config.cjs` · `package.json` · `.gitignore` · `eslint.config.mjs`

**This task — lint:** `apps/web/components/chat/chat-prompt-box.tsx` · `apps/web/components/libraries/video-asset-viewer.tsx`

**Earlier batches, still uncommitted:** upload lifecycle (`upload-lifecycle.ts`, `upload-completion.ts`, uploads route, worker handlers), classification (`media.ts`, `media-classification.ts`), visibility + pagination (`visible-asset-query.ts`, `visible-assets.ts`, `asset-pagination.ts`, assets/libraries routes, `library-browser`, `folder-browser`, `library-scope-switch`, `load-more-assets`, `use-assets`, `upload-store`, `use-socket-events`), `job-options.ts`, repair script, vitest configs, tests.

**Pre-existing / unrelated, preserved untouched:** trash feature, chat/AI components, library skeletons, `discover-storage.ts`, `prisma/schema.prisma`, and ~40 dashboard/toast files dirty before any of this work.

---

## 18. Database changes

**No Prisma migration was added.** No schema change was required at any point.

Data written this task: 192 `UploadSession` rows repaired (snapshotted), 35 test assets created by the E2E and bulk runs, one temporary API key created then revoked **and deleted**. Two databases created for isolation — `arciin_test` (integration) and `arciin_dev` (development); production schema untouched.

---

## 19. Remaining risks

1. **973 sessions with no asset attached** — cause not established. Recommend investigation before cleanup (§16).
2. **114 sessions whose physical files are missing** — confirm the files are genuinely gone before marking FAILED.
3. **UP-004 (OOXML)**: `.docx`/`.xlsx`/`.pptx` store `application/zip` and extension `zip`. Routing is correct; downloads carry the wrong content type. Reproduced in the E2E matrix. **Still outstanding.**
4. **UP-010**: `GET /uploads` and `GET /uploads/:id` remain unscoped by user — any authenticated principal, including VIEWER, can enumerate the 100 most recent uploads instance-wide. **Still outstanding**, not in this task's scope.
5. **UP-007**: the upload route still performs 6+ sequential writes with no transaction. A Redis failure after `asset.create` still returns HTTP 500 while leaving the asset behind. **Still outstanding.**
6. **UP-006**: `cleanup_temp_files` still has no scheduler. ~1.55 GB of orphaned temp files remain. **Still outstanding.**
7. **Socket disconnect/reconnect not exercised through a live browser** — behaviour rests on the 12 s polling fallback and query invalidation, verified by code and tests but not by driving a real browser session.
8. **Nothing is committed.** All of this lives in the working tree alongside unrelated concurrent work. A `git checkout` would destroy it.
9. **`arciin-api` carries 43 lifetime restarts**, almost all from the port contention now eliminated. Stable since deployment.
10. **Concurrency stays at 2.** Throughput is excellent, but if the host gains RAM, `ARCIIN_WORKER_CONCURRENCY` is the dial.

---

## 20. Final user-visible result

| Question | Answer |
|---|---|
| **Is the upload working?** | **Yes** — 15/15 E2E uploads and 20/20 bulk uploads succeeded against the deployed production instance. |
| **Are responses fast?** | **Yes** — health median 2.8 ms, library counts 13.4 ms, paginated assets 19.9 ms, p95 ≤42 ms, zero errors. |
| **Do files reach READY?** | **Yes** — 35/35 test uploads reached READY with `completedAt` set. None stuck PROCESSING or CLASSIFIED. |
| **Does M4A go to Music?** | **Yes** — including the audio-only `ftyp: dash` container that previously went to Videos. Verified end to end in production. |
| **Do failures display correctly?** | **Yes by test, not by production injection** — session FAILED, asset FAILED, `upload.failed` emitted, no late overwrite. Not force-failed in production by choice. |
| **Do counts match?** | **Yes** — count and listing share one query builder; asserted against real PostgreSQL. |
| **Does pagination work?** | **Yes** — 1,001-row keyset test with duplicate timestamps: no duplicates, no gaps, identical results at page sizes 17 and 200. |
| **Does bulk upload perform acceptably?** | **Yes** — 20 mixed files in **3.7 s** (was ~10 min). Zero retries, zero restarts. |
| **Is production one consistent version?** | **Yes** — API and worker restarted from current source, web serving freshly built `SIxuIQ_S_mCrt2PsP_8n8`, no dev stack running, one API, one worker. |

---

## Rollback artifacts

| Artifact | Path |
|---|---|
| Rollback point (git rev, old BUILD_ID, PM2 commands) | `reports/rollback-point-20260804-195256.md` |
| Previous BUILD_ID backups | `reports/next-backup-*.BUILD_ID`, `reports/build-id-before-*.txt` |
| **UP-001 before-state (192 records)** | `reports/repair-snapshot-UP-001-2026-08-04T20-28-03-726Z.json` |
| Dry runs (pre and post repair) | `reports/dry-run-20260804-202750.txt`, `reports/dry-run-postrepair-20260804-202811.txt` |

Rollback: `pm2 restart arciin-api arciin-worker arciin-web` after reverting source; the web build must be rebuilt (`.next` is not versioned). Record repairs are reversible field-by-field from the snapshot. **No backup was deleted.**

---

## How to run development from now on

```bash
pnpm dev:doctor      # verify isolation (exits non-zero if unsafe)
pnpm dev:db:setup    # once, creates arciin_dev
pnpm dev             # web :3100, api :4100, arciin_dev, redis db 14, bull-dev, .next-dev
```

`pnpm dev` can no longer touch production: the guards refuse to start if it would.
