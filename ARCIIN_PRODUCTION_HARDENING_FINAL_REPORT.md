# Arciin Production Hardening — Batch 2

**Date:** 2026-08-04 · **Branch:** `production-hardening-batch2` · **Base:** `main` @ `8f4d0ea`

---

## 1. Overall status

```txt
PRODUCTION CERTIFICATION PARTIALLY COMPLETE
```

Three of the four named defects are fixed, tested, deployed and verified against the live instance. The fourth (UP-007, transactional safety) and several later phases are **not done** — I am not going to describe a system as certified when its transactional guarantee is unimplemented and no browser test has ever run.

---

## 2. Executive summary

**Fixed, deployed and verified in production:** UP-010 (upload authorization), UP-004 (Office MIME/extension), UP-006 (scheduled cleanup — **1.48 GB recovered**).

**Established, not guessed:** the 974 stranded upload sessions have a definitive root cause — their assets were hard-deleted, and `UploadSession.assetId` is `ON DELETE SET NULL`. Evidence chain in §10.

**Found while investigating:** **114 of 330 referenced storage objects have no file on disk** — confirmed by directly stat-ing every one. That is real byte loss, and it deserves its own investigation before anything else is built on top of it.

**Not done:** UP-007, browser E2E, documentation, release commits, observability command, recovery drills. Listed honestly in §4.

---

## 3. Finished

| Phase | Item | State |
|---|---|---|
| 1 | Baseline captured before any change | `reports/batch2-baseline-20260804-213100.md` |
| 2 | Working tree backed up (patch + untracked archive), secret-scanned | `reports/release-backups/` |
| 2 | Branch `production-hardening-batch2` created, 128 dirty entries preserved | done |
| 3 | **UP-010** centralized upload authorization + 24 tests | done, verified live |
| 5 | **UP-006** cleanup policy, scheduled repeatable job, integrity scanner + 13 tests | done, 1.48 GB recovered |
| 6 | **UP-004** layered Office detection (OOXML/OpenDocument/CFB) + 20 tests | done, verified live |
| 7 | Historical forensics — root cause established | `reports/unresolved-upload-sessions-20260804-215556.md` |
| 13 | lint 0 errors · typecheck 0 · 147 unit · 35 integration | all pass |
| 14 | Clean build + scoped restart of exactly three services | done |
| 15 | Authenticated production verification of UP-010 and UP-004 | done, keys revoked |

---

## 4. Not finished

| Item | Why | Impact |
|---|---|---|
| **UP-007 transactional safety** | A durable outbox + reconciliation worker is a schema change plus a new worker loop plus failure-injection tests — a batch of its own. I chose to finish three defects properly rather than four badly. | **A Redis failure after `asset.create` can still return HTTP 500 while leaving the asset behind.** Unchanged from the audit. |
| **Idempotency-Key** | Part of UP-007. | A retry after a lost response can still create a duplicate asset. |
| **Browser E2E (Phase 8)** | Playwright not installed; needs browser binaries and a driven session. | Socket reconnect / refresh-during-processing still unverified in a real browser. |
| **Documentation (Phase 12, 8 files)** | Not started. | Docs do not describe the deployed system. |
| **Release commits + CHANGELOG + manifest (Phase 16)** | Not done. Everything remains uncommitted on the branch. | Work is backed up but not committed. |
| **`pnpm ops:upload-health` (Phase 10)** | Not built. | No operator health command. |
| **Recovery drills (Phase 11)** | Not run. | Rollback documented but not exercised. |
| **Security review (Phase 9)** | Only the upload-authorization surface was reviewed. | Other surfaces unassessed. |
| **Historical repair of 974 + 114** | Root cause established; no write applied. | Sessions remain stranded. |

---

## 5. Security findings

**Fixed — 1 (High): UP-010.** `GET /uploads` ran an unscoped `findMany`, so any authenticated principal — VIEWER included, and any API key holding only `uploads:create` — could enumerate the 100 most recent uploads instance-wide with original filenames. `GET /uploads/:id` had no ownership check while its sibling cancel/complete routes did.

