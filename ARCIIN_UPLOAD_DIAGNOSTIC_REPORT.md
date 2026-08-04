# Arciin Upload Classification and Reliability Audit

**Audit date:** 2026-08-04
**Repository:** `/srv/arce-projects/arciin`
**Branch / HEAD:** `main` @ `8f4d0ea`
**Auditor mode:** read-only diagnostic. No application code was modified, no commits were made, no services were restarted, no database rows were changed, no Redis keys or BullMQ jobs were removed.

---

## 1. Executive summary

The upload system **stores files reliably** — no data loss was found, and no asset in the database is missing its file on disk. But three of the four reported symptoms are reproduced and root-caused, and one of them has been broken continuously for roughly four weeks.

| Question | Answer |
|---|---|
| Is the upload system generally healthy? | **Storage layer: yes. Completion signalling: no.** Files land on disk and in the database correctly. The "upload finished" state machine is broken. |
| Is automatic classification reliable? | **Mostly, with two real misrouting classes.** Audio files with certain MP4 container brands are routed to Videos; TypeScript `.ts` files are routed to Videos. Production data contains 10 misrouted assets. |
| Are real-time UI updates reliable? | **No.** Since 2026-07-09, **zero** image/video uploads have ever reached `READY`. 1,278 upload sessions are permanently stuck at `CLASSIFIED`. |
| Confirmed defects | **11** |
| Likely defects | **6** |
| Unverified risks (POSSIBLE / NOT REPRODUCED) | **5** |
| Highest-severity issue | **UP-001** — dead completion condition in the worker means uploads never report finished. 100% of image/video uploads affected for ~4 weeks. |
| Is production data at risk? | **No data-loss risk found.** 0 assets have a missing file; 0 assets have a missing storage object. There is **disk leakage** (1.55 GB of orphaned temp files, 20.6 MB of orphaned storage objects) and an **information-disclosure** issue (UP-010), but nothing that destroys user data. |

**The single most important finding:** `apps/worker/src/processors/worker-handlers.ts:409` gates the "upload finished" transition on `upload.completedAt == null`, but `apps/api/src/modules/uploads/routes.ts:241` sets `completedAt` at *creation* time. The condition is therefore **always false**. The upload session is never promoted to `READY`, and the final `upload.completed` socket event is never emitted. The asset itself becomes visible and usable — but the upload queue, the uploads page, and the toast pipeline never learn that the work finished.

---

## 2. Overall completion status

```txt
AUDIT PARTIALLY COMPLETE
```

### What was tested

- Full static trace of the upload lifecycle across web, API, worker, and shared packages.
- Runtime/deployment consistency: PM2 working directories, run scripts, env-var parity across `arciin-api` / `arciin-web` / `arciin-worker`, build freshness, Prisma migration status.
- Log review: `logs/arciin-{api,web,worker}-{err,out}.log`.
- Read-only database inspection: 342 assets, 1,885 upload sessions, 3,898 job rows, library/folder/storage-object integrity, orphan and misrouting counts.
- Redis / BullMQ inspection: queue depths, retained job sets, failure reasons, queue meta.
- Storage filesystem inspection: object/thumbnail/temp counts, permissions, capacity, inodes, mount options, zero-byte scan.
- **44-fixture classification matrix** executed against the real production classification chain (`file-type` magic detection + `inferMediaType` + `libraryKindForMediaType`), across three client-MIME scenarios each (browser MIME / `application/octet-stream` / empty).
- Direct forensic probe of a production object that was misclassified, cross-checked with `ffprobe`.
- `pnpm typecheck` and `pnpm lint`.

### What was NOT tested, and why

| Not tested | Reason |
|---|---|
| **End-to-end HTTP uploads through the live API** (Phase 7 §"HTTP status / API response / socket event emitted" columns, all of Phase 8) | No credentials were available. Uploading requires a session cookie or an API key; API keys are stored hashed and cannot be recovered, and creating one would be a production mutation outside read-only scope. **Classification was instead verified against the production code path offline, which is stronger evidence than a black-box HTTP test for the classification question — but it cannot exercise race conditions, concurrency, or socket delivery.** |
| Phase 8 race/concurrency scenarios (10 simultaneous uploads, network interruption, mid-upload refresh, socket disconnect, worker unavailable) | Requires live authenticated uploads (above) and, for several scenarios, stopping production services. Race conditions below are therefore reported as **code-confirmed / LIKELY**, not reproduced. |
| Mobile upload path | `arciin-mobile` runs from a **separate repository** at `/srv/arce-projects/arciin-app` (PM2 id 5, `exec cwd /srv/arce-projects/arciin-app`, HEAD `5587d1c` 2026-07-15). Out of the audited repo. A light inspection is included in §13. |
| Automated test suite | **There is none.** No `test` script, no vitest/jest/playwright dependency. Two orphaned `*.test.ts` files exist with no runner. See §17. |
| `pnpm build` | Not run. A full Next.js build would rewrite `apps/web/.next`, which is the artifact the live `arciin-web` process serves. That is a production mutation. `pnpm typecheck` (which covers all 9 tsconfig projects) was run instead and passed. |
| `.heic`, `.avi`, `.wmv`, `.flv`, `.aac`, `.flac`, `.ogg`, `.opus`, `.7z`, `.rar`, `.doc`, `.xls`, `.ppt`, `.odt`, `.epub` fixtures | No encoder/sample available on the host to generate valid files. Their behaviour is inferred from the static tables in `packages/shared/src/media.ts` and marked as such in §6. |

---

## 3. Architecture and upload flow

### 3.1 Runtime topology

```txt
Browser (apps/web, Next 16, port 3002)
  └── XHR POST {origin}/api/uploads?targetLibraryId&targetFolderId
        └── Next rewrite → ARCIIN_API_URL (http://127.0.0.1:4000)
              └── Fastify API (apps/api, tsx from source, port 4000)
                    ├── PostgreSQL (localhost:5432, db "arciin")
                    ├── Redis (localhost:6379)  ──pub/sub──┐
                    └── /srv/arciin-storage/arciin         │
                                                            │
Worker (apps/worker, tsx from source) ──BullMQ over Redis───┤
                                                            │
Socket.IO server (attached to the Fastify server) ◄─────────┘
  └── rooms: user:{id}, instance:{id}   (library:/upload:/job: are emitted to but never joined)
```

### 3.2 Stage-by-stage source map

| # | Stage | File / function |
|---|---|---|
| 1 | Global drag-and-drop | `apps/web/hooks/use-global-dropzone.ts`, `apps/web/components/uploads/global-dropzone-provider.tsx` |
| 2 | Drop collection | `apps/web/lib/uploads/collect-drop-files.ts`, `skip-upload-path.ts` |
| 3 | Overlay / queue UI | `apps/web/components/uploads/upload-overlay.tsx`, `upload-queue.tsx`, `upload-queue-item.tsx` |
| 4 | Queue state (Zustand) | `apps/web/lib/stores/upload-store.ts` → `addOrUpdate`, `updateProgress`, `updateStatus`, `recordBatchTerminal` |
| 5 | Orchestration | `apps/web/hooks/use-upload-orchestrator.ts:38` → `uploadConcurrency()` (4 / 3 / 2 / 1 by file count) |
| 6 | Folder-tree preparation | `apps/web/lib/uploads/ensure-upload-folder-tree.ts` → `prepareUploadTargets` |
| 7 | Client-side target resolution | `apps/web/lib/uploads/resolve-upload-target.ts:19` → `resolveUploadTargetForFile` |
| 8 | Client-side classification (display only) | `apps/web/lib/utils/media-type.ts` → `classifyMediaType`, `mediaTypeToLibraryKind`, `inferDestinationLabel` |
| 9 | HTTP transport + retry | `apps/web/lib/api/uploads.ts:157` → `uploadFile` (5 attempts), `:53` → `uploadFileOnce` (XHR) |
| 10 | Multipart plugin | `apps/api/src/plugins/multipart.ts` (`fileSize` ceiling 1 TiB) |
| 11 | Route entry, authz | `apps/api/src/modules/uploads/routes.ts:73` — `requireSessionRolesOrApiKeyScopes(["OWNER","ADMIN","MEMBER"], ["uploads:create"])` |
| 12 | Rate limit | `routes.ts:96` → `getUploadLimits()`, `checkEndpointRateLimit` (`upload:user:{id}`, 500/min default) |
| 13 | Temp write + hash + size cap | `apps/api/src/services/storage/local-storage.ts:44` → `writeMultipartToTemp` |
| 14 | **Server-side classification** | `apps/api/src/services/classification/media-classification.ts:60` → `analyzeStoredFile` → `fileTypeFromFile` (magic bytes) → `inferMediaType` |
| 15 | Classification table | `packages/shared/src/media.ts:248` → `inferMediaType` |
| 16 | Library routing | `routes.ts:34` → `libraryKindForMediaType`; `routes.ts:53` → `resolveUploadTargetLibrary` |
| 17 | Folder resolution | `apps/api/src/services/integrations/plex.ts` → `resolveUploadFolderId` → `library-media-connector.ts` → `resolveMediaConnectorUploadFolderId` (pass-through, **no validation**) |
| 18 | Content dedupe | `routes.ts:160` — `storageObject.findFirst({checksumSha256, storageLocationId})` |
| 19 | Permanent storage | `local-storage.ts:90` → `createObjectStoragePath` (`objects/<aa>/<bb>/<sha256>.<ext>`); `:114` → `moveTempToObject` |
| 20 | Asset record | `routes.ts:208` — `prisma.asset.create`, `status = PROCESSING` for VIDEO/IMAGE/AUDIO else `READY` |
| 21 | Upload session record | `routes.ts:230` — `prisma.uploadSession.create`, **`completedAt: new Date()`** |
| 22 | Job rows + enqueue | `routes.ts:249` (`extract_metadata`), `apps/api/src/services/media/thumbnail-jobs.ts:13` → `enqueueGenerateThumbnailJob` |
| 23 | Queues | `apps/api/src/services/jobs/queues.ts` → `mediaQueue`, `storageQueue`, `integrationsQueue` |
| 24 | Worker bootstrap | `apps/worker/src/index.ts:49` — media worker, `concurrency: ARCIIN_WORKER_CONCURRENCY`, `limiter { max: concurrency*2, duration: 60_000 }` |
| 25 | Metadata extraction | `apps/worker/src/processors/worker-handlers.ts:312` — `detectMetadata` (file-type + sharp + ffprobe), re-runs `inferMediaType` |
| 26 | Thumbnail generation | `worker-handlers.ts:188` → `generateThumbnail` (sharp for images, ffmpeg for video with SVG placeholder fallback, ffmpeg for PDF) |
| 27 | Completion transition | `worker-handlers.ts:408` → `uploadNotYetAnnounced` — **dead condition, see UP-001** |
| 28 | Realtime publish (API) | `apps/api/src/services/events/publish-event.ts` → Redis `SOCKET_EVENT_CHANNEL` |
| 29 | Realtime fan-out | `apps/api/src/plugins/socket.ts` → `emitRealtimeEvent` (rooms `user:`, `library:`, `upload:`, `job:`, `instance:`) |
| 30 | Client socket handling | `apps/web/hooks/use-socket-events.ts:64` → `handleRealtimeEvent` |
| 31 | Cache invalidation | `apps/web/lib/realtime/refresh-library-queries.ts`, `apps/web/lib/api/query-keys.ts` |
| 32 | Library rendering | `apps/web/components/libraries/library-browser.tsx`, `apps/web/hooks/use-assets.ts` |

### 3.3 Database models in the path

`InstanceConfig` → `StorageLocation` → `Library` → `Folder` → `Asset` → `StorageObject`; plus `UploadSession`, `Job`, `ActivityEvent`.

### 3.4 Socket.IO events in the path

