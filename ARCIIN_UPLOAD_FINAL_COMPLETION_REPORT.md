# Arciin Upload Repair — Final Completion Report

**Date:** 2026-08-04
**Repository:** `/srv/arce-projects/arciin`
**Branch / HEAD:** `main` @ `8f4d0ea` (no commit made — all work is uncommitted in the working tree)

---

## 1. Overall completion

```txt
FINAL REPAIR PARTIALLY COMPLETE
```

All source work is finished and verified by 101 automated tests (71 unit + 30 integration against a real isolated PostgreSQL). **Deployment, end-to-end smoke tests, and existing-data repair are blocked** by a condition I cannot clear on my own: three concurrent `pnpm dev` stacks are running from a live interactive SSH session, contending with PM2 for port 4000 and — more seriously — sharing the production BullMQ queue with the production worker while running different code.

This cannot be reported as complete. Deployment consistency is the central objective, and it is not achieved.

---

## 2. Finished

### Phase 1 — Baseline
Captured before any change: git revision `8f4d0ea`, node v24.18.0, pnpm 10.32.1, PM2 inventory, web `BUILD_ID`, queue counts, DB counts, and env parity. `DATABASE_URL`, `REDIS_URL`, and `ARCIIN_DATA_DIR` are byte-identical across api/worker/web (compared by SHA-256 prefix, never printed). `ARCIIN_WORKER_CONCURRENCY` is unset everywhere → schema default 2.

### Phase 2 — Concurrent-work ownership
No unrelated change was reverted, no reset, no `git clean`. Ownership map in §11.

### Phase 3 — Batch 1 verification
Every Batch 1 marker verified present in source after the concurrent edits: `initialUploadSessionState`, `apiOwnsCompletionEvent`, `refineIsoMediaClassification`, `summarizeMediaStreams`, `buildVisibleAssetWhere`, `completeUploadSession`, `failUploadSession`, `FOLDER_LIBRARY_MISMATCH`, `pendingProcessing`. Behaviour is additionally pinned by the integration tests in §6.

### Phase 4 — Real cursor pagination *(new this task)*
- `apps/api/src/services/libraries/asset-pagination.ts` — keyset pagination on `(createdAt DESC, id DESC)`. Offset paging would skip or repeat rows as new uploads arrive; `id` is the tie-breaker because a batch upload writes many rows in the same millisecond.
- New route `GET /assets/page` returning `{ items, nextCursor, hasMore, total }`. Deliberately a **separate route** so the documented array response of `GET /assets` — relied on by chat context, share pages, and the separate mobile repo — is unchanged.
- **Category filtering moved into the database.** It previously over-fetched a fixed window and filtered in JS, so a code file older than that window was invisible.
- Count and page share one `where` builder (minus the cursor), so "showing X of Y" cannot drift.
- Frontend: `useAssetsPage` (infinite query) + `LoadMoreAssets`. Query key carries every filter, so changing search / scope / folder / library starts a fresh run — no stale first page, no cross-page duplicates.

**A test caught a real bug here:** the cursor decoder split on the *last* `|`, corrupting the timestamp when an id contained one. Fixed to split on the first.

### Phase 5 — Worker throughput *(new this task)*
Host measured first: **4 CPUs, 7.2 GB RAM, ~1.3 GB available, load 3.2**. Memory is tight, so concurrency was **not** raised.
- `packages/config/src/job-options.ts`: limiter changed from `{max: concurrency*2, duration: 60_000}` (≈2 uploads/minute) to `{max: concurrency*4, duration: 1_000}` — a burst guard, not a throttle. Concurrency still bounds CPU/RAM.
- `attempts: 3` with exponential backoff; `UnrecoverableError` for deterministic failures (missing file) so they fail once instead of burning the retry budget.
- Bounded retention: `removeOnComplete {count:500, age:7d}`, `removeOnFail {count:1000, age:30d}`. No existing Redis key was cleared.
- Applied via `defaultJobOptions` on both the API queues and the worker's own import queue.