Also hardened in passing:
- **Existence oracle closed** — an unauthorized upload id returns **404**, not 403.
- **Filter widening closed** — caller filters are `AND`-ed with the ownership clause, never spread, so a supplied `userId` cannot override it.
- **Renamed-archive confusion closed** — a plain ZIP renamed `.docx` is not promoted to an Office MIME (verified live).
- **Path escape closed in cleanup** — `/…/temp/../objects/x` was accepted by my own first draft of the containment check; a test caught it and it now normalizes before comparing. Symlinks are judged by `lstat` and refused if they escape.
- **No decompression on the classification path** — the ZIP reader parses the central directory only and never inflates, so a zip bomb cannot be triggered by classification.

Not assessed: SVG/HTML/PDF preview isolation, CSP, ffmpeg argument injection, rate limits, Socket.IO room authorization, archive/image bombs in the *worker*. Phase 9 was not completed.

---

## 6. Upload authorization results

Policy lives in one place (`apps/api/src/services/uploads/upload-access.ts`) so the read and mutate paths cannot drift apart again.

| Principal | List | Read by id |
|---|---|---|
| OWNER / ADMIN | instance-wide | any |
| MEMBER | own only | own only |
| VIEWER | own only | own only |
| API key without a read scope | **403** | **404** |
| API key with `assets:read` | capped by owner's role | capped by owner's role |

`uploads:create` is deliberately **not** a read scope: permission to upload is not permission to read everyone's history.

**Verified live** against the deployed API:

```txt
OWNER key + assets:read          → 200, 100 uploads
key with ONLY uploads:create     → 403 FORBIDDEN "missing a required scope"
unknown upload id                → 404 (no existence oracle)
unauthenticated                  → 401
```

**24 unit tests** covering every role, both key shapes, filter widening, and the oracle.

---

## 7. Transaction and idempotency results

**Not implemented.** UP-007 is unchanged: the upload route still performs its writes without a transaction or compensation, so a Redis failure after `asset.create` returns HTTP 500 while the asset persists, and a client retry after a lost response can still duplicate an asset.

The failure-injection matrix in Phase 4 was not run. This is the single largest outstanding item.

---

## 8. Cleanup and recovered disk space

| | |
|---|---|
| Before | 2 files, **1.5 GB**, 27 days old |
| After | 0 files, **4.0 KB** |
| **Recovered** | **1,480.7 MB** |
| Disk available | 33 GB → **35 GB** |

The decision is a pure, unit-tested policy (`planTempCleanup`) — the worker and the script both call it, and only delete what it returns. Retention defaults to 24 h (`ARCIIN_TEMP_MAX_AGE_HOURS`). Files that are fresh, in-flight, outside the temp root, reached via an escaping symlink, or have a future mtime are all retained with a recorded reason.

**Scheduled**: a BullMQ repeatable job keyed `arciin:cleanup-temp-files` runs hourly. Confirmed registered in production Redis. The fixed key makes registration idempotent — restarting or running several workers installs it once.

Orphaned storage objects (29, 19.6 MB) are **report-only**. A content-addressed object may be referenced by a row the scan cannot see, so `--apply` accepts `--issue temp` and nothing else.

---

## 9. Office-document results

Layered detection: container → entry names → filename corroboration. Entry names come from the file itself, so a renamed archive cannot fake them.

**Verified live** (real uploads through the deployed API):

| File | mediaType | ext | Library | MIME |
|---|---|---|---|---|
| `real.docx` | DOCUMENT | **docx** | documents | `…wordprocessingml.document` |
| `real.xlsx` | DOCUMENT | **xlsx** | documents | `…spreadsheetml.sheet` |
| `real.pptx` | DOCUMENT | **pptx** | documents | `…presentationml.presentation` |
| `real.odt` | DOCUMENT | **odt** | documents | `…opendocument.text` |
| **`fake.docx`** (plain ZIP renamed) | DOCUMENT | **zip** | documents | `application/zip` — **not promoted** |
| `corrupt.docx` | DOCUMENT | docx | documents | `…wordprocessingml.document` |

`corrupt.docx` resolves to `docx` because `file-type` reads OOXML from the intact local headers at the file's start — the container reader is never reached. That is correct, and I corrected my own test expectation rather than the code when I first got it wrong.

Legacy CFB (`.doc`/`.xls`/`.ppt`) is named from the filename, since one compound-file header is shared by all of them — and an unknown CFB (e.g. `.msi`) is deliberately left alone so installers stay applications.

**20 unit tests.** Production currently holds **0** Office documents, so no historical rewrite was needed; a dry-run script for existing records was not written.

---

## 10. Historical-session findings

**Root cause established.**