Emitted by the API on a successful upload, in this order, **all before the HTTP 201 is sent**:
`upload.started` (progress 88 or 100) → `asset.created` → `upload.completed` (progress 88 or 100).
Emitted by the worker: `asset.classified`, `thumbnail.created`, and — *in theory* — a second `upload.completed` at progress 100, which UP-001 prevents.

### 3.5 Job types

`extract_metadata`, `generate_thumbnail`, `import_url`, `analyze_file` on the `media` queue; `cleanup_temp_files`, `calculate_storage_usage`, `migrate_storage`, `stage_update`, `apply_update` on `storage`; `plex_sync_placeholder` on `integrations`.

---

## 4. Confirmed defects

---

### UP-001 — Upload sessions never reach READY; the completion event is never sent

```txt
Issue ID:            UP-001
Title:               Dead `completedAt == null` guard means image/video uploads never announce completion
Severity:            Critical
Confidence:          Confirmed
Affected component:  Worker (media job) + API (upload route)
Affected file paths: apps/worker/src/processors/worker-handlers.ts
                     apps/api/src/modules/uploads/routes.ts
Affected functions:  handleMediaJob (generate_thumbnail branch); registerUploadRoutes (POST /uploads)
Environment:         Production, /srv/arce-projects/arciin, PM2 arciin-api + arciin-worker
```

**Preconditions:** any upload whose detected media type is `IMAGE` or `VIDEO` (i.e. `requiresProcessing === true` and not `AUDIO`).

**Exact reproduction steps:**
1. Upload any `.jpg` or `.mp4` through the web UI.
2. Observe the upload queue item settle on "Processing".
3. Query: `SELECT status, progress FROM "UploadSession" ORDER BY "createdAt" DESC LIMIT 1;`

**Expected result:** the session advances `PROCESSING → CLASSIFIED → READY`; a final `upload.completed` socket event at progress 100 flips the queue item to "Ready".

**Actual result:** the session stops at `CLASSIFIED`. No second `upload.completed` is ever emitted. The queue item stays "Processing" indefinitely.

**Frequency:** 100% of image/video uploads, continuously since 2026-07-09.

**Evidence — the code:**

`apps/api/src/modules/uploads/routes.ts:230-246` creates the session with `completedAt` already populated:

```ts
const upload = await fastify.prisma.uploadSession.create({
  data: {
    ...
    status: requiresProcessing ? "PROCESSING" : "READY",
    progress: 100,
    completedAt: new Date(),        // ← set at creation
  },
```

`apps/worker/src/processors/worker-handlers.ts:407-411` then gates the promotion on that same field being null:

```ts
/** PDFs are often READY before thumbnail jobs run — do not re-emit upload.completed (Sonner spam). */
const uploadNotYetAnnounced =
  upload && upload.status !== "READY" && upload.completedAt == null   // ← always false

if (uploadNotYetAnnounced) {
  // set READY + emit upload.completed  ← unreachable
}
```

**Database evidence:**

```txt
   status   |  n   | with_completedAt
------------+------+------------------
 READY      |  591 |              591
 CLASSIFIED | 1278 |             1278
 FAILED     |   16 |                0
```

Every one of the 1,278 stuck sessions has `completedAt` set — exactly the population the guard excludes. And every stuck session is `IMAGE` (1,201) or `VIDEO` (77), exactly the `requiresProcessing && !AUDIO` set:

```txt
   status   | detectedMediaType | count
------------+-------------------+-------
 CLASSIFIED | IMAGE             |  1201
 CLASSIFIED | VIDEO             |    77
 READY      | IMAGE             |   522     ← all pre-regression
 READY      | VIDEO             |    48     ← all pre-regression
 READY      | DOCUMENT          |    14
 READY      | AUDIO             |     5
```

**Regression date, from the data:**

```txt
    day     | ready | classified
------------+-------+------------
 2026-07-07 |   356 |          1
 2026-07-08 |    26 |         37     ← flip
 2026-07-09 |     0 |         17
 ...        |   ... |        ...
 2026-08-01 |     0 |          2
```

Since 2026-07-09 the READY column is **zero on every single day**.

**Queue evidence:** the jobs themselves succeed — `bull:media:completed` holds 3,875 entries and the `Job` table shows 1,885 `extract_metadata` and 1,888 `generate_thumbnail` rows, all `COMPLETED`, with **zero** failures. The work is done; only the announcement is lost.

**Likely root cause:** the `completedAt` write in the API route and the `completedAt == null` guard in the worker were introduced independently. The guard's comment ("PDFs are often READY before thumbnail jobs run") shows the intent was to suppress a duplicate Sonner toast for documents; `status !== "READY"` alone already achieved that, and the added `completedAt == null` clause silently disabled the whole branch for media.

**Why this conclusion is supported:** the guard is the only code path that promotes a session out of `CLASSIFIED`; the population of stuck rows matches the guard's exclusion set exactly (1,278/1,278 have `completedAt`, 100% are IMAGE/VIDEO); and the flip date in the data is a step function, not a gradual drift.

**User impact:** the upload queue never clears. Users see "Processing" forever and reasonably conclude the upload failed or hung — the reported "remain stuck processing" symptom. The asset *is* fine and visible; only the status is wrong. The uploads page (`/uploads`) shows a permanently growing list of never-finished uploads.

**Data-loss risk:** none. The asset row, the storage object, and the physical file are all correct.

**Recommended fix direction:** drop `&& upload.completedAt == null` from the guard and rely on `upload.status !== "READY"`, which already prevents the duplicate-toast case the comment describes. Alternatively stop writing `completedAt` at creation for `requiresProcessing` uploads and let the worker own that field — but that is the larger change and would need a backfill for the 1,278 existing rows.

**Recommended regression test:** integration test — POST a small PNG, drain the media queue, assert `UploadSession.status === "READY"` and that exactly two `upload.completed` events were published (one from the API at progress 88, one from the worker at 100).

---

### UP-002 — Audio files in MP4 containers are classified as VIDEO and routed away from Music

```txt
Issue ID:            UP-002
Title:               `file-type` reports video/mp4 for audio-only MP4 containers; classification never consults ffprobe's stream list
Severity:            High
Confidence:          Confirmed
Affected component:  API classification
Affected file paths: apps/api/src/services/classification/media-classification.ts
                     packages/shared/src/media.ts
                     apps/api/src/modules/uploads/routes.ts
Affected functions:  analyzeStoredFile (:60-107); inferMediaType (:248); libraryKindForMediaType (:34)
Environment:         Production
```

**Preconditions:** an `.m4a` / `.aac` / audio-only MP4 whose `ftyp` brand is one `file-type` maps to `video/mp4` (observed: brand `dash`).

**Exact reproduction steps:**
1. Upload an audio-only `.m4a` whose ftyp brand is `dash`.
2. Observe it lands in Videos (or wherever the UI context points), not Music.

**Expected result:** `mediaType = AUDIO`, routed to the Music library, `extension = m4a`, `mimeType = audio/…`.

**Actual result:** `mediaType = VIDEO`, `extension = mp4`, `mimeType = video/mp4`, routed to a video library. A video-placeholder thumbnail is generated for a file with no video track.

**Frequency:** every upload of an affected container. 3 such assets exist in production.

**Evidence — production data:**

```txt
            id             |  library  | mediaType | extension | mimeType  | durationSeconds | width | height | codec
---------------------------+-----------+-----------+-----------+-----------+-----------------+-------+--------+-------
 cms5dtoyv000etofpyzvbud6d | images    | VIDEO     | mp4       | video/mp4 |      382.873832 |       |        |
 cms5dvm0k000wtofp7xa9fxln | music     | VIDEO     | mp4       | video/mp4 |      382.873832 |       |        |
 cms5dwswd0014tofpt3x4n17z | documents | VIDEO     | mp4       | video/mp4 |      382.873832 |       |        |
```

All three have `originalFilename` ending `.m4a`, and **`width`/`height` are NULL** — proof there is no video stream.

**Evidence — forensic probe of the physical object:**

```txt
$ ffprobe /srv/arciin-storage/arciin/objects/50/fd/50fd8d49…33.mp4
format:   mov,mp4,m4a,3gp,3g2,mj2   duration: 382.873832
  stream: audio  aac                       ← the ONLY stream

$ head -c 16 <object> | xxd
00000000: 0000 0018 6674 7970 6461 7368  ....ftypdash    ← brand "dash"

file-type magic verdict:                     video/mp4  (.mp4)
inferMediaType("video/mp4", "song.m4a")   →  VIDEO      ← wrong
inferMediaType("audio/x-m4a", "song.m4a") →  AUDIO      ← what the filename alone would give
```

**Likely root cause:** `analyzeStoredFile` computes `mediaType` at line 68 from the magic-byte MIME alone. It *does* run `ffprobe` immediately afterwards (line 90) for VIDEO/AUDIO — but only harvests `duration`, `width`, `height`, `codec`. It never asks "did ffprobe find a video stream?", even though the answer is sitting in the same JSON. `inferMediaType` checks `mimeType.startsWith("video/")` first (media.ts:251), so the container MIME wins over the `.m4a` extension unconditionally.

**Why this conclusion is supported:** the exact production object was probed; ffprobe reports one audio stream and no video stream; `file-type` returns `video/mp4` for it; and feeding that MIME to the production `inferMediaType` returns `VIDEO`. The full chain is reproduced.

**User impact:** music is filed under Videos. It plays (audio elements handle mp4/aac), but it is in the wrong library, carries a fake video thumbnail, and is invisible to anyone browsing Music.

**Data-loss risk:** none — misfiling only.

**Recommended fix direction:** in `analyzeStoredFile`, when the magic MIME is `video/*` **and** the container is an MP4/MOV family, run `ffprobe` *before* deciding, and downgrade to `AUDIO` when the stream list contains an audio stream and no video stream. This also fixes the extension and MIME stored on the asset.

**Recommended regression test:** unit test over a fixture set of ftyp brands (`M4A `, `mp42`, `isom`, `dash`) asserting that an audio-only track yields `AUDIO` regardless of brand.

---

### UP-003 — TypeScript `.ts` source files are uploaded into the Videos library

```txt
Issue ID:            UP-003
Title:               Browsers send `video/mp2t` for .ts; classification trusts it and routes source code to Videos
Severity:            Medium
Confidence:          Confirmed
Affected component:  API classification
Affected file paths: packages/shared/src/media.ts:251
                     apps/api/src/services/classification/media-classification.ts:66-68
Affected functions:  inferMediaType, analyzeStoredFile
Environment:         Production
```

**Preconditions:** a `.ts` file uploaded from a browser (Chrome, Firefox, and Safari all map `.ts` → `video/mp2t` from the OS MIME database). `file-type` cannot detect plain text, so the client MIME is used verbatim.

**Exact reproduction steps:** drag any `.ts` source file onto the app from a browser.

**Expected result:** `CODE` → Inbox (which is what `codeExtensions` in `media.ts:79` intends — `ts` is listed there).

**Actual result:** `VIDEO` → Videos library, with a video-placeholder thumbnail. Uploading the identical file via `curl` (which sends `application/octet-stream`) gives `CODE` → Inbox.

**Evidence — classification matrix, run against the production chain:**

```txt
fixture  | client_mime  | magic_mime | final_mime  | ext | mediaType | lib(browser) | lib(octet) | lib(empty) | flag
---------+--------------+------------+-------------+-----+-----------+--------------+------------+------------+---------
real.ts  | video/mp2t   | -          | video/mp2t  | ts  | VIDEO     | VIDEO        | INBOX      | INBOX      | DIVERGES
```

This was the **only** fixture out of 44 that produced a different destination library depending on the client-supplied MIME — but it is a decisive one for a self-hosted developer tool.