### Phase 6 — Isolated integration testing *(new this task)*
- Dedicated `arciin_test` PostgreSQL database, Redis db 15, storage root under `/tmp`.
- `tests/integration/guard.ts` — positive-assertion guard (name *must* contain `test`), aborting on production DB, Redis db 0, production storage root, or `NODE_ENV=production`. **The guard is itself tested, including a case asserting the live suite environment is isolated.**
- `scripts/setup-test-db.sh` + `pnpm test:db:setup`, `pnpm test:integration`, `pnpm test:all`.
- Credentials are derived from `.env` at runtime and never written into a tracked file. (I initially wrote the real URL into the config and removed it.)

### Phase 11 — Rollback readiness
- `reports/rollback-point-20260804-195256.md` — git revision, previous `BUILD_ID`, PM2 rollback commands.
- Repair script now captures per-record **before-state** and writes `reports/repair-snapshot-<issue>-<ts>.json` **before** any write.
- UP-001 eligibility tightened to exactly the task's conditions: asset exists, asset not FAILED, physical file present, no job still QUEUED/ACTIVE/FAILED. `completedAt` is backdated to `createdAt` rather than "now", so repairing history does not corrupt the uploads timeline. No toasts are emitted.

---

## 3. Not finished

| Phase | Status | Reason |
|---|---|---|
| **7 — Deploy** | **BLOCKED** | Three `pnpm dev` stacks contending for port 4000 and the BullMQ queue (§4) |
| **8 — E2E smoke tests** | **NOT RUN** | Requires a stable, single-code-version deployment |
| **9 — Data repair** | **NOT APPLIED** | Fresh dry-run captured; applying while two workers run different code is unsafe |
| **10 — Post-repair verification** | **NOT RUN** | Depends on 7–9 |
| Performance measurement | **NOT RUN** | Two workers on one queue makes any drain-time number meaningless |
| Temporary API key | **NOT CREATED** | Deferred with Phase 8 |

Also outstanding, unchanged and out of scope for this batch: upload authorization (UP-010), transaction refactoring (UP-007), temp-file cleanup scheduling (UP-006).

---

## 4. Production deployment — BLOCKED

**No service was restarted by me. No build was run.**

### The blocker

Three separate `npm run dev` stacks are running, all from a live interactive SSH session (`pts/0`, parent chain `npm run dev` → `-bash` → `sshd-session: arce@pts/0`):

```txt
998886   npm run dev     (started 14:52)
1046404  npm run dev
1048286  npm run dev
```

Each runs `concurrently` → `dev:web` + `dev:api` (`tsx watch`) + `dev:worker` (`tsx watch`).