| Group | Sessions | Recommendation |
|---|---|---|
| **Asset hard-deleted** — `assetId` nulled by the FK | **974** | Delete the stale session; it references nothing |
| **Physical file missing** | **114** | Mark FAILED; never READY |

Evidence for the 974:
1. All 974 **do** have `Job` rows → an asset existed when the jobs were created.
2. Every asset id in those payloads is gone: `job_assets_gone = 975`, `job_assets_alive = 0`.
3. `UploadSession.assetId` is `ON DELETE SET NULL` (`confdeltype = 'n'`).

Deleting the assets nulled the reference and stranded the sessions. **723 of 974 fall on 2026-07-17**, consistent with one bulk delete rather than a gradual leak. This is not an upload-pipeline defect — the uploads succeeded and their assets were later removed.

**Neither group was modified.** Both need a dry run, snapshot and rollback path first.

---

## 11. Browser E2E results

**Not run.** Playwright is not installed. Socket disconnect/reconnect, refresh-during-processing, and duplicate-toast behaviour remain verified only by unit and integration tests.

---

## 12. API E2E matrix

Office matrix in §9; authorization matrix in §6. The 15-file classification matrix from the previous batch was **not** re-run — the classification path changed only for ZIP/CFB containers, which §9 covers directly. XLSX/PPTX and the renamed-ZIP case were added and pass. Idempotency-Key cases were not run (feature not implemented).

---

## 13. Automated test totals

| Command | Exit | Files | Passed | Failed |
|---|---|---|---|---|
| `pnpm lint` | **0** | — | 0 errors, 16 warnings | 0 |
| `pnpm typecheck` | **0** | 9 projects | — | 0 |
| `pnpm test` | **0** | 11 | **147** | 0 |
| `pnpm test:integration` | **0** | 4 | **35** | 0 |
| `pnpm build:web` | **0** | — | — | 0 |

**182 automated tests, all passing** (+54 added this batch: 24 authorization, 20 Office, 13 cleanup, less overlap).

Two lint errors had to be fixed twice: concurrent work reverted my earlier `chat-prompt-box.tsx` fix and added a new *refs-during-render* error via the slash-command feature. Both are now fixed properly — caret position tracked from events instead of read off a ref during render, and two derived-state resets moved out of effects.

---

## 14. Performance results

**Not re-measured this batch.** The previous batch measured 20 mixed files in 3.7 s with the same worker configuration, which Batch 2 did not change. Office uploads observed inline: 60–159 ms per request.

---

## 15. Deployment details

| | |
|---|---|
| Deployed commit | **none — uncommitted** on `production-hardening-batch2` |
| BUILD_ID before | `SIxuIQ_S_mCrt2PsP_8n8` |
| **BUILD_ID after** | **`63if7U-rdzxiAX4lHxRsY`** |
| Command | `ARCIIN_ENV_NAMESPACE=production pnpm build:web` (exit 0) |
| Restarted | `arciin-api`, `arciin-worker`, `arciin-web` only |
| Untouched | `arciin-mobile`, `arceclaw`, `arceclaw-tunnel` (restarts still 2) |
| Health | `/api/health` **200** in 4 ms · web 307 |
| Worker heartbeat | 1.4 s, production key |
| Queue | waiting 0, active 0, delayed 0 |
| `bull-dev:*` in production Redis | **0** |
| Maintenance schedule | `arciin:cleanup-temp-files` registered |
| PM2 restarts | api 43→44, worker 4→5, web 4→5 |

Isolation held under real conditions: two dev servers were running on port 3100 writing to `.next-dev` during the production build, and the production BUILD_ID was unaffected.

---

## 16–18. Documentation, files changed, database

**Documentation: none written.** Phase 12 not started.

**Batch 2 files — new:** `apps/api/src/services/uploads/upload-access.ts` · `packages/shared/src/office-documents.ts` · `packages/shared/src/temp-cleanup-policy.ts` · `packages/storage/src/read-zip-entries.ts` · `scripts/storage-integrity-scan.ts` · `tests/{upload-access,office-documents,temp-cleanup-policy}.test.ts`

**Batch 2 files — modified:** `apps/api/src/modules/uploads/routes.ts` · `apps/api/src/services/classification/media-classification.ts` · `apps/worker/src/{index.ts,processors/worker-handlers.ts}` · `packages/config/src/{env.ts,job-options.ts}` · `packages/{shared,storage}/src/index.ts` · `apps/web/components/chat/chat-prompt-box.tsx`