**Likely root cause:** `inferMediaType` checks `mimeType?.startsWith("video/")` (media.ts:251) before it ever consults `codeExtensions` (media.ts:297). A client-supplied MIME is trusted for the media-type decision with no corroboration from content.

**Why this conclusion is supported:** reproduced directly against `inferMediaType` with the exact MIME string browsers send; the divergence between the browser and API paths for the same bytes is demonstrated in the matrix above.

**User impact:** source files silently land in Videos. Combined with UP-001 they also sit at "Processing" while ffmpeg fails on them.

**Data-loss risk:** none.

**Recommended fix direction:** when `file-type` returns nothing (text file) and the extension is in `codeExtensions`, prefer the extension over the client MIME. More generally: only trust a client MIME for the media-type decision when magic-byte detection failed *and* the extension does not contradict it.

**Recommended regression test:** table test asserting `inferMediaType("video/mp2t", "index.ts") === "CODE"`.

---

### UP-004 — Office documents are stored with `mimeType: application/zip` and `extension: zip`

```txt
Issue ID:            UP-004
Title:               OOXML files (.docx/.xlsx/.pptx) get their MIME and extension overwritten with zip
Severity:            Medium
Confidence:          Confirmed (reproduced with generated fixtures; see caveat)
Affected component:  API classification
Affected file paths: apps/api/src/services/classification/media-classification.ts:66-67
                     apps/api/src/modules/uploads/routes.ts:172, :214-218
Affected functions:  analyzeStoredFile, registerUploadRoutes
Environment:         Production
```

**Preconditions:** upload of a `.docx`, `.xlsx`, or `.pptx`.

**Expected result:** `mimeType = application/vnd.openxmlformats-…`, `extension = docx`, stored object key `…/<sha>.docx`.

**Actual result:** `mimeType = application/zip`, `extension = zip`, object stored as `<sha>.zip`, `Asset.filename = <sha>.zip`. The `mediaType` is still correctly `DOCUMENT` (rescued by `documentExtensions` matching the *original filename*), so routing is right — but the stored metadata is wrong.

**Evidence:**

```txt
fixture     | magic:                        | mediaType | stored_ext
real.docx   | application/zip (.zip)        | DOCUMENT  | zip
real2.docx  | application/zip (.zip)        | DOCUMENT  | zip     ← realistic entry ordering
real.xlsx   | application/zip (.zip)        | DOCUMENT  | zip
real.pptx   | application/zip (.zip)        | DOCUMENT  | zip
```

Related production evidence — **189 of 342 assets (55%) have a stored extension that disagrees with their filename extension**. Most of those are benign and correct (a PNG named `.jpg` — content wins, as designed). The OOXML case is the harmful subset.

**Caveat on confidence:** this was reproduced with programmatically generated OOXML fixtures, including one with realistic zip entry ordering. `file-type` does ship OOXML detection that depends on the position of the `word/` entry, so a file authored by Microsoft Word may be detected correctly. There are currently **no** `.docx`/`.xlsx`/`.pptx` assets in the production database to cross-check against. Treat the *mechanism* as confirmed and the *real-world hit rate* as unverified.

**Likely root cause:** `analyzeStoredFile:66-67` takes `detected.mime` and `detected.ext` unconditionally when magic detection succeeds, with no reconciliation against the original filename when the detected type is a generic container (`application/zip`).

**User impact:** downloads are served with `Content-Type: application/zip` (`resolveInlineContentType` at media.ts:232 returns the stored MIME because it is not `application/octet-stream`), so browsers may offer to save a `.zip`. Extension-based filters and previews miss the file.

**Data-loss risk:** none — the bytes are intact.

**Recommended fix direction:** when the detected MIME is a generic container (`application/zip`, `application/x-cfb`) and the original filename's extension maps to a known specific type, prefer the filename-derived MIME and extension.

**Recommended regression test:** assert that a real `.docx` round-trips with `extension === "docx"` and an OOXML MIME.

---

### UP-005 — Worker media queue is rate-limited to 4 jobs per minute by default

```txt
Issue ID:            UP-005
Title:               BullMQ limiter of concurrency×2 per 60s throttles the media queue to ~2 uploads/minute
Severity:            High
Confidence:          Confirmed (configuration confirmed; user-visible backlog NOT REPRODUCED)
Affected component:  Worker
Affected file paths: apps/worker/src/index.ts:63-69
                     packages/config/src/env.ts (workerEnvSchema, ARCIIN_WORKER_CONCURRENCY)
Affected functions:  start() — mediaWorker construction
Environment:         Production
```

**Preconditions:** `ARCIIN_WORKER_CONCURRENCY` unset (it is — verified absent from `.env` and from the PM2 environment of all three services), so it defaults to `2`.

**The configuration:**

```ts
// apps/worker/src/index.ts:63-69
{
  connection,
  concurrency: workerConfig.ARCIIN_WORKER_CONCURRENCY,               // = 2
  limiter: { max: workerConfig.ARCIIN_WORKER_CONCURRENCY * 2,        // = 4
             duration: 60_000 },                                     // per MINUTE
}
```

**Expected result:** a burst of uploads is processed at whatever rate the CPU sustains.

**Actual result:** the media queue admits at most **4 jobs per minute, instance-wide**. Every image/video upload creates **two** media jobs (`extract_metadata` + `generate_thumbnail`), so the ceiling is **2 media uploads per minute**. The `import_url` job type shares this queue, so a link-import batch starves uploads entirely.

**Arithmetic:** dropping 20 photos creates 40 jobs → **10 minutes** to drain. The frontend meanwhile uploads at concurrency 3–4 (`use-upload-orchestrator.ts:23-28`), so the HTTP side finishes in seconds and the backlog is invisible until the user notices nothing ever finishes.

**Evidence:**

```txt
ARCIIN_WORKER_CONCURRENCY:
  .env:            MISSING  → schema default 2
  pm2 arciin-api:  MISSING
  pm2 arciin-worker: MISSING
  pm2 arciin-web:  MISSING

bull:media  wait=0  active=0  delayed=0  completed=3875  failed=23
```

**Why this is CONFIRMED as a configuration defect but NOT REPRODUCED as a symptom:** the queue is currently drained (0 waiting, 0 active) because the instance is idle. The throttle is real and provable from the code and the confirmed-default env value, but no live burst test was run (no upload credentials). The 60-second window is almost certainly a units error — `duration` in BullMQ is milliseconds, and `max: 4` per 60,000 ms is a far harsher limit than "bound heavy media work" (the stated intent in the comment) requires.

**User impact:** during any bulk upload, files sit at "Processing" for many minutes. Compounded by UP-001 — which means they never leave "Processing" *at all* — this is the most likely everyday experience of the reported symptom.

**Data-loss risk:** none; jobs queue rather than drop.

**Recommended fix direction:** either remove the limiter (concurrency alone already bounds CPU) or widen it substantially (e.g. `{ max: concurrency * 4, duration: 1_000 }`). Consider a separate queue for `import_url` so link imports cannot starve uploads.

**Recommended regression test:** enqueue 40 media jobs and assert the queue drains in under N seconds.

---

### UP-006 — Orphaned temp files are never cleaned up; the cleanup job is never scheduled

```txt
Issue ID:            UP-006
Title:               cleanup_temp_files and calculate_storage_usage handlers exist but nothing ever enqueues them
Severity:            Medium
Confidence:          Confirmed
Affected component:  Worker / storage
Affected file paths: apps/worker/src/processors/worker-handlers.ts:516 (handler), :546 (handler)
                     apps/api/src/services/storage/local-storage.ts:114 (moveTempToObject)
Environment:         Production
```

**Evidence — the handlers have no callers:**

```txt
$ grep -rn "cleanupTempFiles|cleanup_temp_files|calculateStorageUsage" --include=*.ts apps packages
apps/worker/src/processors/worker-handlers.ts:516    if (name === JOB_TYPES.cleanupTempFiles) {      ← handler
apps/worker/src/processors/worker-handlers.ts:546    if (name === JOB_TYPES.calculateStorageUsage) { ← handler
apps/web/lib/jobs/job-queue-display.ts:27              case "cleanup_temp_files":                    ← label only
packages/config/src/constants.ts:54                    cleanupTempFiles: "cleanup_temp_files",       ← constant only
```

No `queue.add`, no repeatable job, no cron. Corroborated by Redis: the storage queue has **completed=0** — it has never run a single job.

**Evidence — the leak:**

```txt
$ ls -la /srv/arciin-storage/arciin/temp
-rw-r--r-- 1 arce arce 672436568 Jul  8 02:51 1783479008163-db0cc1e3af8bf8.mp4
-rw-r--r-- 1 arce arce 880236955 Jul  8 02:53 1783479097815-1b3bfc8e472e9.mp4
                       ↑ 1.55 GB total, 27 days old
```

Disk headroom is 29 GB (69% used), so this is not urgent — but it is unbounded.

**Second leak path:** `moveTempToObject` (`local-storage.ts:119-125`) returns early when the destination already exists **without deleting the temp file**:

```ts
try {
  await access(destinationPath)
  return destinationPath          // ← tempPath is never unlinked
} catch {
  await rename(tempPath, destinationPath)
```

This fires whenever the physical object exists but no `StorageObject` row matched (e.g. after a failed upload left the file behind, or when two identical uploads race).

**Third leak path (orphaned storage objects):**

```txt
orphan_storage_objects | orphan_bytes
                    30 |     20582239   ← 20.6 MB, no Asset references them
```

These are the residue of uploads that stored the object and then failed before or during `asset.create` — see UP-007.

**User impact:** slow disk consumption; the storage-usage figure shown in Settings counts leaked bytes.

**Data-loss risk:** none (leakage, not loss).

**Recommended fix direction:** register a repeatable `cleanup_temp_files` job on the storage queue at worker boot; add the missing `removeTempFile` to the early-return branch of `moveTempToObject`; add an orphan-storage-object reaper.

**Recommended regression test:** assert the repeatable job is registered at boot; unit-test that `moveTempToObject` removes the temp file on the destination-exists path.

---

### UP-007 — No transaction and no rollback: a failure after the file is stored returns HTTP 500 while the asset persists

```txt
Issue ID:            UP-007
Title:               POST /uploads performs 6+ sequential writes with no transaction; the catch block only deletes the temp file
Severity:            High
Confidence:          Confirmed (code); orphan residue observed in production
Affected component:  API
Affected file paths: apps/api/src/modules/uploads/routes.ts:131-428
Affected functions:  registerUploadRoutes (POST /uploads)
Environment:         Production
```

**The write sequence, all outside a transaction:** temp write → `storageObject.create` → file move → `asset.create` → `uploadSession.create` → `job.create` → `mediaQueue.add` → thumbnail job → connector mirror → activity → 3 socket publishes → `reply.status(201)`.

**The failure handling** (`routes.ts:393-427`):

```ts
} catch (err) {
  if (tempPath) {
    await removeTempFile(tempPath).catch(() => {})   // ← ONLY the temp file
  }
  ...
  const status = err instanceof UploadTooLargeError ? 413 : 500
  reply.status(status).send({ error: { code, message } })
}
```

Nothing rolls back the storage object, the moved file, the asset, the session, or the job row.

**Concrete failure modes:**

| Failing step | Client sees | Server state |
|---|---|---|
| `mediaQueue.add` throws (Redis blip) | HTTP 500 "upload failed" | Asset **exists and is visible**, `status = PROCESSING` forever — no job will ever run it |
| `asset.create` throws (bad `targetFolderId` → FK violation, see UP-008) | HTTP 500 | Orphan `StorageObject` + orphan file on disk |
| Concurrent identical uploads | one gets HTTP 500 | duplicate-key race, see UP-009 |