Consequences:
1. **Port contention.** `arciin-api` shows **40 restarts**. It currently holds :4000 (pid 1047512, parent = PM2's 1047492) and returns `200`, but only after losing the port repeatedly.
2. **Queue contention — the serious one.** Each `dev:worker` consumes the *same* BullMQ queue as the production worker, running *different* code. Which worker picks up a job is a race, so no end-to-end result or drain-time measurement would mean anything.
3. **`next dev` writes into the production `.next`.** `BUILD_ID` changed from `DyUMb12VXr_jUBepWfheW` (Jul 18) to `uYBWBi-W3gIeLjn1m8BtG` (today 16:47) with no production build run — PM2's `next start` is serving artifacts a dev server wrote.

### What I attempted

With your approval I sent `SIGTERM` to the dev tree `998898` and its children. It did not clear: two further stacks were already present and the tree persisted. **I stopped there rather than escalating to `SIGKILL` against a live terminal session** — the approval was given for what I described as one orphaned stack, and repeatedly killing a person's foreground processes is not a call to make unilaterally.

### Current service state (unchanged by me)

| Service | Status | PID | Uptime | Restarts | Health |
|---|---|---|---|---|---|
| `arciin-api` | online | 1047492 | 3h | **40** | `/api/health` → 200 |
| `arciin-web` | online | 1047483 | 3h | 1 | `:3002` → 307 (normal redirect) |
| `arciin-worker` | online | 1047532 | 3h | 1 | — |
| `arciin-mobile` | online | untouched | 4D | 0 | not touched |
| `arceclaw`, `arceclaw-tunnel` | online | untouched | 4D | 0 | not touched |

**Old BUILD_ID:** `uYBWBi-W3gIeLjn1m8BtG` (dev-written). **New BUILD_ID:** none — no build run. Backup at `reports/next-backup-20260804-195256.BUILD_ID`.

---

## 5. Automated tests

| Command | Exit | Files | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|---|
| `pnpm test` | **0** | 7 | **71** | 0 | 0 | 1.76s |
| `pnpm typecheck` | **0** | 9 projects | — | 0 errors | — | — |
| `pnpm lint` | **1** | — | — | **2 errors, 14 warnings** | — | — |
| `pnpm build` | not run | — | — | — | — | — |

**Lint failure is not from this work.** Both errors are React `setState`-in-effect violations in concurrent-work files I never touched:
- `apps/web/components/chat/chat-prompt-box.tsx` (untracked, new)
- `apps/web/components/libraries/video-asset-viewer.tsx`

Zero warnings originate in any file added or modified by this repair. I did not fix them — chat/AI and unrelated UI are explicitly out of scope. **They will fail `next build` unless fixed or `eslint.ignoreDuringBuilds` is set**, which is a second, independent blocker on Phase 7.

---

## 6. Integration tests

| Command | Exit | Files | Passed | Failed | Duration |
|---|---|---|---|---|---|
| `pnpm test:integration` | **0** | 3 | **30** | 0 | 6.63s |

**Isolation proven, not assumed** — `tests/integration/guard.test.ts` (9 cases) asserts the guard rejects the production database, any database not named `*test*`, Redis db 0, the production storage root, any root outside `/tmp`, and `NODE_ENV=production`; plus a case asserting the *live* suite environment is isolated.

Coverage (21 cases beyond the guard), all against real PostgreSQL:
- Soft-deleted assets excluded; assets in soft-deleted folders excluded from recursive views but still listed when the folder is opened directly.
- Nested assets discoverable; root-only genuinely narrower.
- An asset whose media type contradicts its library is **not** hidden.
- Count equals listing length; empty library returns 0.
- **Pagination across 1,001 rows** with many sharing an identical `createdAt` — no duplicates, no gaps; identical results at page sizes 17 and 200; search paged in the database across page boundaries.
- Lifecycle: media created `PROCESSING`/`completedAt=null`; documents created `READY`/`completedAt` set; promotion stamps `completedAt`; **exactly one completion event including under three genuinely concurrent calls**; CLASSIFIED recovery; failure marks session + asset FAILED and emits `upload.failed`; a late failure cannot overwrite a completed upload.
- Folder validation: valid, foreign-library, soft-deleted, missing.

---

## 7. End-to-end upload matrix

**Not run.** Blocked by §4. No table can be produced honestly.

---

## 8. Performance results

**Not measured.** With two workers of different code versions on one queue, any drain time would be an artefact. Configured values now in source:

| Setting | Before | After |
|---|---|---|
| Limiter | `{max: 4, duration: 60_000}` (≈2 uploads/min) | `{max: 8, duration: 1_000}` |
| Concurrency | 2 (default) | 2 (unchanged — 1.3 GB RAM available) |
| Attempts | 1 (BullMQ default) | 3, exponential backoff |
| `removeOnComplete` | none | `{count: 500, age: 7d}` |
| `removeOnFail` | none | `{count: 1000, age: 30d}` |

---

## 9. Existing-data repairs — dry run only

Fresh dry run: **`reports/dry-run-20260804-195551.txt`**. Nothing applied.

| Issue | Records | Auto-applicable | Needs review |
|---|---|---|---|
| UP-002 audio-only as VIDEO | **0** | 0 | 0 |
| UP-008-deleted in soft-deleted folders | 3 | 0 | 3 |
| UP-008-foreign cross-library folder | 0 | 0 | 0 |
| UP-MISROUTED type vs library | 2 | 0 | 2 |
| UP-001 stranded at CLASSIFIED | **1280** | **192** | **1088** |
| **Total** | **1285** | **192** | **1093** |

**Two findings changed materially since Batch 1 and are worth your attention:**

1. **UP-002 is now 0** (was 3). The three audio-only assets are no longer present as live VIDEO rows — consistent with the trash feature having removed them (the API log shows `Purged expired trash assets, removed: 5`). Confirmed independently: `SELECT count(*) … mediaType='VIDEO' AND filename ext IN ('m4a','aac')` → **0**. Nothing to repair; the *code* fix still prevents recurrence and is proven by tests.

2. **Only 192 of 1280 UP-001 sessions are eligible.** The tightened guard excludes 1088, chiefly `no asset attached` and `physical file missing on disk`. That is the guard working correctly — marking those READY would assert a completion that cannot be verified. **The high proportion of missing files deserves separate investigation** (likely trash purges leaving sessions behind) and is not something this repair should paper over.

Applied UP-001: **0**. Applied UP-002: **0**. Failed: **0**. Snapshot path: none written (nothing applied).

### Ambiguous records left for review

| Record ID | Issue | Current library | Folder status | Detected type | Options | Risk | Approval |
|---|---|---|---|---|---|---|---|
| `cmre83fzp0004tow3m6zhtbol` | UP-008-deleted | — | soft-deleted | — | restore folder / move to root / soft-delete asset | Medium — invisible to the user today | **Yes** |
| *(2 more)* | UP-008-deleted | — | soft-deleted | — | as above | Medium | **Yes** |
| `cmri7gacx000etod5xtacxbxu` | UP-MISROUTED | mismatched | at root | contradicts library | leave / move to matching library | Low — may be deliberate | **Yes** |
| *(1 more)* | UP-MISROUTED | mismatched | — | contradicts library | as above | Low | **Yes** |
| 1088 sessions | UP-001 | — | — | — | investigate missing files first | Medium | **Yes** |

---

## 10. Database integrity

| Metric | Batch 1 baseline | Now | Change |
|---|---|---|---|
| UploadSession READY | 592 | **594** | +2 (new uploads) |
| UploadSession CLASSIFIED | 1280 | **1280** | unchanged — none repaired |
| UploadSession FAILED | 16 | 16 | unchanged |
| Audio-only assets as VIDEO | 3 | **0** | −3 (removed by trash, not by me) |
| Assets in deleted folders | 3 | 3 | unchanged |
| Cross-library folder assets | 0 | 0 | unchanged |
| Media/library mismatches | 10 | 2 | −8 (trash removals) |

**No row was written by this task.** Migration status: up to date, 29 migrations.

---

## 11. Files changed

### From this task

**New (13):** `apps/api/src/services/libraries/asset-pagination.ts` · `visible-asset-query.ts` · `visible-assets.ts` · `apps/worker/src/services/upload-completion.ts` · `apps/web/components/libraries/library-scope-switch.tsx` · `load-more-assets.tsx` · `packages/shared/src/upload-lifecycle.ts` · `packages/config/src/job-options.ts` · `scripts/audit-and-repair-library-placement.ts` · `scripts/setup-test-db.sh` · `vitest.config.ts` · `vitest.integration.config.ts` · `tests/` (7 files: 4 unit + 3 integration)

**Modified:** `packages/shared/src/{media.ts,index.ts}` · `packages/config/src/index.ts` · `apps/api/src/services/classification/media-classification.ts` · `apps/api/src/modules/{uploads,libraries,assets}/routes.ts` · `apps/api/src/services/{serializers.ts,jobs/queues.ts}` · `apps/worker/src/{index.ts,processors/worker-handlers.ts,services/url-import.ts}` · `apps/web/hooks/{use-assets.ts,use-socket-events.ts}` · `apps/web/lib/stores/upload-store.ts` · `apps/web/lib/api/{assets.ts,query-keys.ts}` · `apps/web/components/libraries/{library-browser,folder-browser}.tsx` · 8 × library/folder `page.tsx` · `package.json` · `pnpm-lock.yaml` · 2 pre-existing `*.test.ts` (import line only)

### Pre-existing / concurrent (not mine, not reverted)

Trash feature (`apps/api/src/modules/trash/`, `services/assets/`, `components/settings/trash-panel.tsx`, settings nav), chat/AI (`chat-prompt-box.tsx`), library skeletons (`library-browser-skeleton.tsx`), `video-asset-viewer.tsx`, `discover-storage.ts`, `prisma/schema.prisma`, plus ~40 dashboard/toast files dirty before Batch 1.

**Conflict risk:** low. The only shared files are `apps/api/src/modules/assets/routes.ts` and `serializers.ts`, where upload-repair edits and trash edits touch different functions. Both sets are present and typecheck cleanly.

---

## 12. Database / schema changes

**No Prisma migration was added.** No schema change was required. `prisma/schema.prisma` is dirty from work predating this task. A new database `arciin_test` was created *for tests only*; production schema is untouched.

---

## 13. Remaining risks

1. **Two workers, two code versions, one queue** — the highest-severity live risk. Uploads processed right now may be handled by dev-stack workers running unreviewed code.
2. **Production `.next` was written by `next dev`.** The running web app is serving dev artifacts. A clean `pnpm build:web` is needed regardless of everything else.
3. **`pnpm lint` fails on two unrelated files** and will likely fail `next build`. Must be fixed by whoever owns that code, or `eslint.ignoreDuringBuilds` set, before Phase 7 can complete.
4. **`arciin-api` has 40 restarts.** It is currently up but has been flapping.
5. **1,088 upload sessions reference missing files or no asset.** Cause not established; needs its own investigation.
6. **None of the new code has run in production.** Confidence rests on 101 tests, not observed production behaviour.
7. Untouched from the audit: unscoped `GET /uploads` (UP-010), non-transactional upload route (UP-007), unscheduled temp cleanup (UP-006).

---

## 14. Final user-visible result

| Outcome | Status |
|---|---|
| Image uploads finish | **Not verified in production** — proven in integration tests |
| Video uploads finish | **Not verified in production** — proven in integration tests |
| M4A goes to Music | **Not verified in production** — proven against the real production file in Batch 1 and by unit tests |
| Failed uploads show Failed | **Not verified in production** — proven in integration tests |
| Sidebar counts match visible files | **Not verified in production** — proven in integration tests |
| Folder uploads validate correctly | **Not verified in production** — proven in integration tests |
| Bulk uploads at acceptable speed | **Not measured** — limiter fixed in source |
| Libraries >1,000 files navigable | **Not verified in production** — proven by a 1,001-row integration test |

**Every row says "not verified in production" because nothing has been deployed.** The code is ready and well covered; the deployment is not done.

---

## What I need from you

Deployment needs the dev stacks stopped from the terminal that owns them:

1. In the SSH session on `pts/0` running `npm run dev`, press `Ctrl-C` (there appear to be **three** such stacks — `998886`, `1046404`, `1048286`).
2. Tell me whether to fix, or bypass, the two unrelated lint errors that will block `next build`.

Then I can run: build → restart `arciin-api arciin-worker arciin-web` → verify → temporary API key → end-to-end matrix → `--apply --issue UP-001` (192 records, with snapshot) → post-repair verification.