**Earlier batches and unrelated concurrent work:** preserved untouched (trash feature, chat/AI, skeletons, dashboard/toast files). Nothing was reverted; no `git reset`, no `git clean`.

**Database: no migration added.** No schema change. Data written: 6 Office test assets. 1,480.7 MB of temp files deleted (no database row touched).

---

## 19–20. Data repairs, backups, rollback

**No historical data repair applied this batch.** The only deletion was 1.48 GB of stale temp files, judged by unit-tested policy, manifested beforehand.

| Artifact | Path |
|---|---|
| Baseline | `reports/batch2-baseline-20260804-213100.md` |
| Working-tree patch (binary-safe) | `reports/release-backups/worktree-tracked-20260804-213100.patch` |
| Untracked archive (no secrets) | `reports/release-backups/untracked-20260804-213100.tar.gz` |
| BUILD_ID before | `reports/release-backups/build-id-before-batch2.txt` |
| Storage scan manifests | `reports/storage-scan-*.json` |
| Forensics | `reports/unresolved-upload-sessions-20260804-215556.md` |

Both backups were scanned and confirmed free of `.env`, `.env.development`, and key material.

---

## 21. Remaining risks

1. **UP-007 unfixed** — a Redis failure after `asset.create` still returns 500 with the asset left behind; retries can still duplicate.
2. **114 storage objects have no bytes on disk** — 35% of live assets. Real loss, cause not established.
3. **974 stranded sessions** — root cause known, not repaired.
4. **Nothing is committed.** Backed up, but a `git checkout` would destroy the work.
5. **No browser test has ever run** against this UI.
6. **Documentation does not describe the deployed system.**
7. **`arciin-api` carries 44 lifetime restarts** — historical, stable since deployment.
8. Phase 9 security review incomplete beyond the authorization surface.

---

## 22. Production-readiness checklist

| Gate | Result |
|---|---|
| Git status / release commit | **FAIL** — uncommitted |
| Lint | **PASS** (0 errors) |
| Typecheck | **PASS** |
| Unit tests | **PASS** (147) |
| Integration tests | **PASS** (35) |
| Browser E2E | **BLOCKED** — not installed |
| Build | **PASS** |
| Migration status | **PASS** — up to date |
| Backup | **PASS** |
| Rollback | **PASS** (documented, not drilled) |
| PM2 status | **PASS** — 3 restarted, 3 untouched |
| Health | **PASS** — 200 |
| Upload smoke test | **PASS** — Office + authorization |
| Queue drain | **PASS** |
| Worker heartbeat | **PASS** |
| Disk capacity | **PASS** — 35 GB, 1.48 GB recovered |
| Auth checks | **PASS** |
| Cleanup scheduler | **PASS** |
| Observability | **FAIL** — not built |
| Temporary credential revocation | **PASS** — revoked and deleted |

---

## 23. Final user-visible result

| Question | Answer |
|---|---|
| Are uploads safe? | **Yes for content, not fully for failure handling.** Files store correctly; a Redis failure mid-request can still leave an asset behind with a 500 (UP-007). |
| **Are uploads private between users?** | **Yes — fixed and verified live.** MEMBER/VIEWER see only their own; a `uploads:create`-only key gets 403; unknown ids get 404. |
| Are retries idempotent? | **No.** Not implemented. |
| Can Redis failure leave partial uploads? | **Yes.** UP-007 unfixed. |
| Are temporary files cleaned automatically? | **Yes.** Hourly repeatable job, 24 h retention, 1.48 GB already recovered. |
| Do Office files keep the correct extension and MIME? | **Yes — verified live** for docx/xlsx/pptx/odt, and a renamed ZIP is correctly *not* promoted. |
| Do socket reconnect and page refresh recover correctly? | **Unverified in a browser.** Covered by unit/integration tests only. |
| Are counts and pagination accurate? | **Yes** (previous batch; unchanged). |
| Is performance acceptable? | **Yes** (previous batch: 20 files in 3.7 s; unchanged). |
| Can the system be rolled back safely? | **Partly.** Artifacts exist and are verified; the drill was not run and there is no release commit to roll back *to*. |
| Is production running a committed, documented release? | **No.** Deployed from an uncommitted working tree, undocumented. |

**Recommended next batch, in order:** commit the release → UP-007 with failure injection → investigate the 114 missing files → repair the 974 → Playwright → documentation.