**Evidence:** 30 orphaned `StorageObject` rows / 20.6 MB with no referencing asset — the exact residue this pattern produces. And the API error log shows Redis was unreachable on 2026-07-28 and 2026-07-31 (`[ioredis] Unhandled error event: connect ECONNREFUSED 127.0.0.1:6379`), which is precisely the window in which `mediaQueue.add` would throw after the asset was committed.

**A note on the response contract:** conversely, the API returns **HTTP 201 success** even when the file was classified into the wrong library (UP-002/003), when the connector mirror failed (swallowed at `routes.ts:314-319`, logged at `warn`, never surfaced), and — because the response is sent before any worker runs — when processing will later fail. The 201 means "bytes are on disk and a row exists", not "the upload is complete and correct".

**User impact:** users are told an upload failed when it actually succeeded, and re-upload — producing the duplicates seen in UP-009.

**Data-loss risk:** none. The failure mode is *extra* data, not lost data.

**Recommended fix direction:** wrap `storageObject.create` + `asset.create` + `uploadSession.create` + `job.create` in `prisma.$transaction`, and move the queue `add` after commit with a compensating cleanup (or an outbox row the worker polls). At minimum, delete the storage object and moved file in the catch block when they were created in this request.

**Recommended regression test:** inject a `mediaQueue.add` failure and assert no `Asset` row survives.

---

### UP-008 — `targetFolderId` is passed straight to the database with no validation

```txt
Issue ID:            UP-008
Title:               resolveUploadFolderId never checks the folder exists, belongs to the target library, or is not deleted
Severity:            Medium
Confidence:          Confirmed (code); 3 affected assets in production
Affected component:  API
Affected file paths: apps/api/src/services/integrations/library-media-connector.ts (resolveMediaConnectorUploadFolderId)
                     apps/api/src/services/integrations/plex.ts (resolveUploadFolderId)
                     apps/api/src/modules/uploads/routes.ts:192-197
Environment:         Production
```

**The code:**

```ts
export async function resolveMediaConnectorUploadFolderId(
  _prisma: PrismaClient,
  _libraryId: string,        // ← accepted and ignored
  _librarySlug: string,      // ← accepted and ignored
  explicitFolderId: string | undefined,
): Promise<string | null | undefined> {
  if (explicitFolderId) return explicitFolderId   // ← no lookup, no validation
  return null
}
```

The route's Zod schema (`routes.ts:112`) validates only that `targetFolderId` is a cuid.

**Consequences:**
1. A folder id belonging to a *different* library → asset gets `libraryId = A` with `folderId` in library B. Library A's root view (`rootOnly: true` → `folderId IS NULL`) excludes it; library B's folder view shows it under the wrong library. Currently **0** such rows exist in production, so this one is NOT REPRODUCED in data.
2. A **soft-deleted** folder → the asset is invisible in both views. **3 such assets exist in production** (`assets_in_deleted_folders = 3`). This is a direct instance of the reported "files do not appear in the user interface".
3. A **non-existent** folder id → FK violation on `asset.create` → HTTP 500 with the file already stored (feeds UP-007's orphan count).

**Also note:** `UploadSession.targetFolderId` exists in the schema but the route never populates it — **0 of 1,885** sessions have it set. The uploads page cannot show a folder destination.

**Recommended fix direction:** look the folder up with `findFirst({ id, libraryId: targetLibrary.id, deletedAt: null })` and return 400/404 when it does not resolve. Populate `UploadSession.targetFolderId`.

**Recommended regression test:** POST with a folder id from another library and assert 400; POST with a soft-deleted folder id and assert 400.

---

### UP-009 — Concurrent identical uploads race on the unique `objectKey`; client retries are not idempotent

```txt
Issue ID:            UP-009
Title:               Check-then-create on StorageObject plus a 5-attempt non-idempotent client retry produces 500s and duplicate assets
Severity:            Medium
Confidence:          High confidence (code); duplicate residue observed in production
Affected component:  API + web client
Affected file paths: apps/api/src/modules/uploads/routes.ts:160-190
                     apps/web/lib/api/uploads.ts:157-174
                     prisma/schema.prisma:383 (objectKey @unique)
Environment:         Production
```

**Race A — duplicate-key 500.** `routes.ts:160` does `findFirst({checksumSha256, storageLocationId})`, and on a miss creates a `StorageObject` whose `objectKey` is derived purely from the checksum. `objectKey` is `@unique`. Two simultaneous uploads of the same bytes both miss the lookup, both attempt the create, and the loser hits a P2002 unique violation → HTTP 500 → and since the client only retries on 429/502/503/504 (`uploads.ts:44-51`), it is surfaced as a hard failure for a file that in fact uploaded fine.

The same collision occurs — deterministically, not just under race — if a second `StorageLocation` is ever added, because the dedupe key includes `storageLocationId` but `objectKey` does not. Only one storage location exists today, so that variant is **NOT REPRODUCED**.

**Race B — non-idempotent retry.** `uploadFile` retries up to 5 times with no idempotency key. If the API commits and the response is lost (proxy 502, connection reset), the retry re-runs the whole route. The `StorageObject` is deduped by checksum — but `asset.create` runs unconditionally, so a **second Asset row** is created for the same physical file.

**Evidence:**

```txt
duplicate_assets_same_checksum: 4      ← same checksum, same library, distinct asset rows
checksums_with_multiple_objects: 0     ← storage dedupe works; asset dedupe does not exist
```

**Recommended fix direction:** replace check-then-create with an upsert on `objectKey`, or catch P2002 and re-read. Add an idempotency key (client-generated, e.g. `sha256 + size + name`) that the route uses to return the existing `UploadSession` instead of creating a second asset.

**Recommended regression test:** fire two identical uploads concurrently and assert both return 2xx with exactly one `StorageObject` and (per product decision) one or two assets — but never a 500.

---

### UP-010 — `GET /uploads` and `GET /uploads/:id` expose every user's uploads

```txt
Issue ID:            UP-010
Title:               Upload listing has no ownership scoping, unlike the sibling cancel/complete routes
Severity:            Medium
Confidence:          Confirmed
Affected component:  API
Affected file paths: apps/api/src/modules/uploads/routes.ts:432-490
Environment:         Production
```

**The inconsistency is internal to the same file.** `POST /uploads/:id/complete` (`:522-529`) and `POST /uploads/:id/cancel` (`:560-567`) both enforce:

```ts
if (upload.userId !== request.auth.user.id && role !== "OWNER" && role !== "ADMIN") {
  reply.status(403)...
}
```

`GET /uploads` (`:441-449`) has no such check and no `where` clause at all:

```ts
const uploads = await fastify.prisma.uploadSession.findMany({
  include: { targetLibrary: true },
  orderBy: { createdAt: "desc" },
  take: 100,
})
```

`GET /uploads/:uploadId` (`:467-474`) likewise fetches by id with no ownership check.

Both are reachable by the **VIEWER** role and by any API key with `assets:read`, `activity:read`, **or** `uploads:create`.

**Impact:** any authenticated principal, including the lowest-privileged role, can enumerate the 100 most recent uploads across the whole instance — original filenames, sizes, MIME types, target libraries, timestamps. For a self-hosted product whose promise is "your server, your control", cross-user filename disclosure between household or team members is a real (if bounded) confidentiality gap.

**Recommended fix direction:** scope to `userId: request.auth.user.id` unless the caller is OWNER/ADMIN — mirroring the rule already implemented 80 lines below in the same file.

**Recommended regression test:** as a MEMBER, GET `/uploads` and assert no other user's sessions appear; GET another user's `/uploads/:id` and assert 403.

---

### UP-011 — The upload queue shows destinations ("Applications", "Code") that are not real libraries

```txt
Issue ID:            UP-011
Title:               Frontend and API classification tables diverge; the UI promises libraries that do not exist
Severity:            Low
Confidence:          Confirmed
Affected component:  Web
Affected file paths: apps/web/lib/utils/media-type.ts (inferDestinationLabel, mediaTypeToLibraryKind)
                     apps/api/src/modules/uploads/routes.ts:34 (libraryKindForMediaType)
Environment:         Production
```

**Two divergences between the client table and the server table:**

| mediaType | web `mediaTypeToLibraryKind` | API `libraryKindForMediaType` | Actual destination |
|---|---|---|---|
| APPLICATION | `CUSTOM` | `INBOX` | Inbox |
| CODE | (default) `INBOX` | `INBOX` | Inbox |

| mediaType | web `inferDestinationLabel` shows | Real library |
|---|---|---|
| APPLICATION | **"Applications"** | Inbox — no such library exists |
| CODE | **"Code"** | Inbox — no such library exists |

The database confirms only five libraries exist: `videos`, `images`, `music`, `documents`, `inbox`. The queue item optimistically displays "Applications"/"Code" while the file is uploading; the server then reports "Inbox", and `addOrUpdate` (`upload-store.ts:189-194`) explicitly **ignores** an incoming destination of `"Inbox"` in favour of the previous value — so the wrong label is *preserved* rather than corrected.

**Recommended fix direction:** derive both label and kind from a single shared table in `@arciin/shared`, and drop the `!== "Inbox"` special case in the store's destination merge.

---

## 5. Suspected defects

These are supported by code reading or by partial evidence but were not fully reproduced end-to-end.

### UP-S01 — Duplicate upload-queue entries when the socket event beats the HTTP response — **LIKELY**

`apps/web/lib/stores/upload-store.ts:163-208`, `apps/web/hooks/use-upload-orchestrator.ts:74-107`, `apps/web/hooks/use-socket-events.ts:91-99`.

The orchestrator creates the queue item under a **client-generated id** with no `uploadId`. The API publishes `upload.started` **before** sending its HTTP 201 (`routes.ts:337` vs `:390`), and the socket handler calls `addOrUpdate({ id: payload.uploadId, ... })`. `addOrUpdate`'s matcher requires either `queueItem.id === item.id` or *both* records to already carry the same non-null `uploadId` — neither holds, so a **second** entry is created.

When the XHR response then lands, `addOrUpdate` matches the socket-created entry first (it is prepended at index 0 and now shares `uploadId`), leaving the original client-id entry orphaned. That orphan then reaches `READY` via `updateStatus(localId, …)` while the merged entry reaches `READY` via the socket — and `recordBatchTerminal` counts **both**, because their key sets (`[localId]` vs `[uploadId, uploadId]`) do not intersect. The batch summary over-counts ("2 of 1 uploaded").

Not reproduced because it requires a live upload and the ordering is genuinely racy — the HTTP response usually wins, which is why the symptom is intermittent.

**Fix direction:** make the orchestrator register the item with a placeholder `uploadId`, or have the socket handler ignore `upload.started` for uploads this tab initiated.

### UP-S02 — Assets can be left permanently `PROCESSING` when the original file is missing — **LIKELY**

`apps/worker/src/processors/worker-handlers.ts:305-308`:

```ts
if (!objectFilePath) {
  await markJobFailure(data.jobRecordId, new Error("Original file missing on disk."))
  return                     // ← returns normally: BullMQ records SUCCESS
}
```

Returning rather than throwing means BullMQ marks the job **completed**, so it never retries, never lands in the failed set, and never triggers an `upload.failed` event. The asset stays `PROCESSING` forever with no user-visible error. Not currently reproduced — there are 0 assets in `PROCESSING` and 0 assets with a missing storage object.

### UP-S03 — Media jobs have no retries — **LIKELY**

`routes.ts:262` and `thumbnail-jobs.ts:33` call `mediaQueue.add(name, payload)` with **no** `attempts`, `backoff`, `removeOnComplete`, or `removeOnFail`. BullMQ's default is `attempts: 1`. Any transient failure (ffmpeg OOM, a brief disk stall) permanently fails the job with no retry. Combined with UP-001, the upload is then stuck with no recovery path. The absence of `removeOnComplete` is also why `bull:media:completed` has grown to 3,875 retained job hashes (3,924 Redis keys total) — unbounded memory growth.

### UP-S04 — `mediaType` is re-derived after placement but the library is never re-evaluated — **POSSIBLE**

`worker-handlers.ts:317` re-runs `inferMediaType` and writes the result back to the asset, but `libraryId` is never revisited. If magic-byte detection on the stored object disagrees with the upload-time analysis, the asset ends up with a `mediaType` that contradicts its library. Production shows **0** rows where `UploadSession.detectedMediaType` differs from the final `Asset.mediaType`, so this has not actually fired — but nothing prevents it.

Relatedly, `worker-handlers.ts:352` reads `asset.mediaType` from the object fetched at line 275 — **before** the update at line 319. If the upload-time type was VIDEO and metadata extraction corrects it to AUDIO, the AUDIO→READY shortcut is evaluated against the stale value and never fires.

### UP-S05 — `GET /assets` has no pagination; category filters post-filter a truncated window — **POSSIBLE**

`apps/api/src/modules/assets/routes.ts` uses a hard `take: 200` (500 for `category`) with no cursor or offset. Library root views additionally pass `rootOnly: true`. Two consequences:
- A library with more than 200 root-level assets silently hides the rest, permanently.
- The `code` and `applications` category filters fetch the newest 500 assets **of all types** and *then* filter in JS (`routes.ts`, `resultAssets`), so a code file older than the 500 newest uploads is invisible.

Current data: max 168 root assets (images), 0 CODE assets, 1 APPLICATION asset — so **neither currently bites**. It is a latent cliff, not an active defect.

### UP-S06 — Duplicate socket delivery to OWNER/ADMIN — **POSSIBLE**

`apps/api/src/plugins/socket.ts` `emitRealtimeEvent` emits separately to `user:{id}` and `instance:{id}`. An OWNER is in both rooms and receives every event twice. The client dedupes on `payload.id` via `seenIdsRef` (`use-socket-events.ts:65-72`), but that set is **fully cleared** once it exceeds 500 entries rather than evicting oldest-first, briefly reopening the window. Also, the cleanup calls `socket.off(eventType)` with no handler argument, which removes *all* listeners for that event — including any registered by another component on the same socket.

---

## 6. File classification matrix

Produced by executing the production classification chain (`fileTypeFromFile` → `inferMediaType` → `libraryKindForMediaType`) against 44 fixtures in `/tmp/arciin-upload-audit/fixtures`, under three client-MIME scenarios: browser-realistic, `application/octet-stream` (curl/API), and empty.

**"Result" legend:** ✅ correct · ⚠️ metadata wrong but routing correct · ❌ wrong library

| Format | Extension | Detected MIME (magic) | Stored MIME | Expected library | Actual library | Result | Notes |
|---|---|---|---|---|---|---|---|
| PNG | `.png` | `image/png` | `image/png` | Images | Images | ✅ | |
| JPEG | `.jpg` | `image/jpeg` | `image/jpeg` | Images | Images | ✅ | |
| JPEG uppercase | `.JPG` | `image/jpeg` | `image/jpeg` | Images | Images | ✅ | case handled |
| WebP | `.webp` | `image/webp` | `image/webp` | Images | Images | ✅ | |
| SVG | `.svg` | *undetected* | `image/svg+xml` | Images | Images | ✅ | falls back to client MIME; correctly served as download, never inline |
| Image, no extension | *(none)* | `image/jpeg` | `image/jpeg` | Images | Images | ✅ | magic wins |
| Image mislabelled `.mp4` | `.mp4` | `image/jpeg` | `image/jpeg` | Images | Images | ✅ | content beats extension |
| Corrupt JPEG | `.jpg` | `image/jpeg` | `image/jpeg` | Images | Images | ✅ | accepted; sharp fails safely, thumbnail skipped |
| MP4 | `.mp4` | `video/mp4` | `video/mp4` | Videos | Videos | ✅ | |
| MOV | `.mov` | `video/quicktime` | `video/quicktime` | Videos | Videos | ✅ | |
| MKV | `.mkv` | `video/matroska` | `video/matroska` | Videos | Videos | ✅ | note: not `video/x-matroska` |
| WebM | `.webm` | `video/webm` | `video/webm` | Videos | Videos | ✅ | |
| Video mislabelled `.jpg` | `.jpg` | `video/mp4` | `video/mp4` | Videos | Videos | ✅ | content beats extension |
| Corrupt MP4 | `.mp4` | `video/mp4` | `video/mp4` | Videos | Videos | ✅ | ffmpeg fails → placeholder thumbnail |
| MP3 | `.mp3` | `audio/mpeg` | `audio/mpeg` | Music | Music | ✅ | |
| MP3 uppercase | `.MP3` | `audio/mpeg` | `audio/mpeg` | Music | Music | ✅ | |
| WAV | `.wav` | `audio/wav` | `audio/wav` | Music | Music | ✅ | |
| M4A (ffmpeg-authored) | `.m4a` | `audio/x-m4a` | `audio/x-m4a` | Music | Music | ✅ | |
| **M4A (ftyp brand `dash`)** | `.m4a` | **`video/mp4`** | `video/mp4` | Music | **Videos** | **❌** | **UP-002** — 3 in production |
| M4A mislabelled `.mp3` | `.mp3` | `audio/x-m4a` | `audio/x-m4a` | Music | Music | ✅ | |
| PDF | `.pdf` | `application/pdf` | `application/pdf` | Documents | Documents | ✅ | |
| Corrupt PDF | `.pdf` | `application/pdf` | `application/pdf` | Documents | Documents | ✅ | thumbnail job returns null cleanly |
| TXT | `.txt` | *undetected* | `text/plain` | Documents | Documents | ✅ | |
| Markdown | `.md` | *undetected* | `text/markdown` | Documents | Documents | ✅ | |
| CSV | `.csv` | *undetected* | `text/csv` | Documents | Documents | ✅ | |
| **DOCX** | `.docx` | **`application/zip`** | `application/zip` | Documents | Documents | **⚠️** | **UP-004** — stored ext becomes `zip` |
| **XLSX** | `.xlsx` | **`application/zip`** | `application/zip` | Documents | Documents | **⚠️** | UP-004 |
| **PPTX** | `.pptx` | **`application/zip`** | `application/zip` | Documents | Documents | **⚠️** | UP-004 |
| JSON | `.json` | *undetected* | `application/json` | Inbox (CODE) | Inbox | ✅ | |
| HTML | `.html` | *undetected* | `text/html` | Inbox (CODE) | Inbox | ✅ | served as download, not inline |
| XML | `.xml` | `application/xml` | `application/xml` | Inbox (CODE) | Inbox | ✅ | |
| Python | `.py` | *undetected* | `text/x-python` | Inbox (CODE) | Inbox | ✅ | |
| JavaScript | `.js` | *undetected* | `text/javascript` | Inbox (CODE) | Inbox | ✅ | |
| Shell | `.sh` | *undetected* | `application/x-sh` | Inbox (CODE) | Inbox | ✅ | |
| **TypeScript** | `.ts` | *undetected* | **`video/mp2t`** | Inbox (CODE) | **Videos** | **❌** | **UP-003** — browser-only; API path gives Inbox |
| ZIP | `.zip` | `application/zip` | `application/zip` | Inbox (ARCHIVE) | Inbox | ✅ | |
| TAR | `.tar` | `application/x-tar` | `application/x-tar` | Inbox (ARCHIVE) | Inbox | ✅ | |
| GZIP | `.gz` | `application/gzip` | `application/gzip` | Inbox (ARCHIVE) | Inbox | ✅ | |
| MSI *(production sample)* | `.msi` | `application/x-cfb` | `application/x-cfb` | Inbox (APPLICATION) | Inbox | ⚠️ | stored ext becomes `cfb`; same mechanism as UP-004 |
| Binary blob | `.bin` | *undetected* | `application/octet-stream` | Inbox (OTHER) | Inbox | ✅ | |
| **Empty file (0 bytes)** | `.dat` | *undetected* | `application/octet-stream` | Inbox (OTHER) | Inbox | ⚠️ | accepted with no minimum-size check |
| No extension, text | *(none)* | *undetected* | `application/octet-stream` | Inbox (OTHER) | Inbox | ⚠️ | `Asset.extension` becomes `"bin"` but the object key has no extension |
| Spaces + `( ) [ ] & + #` | `.png` | `image/png` | `image/png` | Images | Images | ✅ | object key is checksum-derived; filename never touches the path |
| Unicode + emoji | `.png` | `image/png` | `image/png` | Images | Images | ✅ | |
| Hidden `.hiddenfile.png` | `.png` | `image/png` | `image/png` | Images | Images | ✅ | |
| Multi-dot `archive.tar.gz.png` | `.png` | `image/png` | `image/png` | Images | Images | ✅ | last extension wins, correctly |

**Not tested — no fixture available on the host:** `.heic`, `.heif`, `.avif`, `.bmp`, `.tiff`, `.gif`, `.avi`, `.wmv`, `.flv`, `.m4v`, `.3gp`, `.aac`, `.flac`, `.ogg`, `.opus`, `.wma`, `.doc`, `.xls`, `.ppt`, `.odt`, `.epub`, `.rtf`, `.7z`, `.rar`. Per the static tables in `packages/shared/src/media.ts` all are enumerated in the appropriate extension set and should route correctly when magic detection succeeds; the OOXML/CFB caveat of UP-004 applies to the legacy Office formats (`.doc`/`.xls`/`.ppt` are CFB containers and will likely store `extension: cfb`).

**Cross-client divergence summary:** of 44 fixtures × 3 client-MIME scenarios, exactly **one** fixture produced a different destination library depending on what the client claimed: `.ts` (UP-003). Server-side magic-byte detection is otherwise authoritative and consistent.

---

## 7. Upload reliability matrix

Legend: ✅ verified working · ❌ verified broken · ⚠️ works with caveats · — not tested (no upload credentials)

| Scenario | API | File storage | Database | Queue | Worker | Socket | UI | Result |
|---|---|---|---|---|---|---|---|---|
| Single image upload | ✅ 201 | ✅ | ✅ | ✅ | ✅ jobs complete | ⚠️ final event never sent | ❌ stuck "Processing" | **UP-001** |
| Single video upload | ✅ 201 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ stuck "Processing" | **UP-001** |
| Single audio upload (`audio/*` magic) | ✅ 201 | ✅ | ✅ | ✅ | ✅ sets READY | ✅ | ✅ | OK |
| Single audio upload (mp4 container) | ✅ 201 | ✅ | ⚠️ wrong library | ✅ | ⚠️ treated as video | ⚠️ | ❌ in Videos | **UP-002** |
| Single document / PDF | ✅ 201 | ✅ | ✅ | n/a (READY at create) | ⚠️ thumb only | ✅ | ✅ | OK |
| Office document | ✅ 201 | ✅ | ⚠️ ext/MIME = zip | n/a | n/a | ✅ | ⚠️ | **UP-004** |
| TypeScript `.ts` from a browser | ✅ 201 | ✅ | ❌ Videos | ✅ | ⚠️ ffmpeg fails | ⚠️ | ❌ | **UP-003** |
| Archive / unknown / empty file | ✅ 201 | ✅ | ✅ Inbox | n/a | n/a | ✅ | ✅ | OK (no min-size check) |
| Multiple files (≤20) | — | — | — | — | ⚠️ 4 jobs/min ceiling | — | ❌ | **UP-005 + UP-001** |
| 10 simultaneous uploads | — | — | — | ⚠️ | ⚠️ ~5 min drain | — | — | UP-005, not reproduced |
| Same content, two names, concurrent | — | ⚠️ | ⚠️ P2002 → 500 for loser | — | — | — | — | **UP-009**, code-confirmed |
| Repeated upload of the same file | — | ✅ deduped | ⚠️ duplicate Asset row | — | — | — | — | 4 duplicates in production |
| Upload into an explicit library | ✅ | ✅ | ⚠️ no type validation | ✅ | ✅ | ✅ | ✅ | by design; 10 misrouted rows exist |
| Upload into a folder | ✅ | ✅ | ❌ no folder validation | ✅ | ✅ | ✅ | ⚠️ | **UP-008** — 3 assets in deleted folders |
| Upload while viewing another library | — | — | — | — | — | — | — | not tested |
| Redis unavailable mid-request | ❌ 500 | ✅ stored | ⚠️ asset orphaned in PROCESSING | ❌ | — | ❌ | ❌ | **UP-007**; log evidence 2026-07-28 / 07-31 |
| Client retry after a lost response | ✅ | ✅ deduped | ⚠️ duplicate Asset | ✅ | ✅ | ✅ | ⚠️ | **UP-009** |
| Client abort | ✅ | ⚠️ temp file may leak | ✅ none | n/a | n/a | n/a | ✅ | **UP-006** |
| File over the size limit | ✅ 413 | ✅ temp removed | ✅ none | n/a | n/a | n/a | ✅ | handled correctly |
| Socket disconnected | n/a | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ 12 s polling fallback | mitigated by `use-assets.ts:19` |

---

## 8. Frontend real-time findings

**What works well.** The invalidation strategy is deliberately aggressive and correct: `refreshLibraryQueries` invalidates the `["assets"]`, `["libraries"]`, and `["folders"]` prefixes and then force-refetches with `type: "all"` (including inactive queries). `useAssets` sets `refetchOnWindowFocus: true` and — importantly — polls every 12 s **when the socket is down** (`use-assets.ts:19`), so a dropped socket degrades gracefully rather than freezing the UI. Query keys are consistently prefix-structured, so no invalidation misses its target. There is no `staleTime` inflation, no thumbnail-gating, no MIME-based hiding, and no sorting on a nullable timestamp.

**What is broken.**

1. **The completion event never arrives (UP-001).** This is the whole story for "stuck processing". The API's `upload.completed` carries `progress: 88` for media, and `use-socket-events.ts:124-127` maps `progress >= 100 ? READY : PROCESSING` — so the queue item is *correctly* set to PROCESSING and then waits for a second event at 100 that the worker never sends.
2. **Duplicate queue entries under an event/response race (UP-S01)** — see §5.
3. **`socket.off(eventType)` without a handler reference** (`use-socket-events.ts:336`) removes every listener for that event, not just this hook's.
4. **`seenIdsRef` clears wholesale at 500 entries** rather than evicting oldest-first, briefly reopening the duplicate window for OWNER/ADMIN who receive each event twice (UP-S06).
5. **Optimistic destination labels are wrong and sticky (UP-011)** — "Applications"/"Code" are shown for libraries that do not exist, and the store's `!== "Inbox"` merge rule prevents the server's correct value from overwriting them.
6. **Events reach only the uploader plus OWNER/ADMIN.** `emitRealtimeEvent` targets `user:{uploaderId}` and `instance:{id}`; nobody ever joins the `library:` rooms it also emits to. A second MEMBER browsing the same library gets no live update and must refresh — a plausible source of the "appear only after a refresh" report for multi-user instances.

---

## 9. API findings

| Area | Finding |
|---|---|
| Authentication | ✅ `requireSessionRolesOrApiKeyScopes(["OWNER","ADMIN","MEMBER"], ["uploads:create"])` on POST. Correct. |
| Authorization (write) | ✅ VIEWER correctly excluded from POST; cancel/complete enforce per-session ownership. |
| Authorization (read) | ❌ **UP-010** — `GET /uploads` and `GET /uploads/:id` are unscoped. |
| Per-file size limit | ✅ enforced streaming in `writeMultipartToTemp` (10,240 MB configured), returns 413. |
| Multipart plugin limit | ⚠️ `fileSize` ceiling is 1 TiB — intentionally permissive so the app-level check owns the error; documented in the source. |
| Files per request | ⚠️ `request.file()` reads exactly one part; extra parts are silently ignored rather than rejected. |
| Rate limiting | ⚠️ 500/min per user by default. Applied **after** `await request.file()`, so a rate-limited request returns without draining the upload stream. |
| Accepted content types | ⚠️ No allowlist or denylist — every type is accepted. Consistent with a personal file store; worth an explicit product decision. |
| Zero-byte files | ⚠️ Accepted with no minimum-size check. |
| Filename sanitisation | ✅ Not needed for path safety — the object key is `objects/<aa>/<bb>/<sha256>.<ext>`, entirely checksum-derived. `originalFilename` is stored raw as metadata only. **No path-traversal vector was found.** |
| Request timeout | ⚠️ Client sets `request.timeout = 0` (never times out). No server-side upload timeout. |
| Transaction boundaries | ❌ **UP-007** — none. |
| Cleanup after error | ❌ **UP-007** — temp file only. |
| Idempotency / retry safety | ❌ **UP-009** — no idempotency key; the client retries 5×. |
| Duplicate handling | ⚠️ Content deduped at the `StorageObject` level; **not** at the `Asset` level. |
| Status codes | ✅ 400 / 409 / 413 / 500 are used appropriately. |
| Response accuracy | ❌ 201 means "bytes stored + row created", not "upload complete and correctly classified". |
| Swallowed errors | ⚠️ Connector-mirror failures are caught, logged at `warn`, and never surfaced (`routes.ts:314-319`). Storage/DB errors are correctly logged at `error` and re-raised to the client. `appendUploadLog` records structured failures — a genuinely good practice. |

---

## 10. Worker and queue findings

**Live queue state:**

```txt
queue          wait  active  delayed  completed  failed  paused
media             0       0        0       3875      23       0
storage           0       0        0          0       0       0
integrations      0       0        0          0       0       0

Redis db0: 3924 keys, 18 with TTL      BullMQ 5.76.8
```

**Job records (PostgreSQL):**

```txt
        type        |  status   |  n
--------------------+-----------+------
 extract_metadata   | COMPLETED | 1885
 generate_thumbnail | COMPLETED | 1888
 import_url         | COMPLETED |   71
 import_url         | FAILED    |   54
```

**Findings:**

1. **Zero upload-path job failures.** All 23 entries in `bull:media:failed` are `import_url`, not uploads. The processing pipeline itself is reliable — which is what makes UP-001 so clearly an announcement bug rather than a processing bug.
2. **`import_url` fails 43% of the time** (54 of 125). Failure reasons: `Could not find a downloadable file at that link` (7), HTTP 400 (4), HTTP 403 (3), Instagram-specific (3) — mostly legitimate remote-side failures. Three failures are historical `Unknown argument 'importSourceUrl'` Prisma errors from a worker running a stale generated client, and three are `Invalid IP address: undefined`. Out of upload scope but worth a follow-up.
3. **No retries** (UP-S03) — `attempts` is never set, so BullMQ's default of 1 applies.
4. **No retention policy** — no `removeOnComplete` / `removeOnFail`, so 3,875 completed job hashes are retained in Redis indefinitely, dominating the 3,924-key database.
5. **Severe rate limiter** (UP-005) — `{ max: 4, duration: 60_000 }` at the default concurrency.
6. **`maxRetriesPerRequest: null` is correctly set** on both the API and worker connections, with an excellent explanatory comment (`apps/worker/src/index.ts:27-35`) recording that its absence previously caused exactly this "stuck showing Processing forever" symptom. That earlier fix was right; UP-001 is a *different* cause of the same symptom.
7. **Storage queue has never executed a job** — confirming UP-006.
8. **Stalled-job handling, lock duration, and deduplication** are all left at BullMQ defaults; none are configured explicitly.
9. **Asset id is passed by value in the job payload**, so a job can outlive its asset — handled by throwing "Asset not found." (which correctly fails the job), except for the missing-file path (UP-S02) which returns silently.

---

## 11. Database integrity findings

All counts; no filenames or personal data reproduced.

| Check | Result | Verdict |
|---|---|---|
| System libraries present | 5 — VIDEO, IMAGE, AUDIO, DOCUMENT, INBOX (one each) | ✅ |
| Duplicate libraries per kind | 0 | ✅ |
| Missing default library | none | ✅ |
| Storage locations | 1 (`LOCAL`, `/srv/arciin-storage/arciin`, default) | ✅ |
| Assets with a missing storage object | **0** | ✅ |
| Assets with a missing library reference | 0 | ✅ |
| Assets whose file is absent from disk | 0 | ✅ |
| Zero-byte files under `objects/` | 0 | ✅ |
| Assets stuck `UPLOADING` / `PROCESSING` | **0** | ✅ |
| Upload sessions stuck at `CLASSIFIED` | **1,278** | ❌ **UP-001** |
| Upload sessions with no asset | 16 (all `FAILED` — correct) | ✅ |
| Upload sessions with `targetFolderId` set | **0 of 1,885** | ❌ **UP-008** |
| Orphaned storage objects (no asset) | **30 / 20.6 MB** | ❌ **UP-007** |
| Duplicate assets, same checksum + library | **4** | ❌ **UP-009** |
| Multiple storage objects per checksum | 0 | ✅ dedupe works |
| Assets in soft-deleted folders (invisible) | **3** | ❌ **UP-008** |
| Assets whose folder is in another library | 0 | ✅ |
| Assets with `extension = 'bin'` | 0 | ✅ |
| Assets with `mimeType = application/octet-stream` | 0 | ✅ |
| Assets with `mediaType = OTHER` | 0 | ✅ |
| Stored extension ≠ filename extension | 189 of 342 (55%) | ⚠️ mostly correct (magic wins); OOXML subset is UP-004 |

**Misrouted assets — the full production set (10 of 342, 2.9%):**

```txt
  library  | mediaType | extension |  mimeType  | created
-----------+-----------+-----------+------------+------------
 documents | VIDEO     | mp4       | video/mp4  | 2026-07-29   ← UP-002 (.m4a)
 music     | VIDEO     | mp4       | video/mp4  | 2026-07-29   ← UP-002 (.m4a)
 images    | VIDEO     | mp4       | video/mp4  | 2026-07-29   ← UP-002 (.m4a)
 videos    | IMAGE     | jpg       | image/jpeg | 2026-07-22
 videos    | IMAGE     | jpg       | image/jpeg | 2026-07-22
 images    | DOCUMENT  | txt       | text/plain | 2026-07-12
 images    | VIDEO     | mp4       | video/mp4  | 2026-07-12
 videos    | IMAGE     | jpg       | image/jpeg | 2026-07-08
 videos    | IMAGE     | jpg       | image/jpeg | 2026-07-08
 videos    | IMAGE     | jpg       | image/jpeg | 2026-07-08
```

The three `.m4a` rows are UP-002. The remainder are consistent with explicit user-directed uploads (dropping a file into a folder inside a mismatched library, which `resolveUploadTargetForFile` permits by design) or with manual moves — the API deliberately trusts a caller-supplied `targetLibraryId` without checking that its kind matches the detected media type.

---

## 12. Storage findings

```txt
Configured root:  /srv/arciin-storage/arciin   (identical in .env and all 3 PM2 environments)
Filesystem:       /dev/mapper/ubuntu--vg-ubuntu--lv  ext4  rw,relatime
Capacity:         98 G total, 65 G used, 29 G available (69%)
Inodes:           6,553,600 total, 1,173,523 used (18%)
Ownership:        arce:arce, mode 755 — writable by all three services (same UID)
```

| Check | Result |
|---|---|
| Directory exists | ✅ with `objects/`, `libraries/`, `thumbnails/`, `temp/`, `logs/`, `config/`, `avatars/` |
| API can write | ✅ |
| Worker can read / write thumbnails | ✅ — 1,875 thumbnails present |
| Objects on disk | 1,583 files |
| Mount read-only | ✅ no — `rw` |
| Cross-filesystem move risk | ✅ none — `temp/` and `objects/` are on the same ext4 volume, so `rename()` is atomic |
| Path normalisation / traversal | ✅ safe — object keys are checksum-derived; client filenames never reach the filesystem |
| Unicode / long / special-character filenames | ✅ safe for the same reason |
| Zero-byte files under `objects/` | ✅ 0 |
| Symlinks | none observed |
| **Orphaned temp files** | ❌ **2 files, 1.55 GB, 27 days old** — UP-006 |
| **Orphaned storage objects** | ❌ **30 rows / 20.6 MB** — UP-007 |
| Filename collision handling | ✅ n/a by design — content-addressed storage means identical content collapses to one object |
| Native vs Docker root consistency | ✅ `.env` uses the documented `/srv/arciin-storage/arciin`; Docker's `/data/arciin` is not in play on this host |
| **Log rotation** | ❌ `logs/arciin-api-out.log` is **282 MB** and unrotated. `LOG_MAX_FILE_BYTES` exists in `.env` but does not govern the PM2 stdout files. |

---

## 13. Runtime and deployment findings

| Check | Result |
|---|---|
| PM2 working directories | ✅ `arciin-api` / `arciin-web` / `arciin-worker` all `cwd = /srv/arce-projects/arciin` |
| Run scripts | `scripts/run-api-prod.sh` and `run-worker-prod.sh` exec **`tsx` against `src/` directly** — no compiled `dist`. `run-web-prod.sh` runs `next start` and correctly refuses to boot without a `BUILD_ID`. |
| **API/worker running stale code?** | ✅ **No.** Processes started 2026-07-31 06:39; the newest API/worker/packages source file is 2026-07-17 22:59. Running code matches disk. |
| **Web running a stale build?** | ✅ **No.** `apps/web/.next/BUILD_ID` is 2026-07-18 00:09; the newest web source is 2026-07-17 23:08. The build post-dates the source. |
| Are API and web on the same revision? | ✅ Yes — same working tree, same uncommitted changes. |
| Uncommitted changes in the tree | ⚠️ 29 modified + 3 untracked files, including `apps/api/src/modules/uploads/routes.ts` and `prisma/schema.prisma`. **They are live in production** because API/worker run from source. Everything audited reflects what is actually running. |
| Prisma migrations | ✅ `Database schema is up to date` — 29 migrations, including the untracked `20260717220000_folder_remote_hide_all_files`. |
| Stale root `.next/` and `dist/` | ⚠️ A leftover `/.next` (2026-07-06) and `/dist` (release tarball) exist at the repo root. Neither is served — `run-web-prod.sh` uses `apps/web/.next`. Harmless clutter. |
| `DATABASE_URL` | ✅ present in API, worker, and web; **identical** across all three (SHA-256 prefix `3f40c011` in each). Value redacted. |
| `REDIS_URL` | ✅ present in all three; **identical** (`60ea7b7c`). Value redacted. |
| `ARCIIN_DATA_DIR` | ✅ `/srv/arciin-storage/arciin` in all three — no split-brain storage root. |
| `NODE_ENV` | ✅ `production` in all three. |
| `MAX_UPLOAD_SIZE_MB` | ✅ `10240` in all three. |
| `ARCIIN_WORKER_CONCURRENCY` | ⚠️ **absent everywhere** → defaults to 2 → drives UP-005. |
| Ports | ✅ web 3002, API 4000, no dev/prod mixing. `ARCIIN_PUBLIC_URL=http://192.168.4.53:3002`, `ARCIIN_API_URL=http://127.0.0.1:4000`. |
| Frontend → API origin | ✅ `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_ARCIIN_API_ORIGIN` are deliberately blank so uploads and the socket use the page's own origin (documented in `.env` as required for session cookies). Correct for this topology. |
| Multiple API/worker instances | ✅ single `fork_mode` instance each — no double-processing. |
| Restart churn | ✅ 0 restarts on all three; 4-day uptime. |
| **`arciin-mobile`** | ⚠️ **Different repository** — `exec cwd /srv/arce-projects/arciin-app`, script `run-mobile-prod.sh`, HEAD `5587d1c` (2026-07-15). It does **no** client-side classification (good — it delegates to the server). It does **not** import `@arciin/shared`; a comment in `lib/preferences/accent-colors.ts` reads *"keep in sync with @arciin/shared"*, confirming shared constants are hand-copied across repos and can drift. |
| Unrelated PM2 apps | `arceclaw`, `arceclaw-tunnel` — untouched. |

**Historical incident visible in the logs:** Redis was unreachable at 2026-07-28 06:20 and 2026-07-31 06:39 (`[ioredis] Unhandled error event: connect ECONNREFUSED 127.0.0.1:6379`), and the worker crashed during shutdown with `Error: Connection is closed` at `apps/worker/src/index.ts:113` — `redis.quit()` is called on an already-closed connection inside `Promise.all`, so the shutdown handler throws instead of exiting cleanly. Any upload in flight during those windows would have hit the UP-007 path. No upload-specific errors appear in `arciin-api-err.log`.

---

## 14. Test results

| # | Command | Exit code | Result |
|---|---|---|---|
| 1 | `git status --short` / `git branch --show-current` / `git log -1` | 0 | `main` @ `8f4d0ea`, 32 dirty entries |
| 2 | `node --version` | 0 | v24.18.0 |
| 3 | `pnpm --version` | 0 | 10.32.1 |
| 4 | `pm2 list` | 0 | 6 processes; 4 Arciin, 2 unrelated (untouched) |
| 5 | `pm2 describe arciin-{api,web,worker,mobile}` | 0 | cwd/script/env captured; see §13 |
| 6 | `pm2 env {2,3,4}` (filtered, hashed) | 0 | DATABASE_URL / REDIS_URL / ARCIIN_DATA_DIR identical across all three |
| 7 | `npx prisma migrate status` | 0 | **Database schema is up to date** — 29 migrations |
| 8 | `psql` — 7 read-only query files (`q1`–`q7.sql`) | 0 | see §11; **no writes issued** |
| 9 | `redis-cli INFO keyspace` / `--scan` / `ZCARD` / `HMGET` | 0 | see §10; **no keys read-modified, no jobs removed** |
| 10 | `df -h` / `df -i` / `findmnt` / `ls -la` on the storage root | 0 | see §12 |
| 11 | Log review — `logs/arciin-{api,web,worker}-{err,out}.log` | 0 | see §13; nothing deleted or rotated |
| 12 | `ffprobe` on one production object | 0 | 1 audio stream, 0 video streams — proves UP-002 |
| 13 | **Classification harness** — 44 fixtures × 3 client-MIME scenarios | 0 | see §6 |
| 14 | OOXML magic-detection probe | 0 | all OOXML → `application/zip` |
| 15 | **`pnpm typecheck`** | **0** | ✅ **PASS** — all 9 tsconfig projects clean |
| 16 | **`pnpm lint`** | **0** | ✅ **PASS** — 16 problems: **0 errors, 16 warnings** (14 `react-hooks/exhaustive-deps`, 2 `@next/next/no-img-element`) |
| 17 | `pnpm build` | — | **NOT RUN** — would overwrite the `apps/web/.next` artifact the live web process serves |
| 18 | Unit / integration tests | — | **CANNOT BE RUN — none exist.** No `test` script; no vitest/jest/playwright dependency; two orphaned `*.test.ts` files (`packages/config/src/api-protection.test.ts`, `packages/types/src/pdf-page-labels.test.ts`) with no runner. See §17. |
| 19 | End-to-end HTTP uploads | — | **NOT RUN** — no credentials; see §2 |

**Passed:** typecheck, lint, migration status, and every read-only inspection.
**Failed:** none.
**Could not be run:** the test suite (does not exist), `pnpm build` (production-mutating), and all live-upload scenarios (no credentials).

---

## 15. Issues ranked by priority

### P0 — Immediate data-loss, corruption, or security risk

| ID | Title | Note |
|---|---|---|
| UP-010 | `GET /uploads` exposes every user's upload metadata to any authenticated principal including VIEWER | The only P0. **No data-loss or corruption issue was found** — this bucket is otherwise empty, which is genuinely good news. |

### P1 — Upload fails or disappears for users

| ID | Title |
|---|---|
| **UP-001** | Uploads never reach READY; completion event never sent — **1,278 sessions affected, ~4 weeks** |
| UP-005 | Worker media queue throttled to 4 jobs/min (≈2 uploads/min) |
| UP-007 | No transaction / no rollback — HTTP 500 returned while the asset persists; 30 orphaned storage objects |
| UP-008 | `targetFolderId` unvalidated — 3 assets are invisible in soft-deleted folders |

### P2 — Wrong classification or real-time visibility problem

| ID | Title |
|---|---|
| UP-002 | Audio in MP4 containers classified as VIDEO — 3 misrouted assets in production |
| UP-003 | `.ts` source files routed to Videos from browsers |
| UP-009 | Concurrent-identical-upload race → 500; non-idempotent retry → duplicate assets (4 in production) |
| UP-004 | Office documents stored with `application/zip` MIME and `zip` extension |
| UP-S01 | Duplicate upload-queue entries and over-counted batch totals when the socket beats the response |

### P3 — Edge case, observability, or maintainability

| ID | Title |
|---|---|
| UP-006 | Temp-cleanup job never scheduled — 1.55 GB leaked; `moveTempToObject` leaks on the destination-exists path |
| UP-011 | Frontend shows "Applications"/"Code" destinations for libraries that do not exist |
| UP-S02 | Missing-file job returns instead of throwing — silent permanent PROCESSING |
| UP-S03 | No job retries, no `removeOnComplete` — 3,875 job hashes retained in Redis |
| UP-S04 | `mediaType` re-derived post-placement without re-evaluating the library; stale read at `worker-handlers.ts:352` |
| UP-S05 | `GET /assets` has no pagination; category filters post-filter a truncated window |
| UP-S06 | Duplicate socket delivery to OWNER/ADMIN; `socket.off(eventType)` removes foreign listeners |
| — | 282 MB unrotated `arciin-api-out.log`; worker shutdown throws on `redis.quit()` |
| — | `import_url` fails 43% of the time (out of upload scope) |

---

## 16. Recommended implementation sequence

No fixes were implemented. This is the suggested order only.

---

**Step 1 — Restore the upload completion signal**

- **Issues addressed:** UP-001
- **Component:** `apps/worker/src/processors/worker-handlers.ts` (the `uploadNotYetAnnounced` guard)
- **Why first:** it is a one-clause change with the single largest user-visible impact, it unblocks meaningful testing of everything else (you currently cannot tell a working upload from a broken one), and it carries almost no regression surface.
- **Expected risk:** Low. The one thing to watch is the duplicate-toast case the original comment describes — `status !== "READY"` alone must be verified to still suppress it for PDFs.
- **Required tests:** upload a PNG, an MP4, and a PDF; assert `UploadSession.status === "READY"` for all three and that no duplicate toast appears for the PDF.
- **Acceptance criteria:** new image/video uploads reach `READY`; the queue item clears; a separate decision is taken on whether to backfill the 1,278 historical `CLASSIFIED` rows.

**Step 2 — Fix the worker throughput ceiling**

- **Issues addressed:** UP-005
- **Component:** `apps/worker/src/index.ts` limiter; optionally set `ARCIIN_WORKER_CONCURRENCY` in `.env`
- **Why second:** with Step 1 done, uploads finish — but a bulk drop still takes minutes. This is the difference between "works" and "feels working". Doing it after Step 1 means the improvement is actually observable.
- **Expected risk:** Medium — raising throughput raises peak CPU/RAM. Change the limiter and the concurrency separately so the effect of each is attributable.
- **Required tests:** upload 20 images and time the queue drain; watch `pm2 monit` for memory against the 768 MB `max_memory_restart`.
- **Acceptance criteria:** 20 images fully processed in well under a minute with no worker restart.

**Step 3 — Close the read-scoping hole**

- **Issues addressed:** UP-010
- **Component:** `apps/api/src/modules/uploads/routes.ts` — `GET /uploads`, `GET /uploads/:id`
- **Why here:** it is the only P0, it is independent of Steps 1–2, and the correct rule already exists 80 lines below in the same file — this is a copy of an established pattern, not a new design.
- **Expected risk:** Low. Verify the uploads page still populates for OWNER (which it will, since OWNER/ADMIN keep instance-wide visibility).
- **Required tests:** as MEMBER, assert `GET /uploads` returns only own sessions; as MEMBER, assert `GET /uploads/:otherId` returns 403; as OWNER, assert full visibility is retained.
- **Acceptance criteria:** no cross-user filename disclosure at any role below ADMIN.

**Step 4 — Make the upload route transactional and self-cleaning**

- **Issues addressed:** UP-007, UP-009, UP-006 (the `moveTempToObject` leak)
- **Component:** `apps/api/src/modules/uploads/routes.ts` write sequence; `apps/api/src/services/storage/local-storage.ts`
- **Why here:** this is the largest change and touches the hot path, so it should land only once the system is observable enough (Steps 1–2) to detect a regression. It also subsumes the UP-009 duplicate-key race, which is best fixed with an upsert inside the same refactor.
- **Expected risk:** **High** — this is the core write path. Land it behind careful review; keep the transaction narrow (storage object + asset + session + job row), and keep `mediaQueue.add` *outside* the transaction with a compensating cleanup, since a queue call inside a DB transaction is its own failure mode.
- **Required tests:** inject failures at each write step and assert no partial state survives; fire two identical concurrent uploads and assert no 500; assert the temp file is removed on every path including destination-exists.
- **Acceptance criteria:** the orphaned-storage-object count stops growing; no 500 under concurrent identical uploads.

**Step 5 — Validate `targetFolderId` and record it**

- **Issues addressed:** UP-008
- **Component:** `resolveMediaConnectorUploadFolderId`; `UploadSession.targetFolderId` population
- **Why here:** it depends on Step 4's error handling to reject cleanly (today a bad folder id produces a 500 *after* the file is stored; it should be a 400 *before*).
- **Expected risk:** Low-Medium. Confirm no existing client sends a folder id from a different library — 0 such rows exist today, but the web `prepareUploadTargets` path should be re-read before tightening.
- **Required tests:** cross-library folder id → 400; soft-deleted folder id → 400; non-existent → 404.
- **Acceptance criteria:** no new assets land in deleted or foreign folders; the uploads page can display a folder destination.

**Step 6 — Correct classification for audio-in-MP4, `.ts`, and OOXML**

- **Issues addressed:** UP-002, UP-003, UP-004
- **Component:** `analyzeStoredFile`; `inferMediaType`
- **Why here:** classification changes alter where files land, so they want a stable, observable pipeline underneath and a regression suite (Step 8) to protect them. Grouping all three is efficient — they share one decision function.
- **Expected risk:** Medium — a change here affects every future upload. Existing assets are unaffected unless a backfill is chosen.
- **Required tests:** the fixture matrix in §6 as an automated table test, extended with real `.docx`/`.m4a` samples.
- **Acceptance criteria:** audio-only MP4 → Music; `.ts` → Inbox from both browser and API; `.docx` keeps its real MIME and extension.

**Step 7 — Reconcile the frontend upload-queue state machine**

- **Issues addressed:** UP-S01, UP-011
- **Component:** `apps/web/lib/stores/upload-store.ts`, `use-upload-orchestrator.ts`, `use-socket-events.ts`, `lib/utils/media-type.ts`
- **Why here:** the duplicate-entry race is only reliably observable once Step 1 makes the terminal state real, and the destination-label fix depends on the shared table introduced in Step 6.
- **Expected risk:** Low-Medium — pure client state.
- **Required tests:** simulate socket-before-response and response-before-socket ordering; assert exactly one queue entry and a batch total equal to the file count.
- **Acceptance criteria:** no duplicate entries; batch summary matches the file count exactly.

**Step 8 — Establish a test harness and schedule maintenance jobs**

- **Issues addressed:** UP-006 (scheduling), UP-S02, UP-S03, plus §17 in full
- **Component:** new test infrastructure; worker boot-time repeatable jobs; BullMQ `attempts` / `removeOnComplete` / `removeOnFail`
- **Why last:** it is the least urgent but the highest-leverage for preventing recurrence — and putting it last means the tests written here encode the *fixed* behaviour rather than the broken behaviour. UP-001 in particular is exactly the class of bug a single integration test would have caught the day it shipped.
- **Expected risk:** Low.
- **Required tests:** the harness itself.
- **Acceptance criteria:** `pnpm test` exists and runs; temp files older than 24 h are reaped automatically; completed jobs no longer accumulate unbounded in Redis.

---

## 17. Missing test coverage

**There is no test infrastructure in this repository.** No `test` script in any `package.json`; no vitest, jest, or playwright dependency; two orphaned `*.test.ts` files with no runner. Every behaviour below is currently unprotected.

**Classification**
- `inferMediaType` across the full extension/MIME matrix (this alone would have caught UP-002, UP-003, and UP-004)
- Magic-byte vs. extension vs. client-MIME precedence
- Behaviour with empty, `application/octet-stream`, and uppercase MIME/extension inputs
- Audio-only MP4 containers across ftyp brands
- OOXML and CFB container reconciliation
- Files with no extension, multiple dots, leading dots, Unicode, and emoji

**Routing**
- `libraryKindForMediaType` for all 8 `MediaType` values
- `resolveUploadTargetLibrary` fallback to Inbox when a kind-matched library is absent
- Behaviour when a caller-supplied `targetLibraryId` contradicts the detected type
- Folder validation: cross-library, soft-deleted, and non-existent ids

**Upload route**
- Success paths per media type, asserting status, library, extension, and MIME
- Failure paths at each write step, asserting no partial state survives
- Concurrent identical uploads
- Retry idempotency
- Size-limit enforcement (413) and zero-byte handling
- Rate-limit behaviour and stream draining
- Ownership scoping on every `/uploads` route

**Worker**
- `UploadSession` reaches `READY` for each media type (**the UP-001 regression test**)
- Metadata extraction populates width/height/duration/codec
- Thumbnail generation for image, video, PDF, and the corrupt-input fallback
- Missing-file handling marks the job failed *and* notifies
- Retry and backoff behaviour

**Realtime and frontend**
- Event ordering: socket-before-response and response-before-socket
- Upload-store merge semantics and batch counting
- Query-key invalidation coverage for every affected view
- Socket reconnect and room rejoin
- Polling fallback when the socket is down

**Storage**
- Object-path derivation and collision behaviour
- `moveTempToObject` cleanup on every branch
- Temp reaping
- Orphan detection

---

## 18. Final conclusion

### What is working

The foundations are genuinely solid, and it is worth being precise about that rather than burying it. **No user data is at risk.** Every one of the 342 assets has its storage object and its file on disk; there are zero zero-byte objects, zero broken references, and zero assets stranded in `PROCESSING`. Content-addressed storage makes path traversal structurally impossible and makes filename edge cases — Unicode, emoji, spaces, brackets, multiple dots, hidden files — a non-issue. Server-side magic-byte classification is authoritative and, across 44 fixtures in 3 client scenarios, produced a client-dependent result exactly once. Deduplication at the storage layer works perfectly (0 duplicate objects per checksum). The job pipeline itself is reliable: 3,773 media jobs completed with zero upload-path failures. Deployment hygiene is good — no stale builds, no env drift between services, migrations current, zero restarts in 4 days. `pnpm typecheck` and `pnpm lint` both pass cleanly.

### What is not working

**The upload completion signal has been broken for four weeks.** A single dead condition — `upload.completedAt == null`, which the API guarantees is never true — means no image or video upload has reported completion since 2026-07-09. 1,278 sessions are stranded at `CLASSIFIED`. This is the reported "stuck processing" symptom, and it is a one-clause fix.

Underneath it, a worker rate limiter of 4 jobs per minute makes bulk uploads crawl even when the completion signal is restored. Classification misroutes two specific classes of file (audio in MP4 containers, and `.ts` source from browsers) with 3 confirmed misrouted assets in production. The upload route performs seven sequential writes with no transaction, so a Redis blip returns HTTP 500 to a user whose file actually uploaded fine — 30 orphaned storage objects and 4 duplicate assets are the residue. `targetFolderId` is passed to the database unvalidated, and 3 assets are consequently invisible inside soft-deleted folders. `GET /uploads` leaks every user's upload metadata to any authenticated principal. And 1.55 GB of temp files have sat unreaped for 27 days because the cleanup job that would remove them is never scheduled.

### What remains uncertain

Everything requiring a live authenticated upload: the race conditions (UP-S01, UP-009), concurrency behaviour under real load (UP-005's user-visible symptom), socket delivery ordering, and mid-upload interruption handling. These are code-confirmed but not reproduced, and they are labelled as such throughout. The real-world hit rate of the OOXML issue (UP-004) is unverified — the mechanism is reproduced, but there are no Office documents in production to check against. The mobile upload path lives in a separate repository and was only lightly inspected.

### What should be fixed first

**UP-001.** One clause, the largest impact, and it makes every subsequent fix verifiable — right now you cannot distinguish a working upload from a broken one, which makes testing anything else guesswork. Then UP-005 (throughput), then UP-010 (the only P0).

### Is the upload system safe for production use?

**Qualified yes, with one caveat about trust rather than safety.**

Files are stored durably and correctly. Nothing is being lost, corrupted, or made unrecoverable, and the disk leakage is slow against 29 GB of headroom. On the strict question of data safety, the answer is yes.

But the system is **not currently trustworthy from the user's point of view**: it tells users that finished uploads are still processing (100% of image/video uploads, for four weeks), occasionally tells them a successful upload failed, files a small fraction of their media in the wrong library, and shows any signed-in user everyone else's filenames. For a self-hosted product whose promise is "your server, your control", the last of those deserves attention on its own terms.

I would keep it in production and fix UP-001 immediately — the underlying storage is sound, and the headline defect is a one-line change.

---

## Appendix — Evidence artifacts and audit hygiene

**Temporary artifacts created (all outside the repository, except where noted):**

```txt
/tmp/arciin-upload-audit/fixtures/          44 generated test files (no user data)
/tmp/arciin-upload-audit/classify-harness.ts
/tmp/claude-…/scratchpad/audit/q1–q7.sql    read-only SQL
/tmp/claude-…/scratchpad/audit/{typecheck,lint}.log
```

A temporary harness directory `.arciin-upload-audit-tmp/` was created inside the repository to run the classification matrix (the harness needed the project's `@arciin/*` tsconfig path aliases to import production code). **It has been deleted.** `git status` shows the same 32 entries as at audit start — 29 modified and 3 untracked files, all pre-existing.

**Confirmation of read-only compliance:** no application source file was created, modified, or deleted. No commits. No dependencies installed or upgraded. No PM2 service restarted. No database row inserted, updated, or deleted. No Redis key or BullMQ job removed, retried, or modified. No log rotated or deleted. No file ownership or permission changed. No storage path changed. No `.env` change. No real user files used for testing. The only file this audit adds to the repository is this report.

**Privacy:** no passwords, tokens, API keys, cookies, session secrets, or database URLs appear anywhere in this report. `DATABASE_URL` and `REDIS_URL` were compared across services by SHA-256 prefix only. No user email addresses are reproduced. Private filenames are referenced only where a filename extension was necessary to demonstrate a defect (the `.m4a` case), and no full user filename is printed.
