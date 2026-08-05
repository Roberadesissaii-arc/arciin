# Arciin — Sharing and Production Certification (Batch 4)

**Date:** 2026-08-05 · **Branch:** `production-hardening-batch2` · **Base tag:** `v0.1.0-hardening.1`

---

## 1. Overall status

```txt
PRODUCTION CERTIFICATION PARTIALLY COMPLETE
```

I investigated the reported sharing bug, found it was not a bug, and found a genuine data-exposure defect next to it — now fixed, tested, deployed and live-verified. File Requests, UP-007, and the remaining certification phases were not attempted; the scope of this batch is several weeks of work and I would rather report three things done properly than fifteen half-done.

---

## 2. Baseline

| | |
|---|---|
| HEAD at start | `6cf8c32` (`v0.1.0-hardening.1-3-g6cf8c32`) |
| BUILD_ID | `r7XBcrldEXL8MwcOHIQUp` |
| API / web | 200 / 307 |
| Deployment lock | free |
| Shares | 18 total — 4 FOLDER, 14 ASSETS |
| Tests at start | 197 |

---

## 6. Existing folder-share root cause — **the reported bug is not a bug**

The report was: *"Season 2025 shows 0 folders · 0 files even though the folder contains files."*

It does not contain files. From the database:

```
folder:      Season 2025 (cmsf8leo2000otokngloxu0x9)
created:     2026-08-04 22:35:43
shared:      2026-08-04 22:37:06   (2 minutes later)
direct assets:            0
child folders:            0
assets in ANY state:      0   ← never held an asset, not even a deleted one
```

The folder was created, shared two minutes later, and has never contained an asset. **"This folder is empty" is the correct answer.**

I confirmed the mechanism is sound rather than trusting that reading — the public folder query is correct (`parentFolderId`/`folderId` with `deletedAt: null`), and a **live production share of a populated folder returns 74 files**. Folder sharing works.

If you were expecting files in Season 2025, the question to chase is why the *upload into that folder* did not land — not the share. I did not investigate that because no failed upload into that folder exists in the data.

## 7. What the investigation did find — a live data-exposure defect

`resolveShareByToken` checked revoked / expired / view-limit, and **never checked whether the shared root had been deleted.**

Consequence: **deleting a folder did not revoke its public share link.** The link kept listing and serving the folder's surviving files to anyone holding the URL. The same path exposed a trashed asset's metadata through an ASSET share.

**This was live.** One production share pointed at a soft-deleted folder that still held three non-deleted assets, and was still serving them.

Deleting something is the most direct way a person revokes access to it. A share that outlives the delete is a data-exposure bug.

**Fix:** a new pure policy (`checkShareAvailability`) that the resolver now calls. A deleted root returns **NOT_FOUND** — deliberately identical to "never existed", so a recipient cannot learn that content once lived there. Revocation is still reported as REVOKED, checked first. ASSETS shares are untouched: they have no single root and their members are already filtered per-asset.

**Live verification against production** (temporary fixtures, cleaned up afterwards):

| Case | Before fix | After fix |
|---|---|---|
| Live folder share, populated | serves files | **200, 74 files** ✓ |
| Newly created empty folder | empty | **200, 0 files** ✓ |
| **Same share after deleting the folder** | **kept serving files** | **404 NOT_FOUND** ✓ |

**10 unit tests** cover every rule, including that a deleted root and a missing share are indistinguishable.

## 3–5, 8–15, 17–21. Not attempted this batch

| Item | State |
|---|---|
| Playwright authentication fix | **Not done** — 6/8 pass; 3 still fail on login selectors |
| 20/20 Pro refreshes | **Not passed** |
| Free browser gating | Not run |
| **File Requests** (Phases 6–11) | **Not started** — new model, migration, public page, anonymous pipeline, owner review |
| UP-007 / Idempotency-Key | **Not implemented** |
| 114 missing files | Unchanged |
| 974 stale sessions | Unchanged |
| Observability commands | Not built |
| Documentation | Not written |

## 16. Test totals

| Command | Exit | Passed | Failed |
|---|---|---|---|
| `pnpm lint` | **0** | 0 errors, 16 warnings | 0 |
| `pnpm typecheck` | **0** | — | 0 |
| `pnpm test` | **0** | **176** | 0 |
| `pnpm test:integration` | **0** | **35** | 0 |
| `pnpm test:e2e` | 1 | 6 | **3** (auth) |

**211 unit + integration passing** (+14 this batch).

## 22–25. Deployment

| | |
|---|---|
| Commit | `4d8f36e` — `fix(shares): deleting a folder did not revoke its public share link` |
| Restarted | `arciin-api` only, **under the deployment lock** |
| Untouched | worker, web, `arciin-mobile`, `arceclaw`, `arceclaw-tunnel` |
| Health after | **200** |
| BUILD_ID | `r7XBcrldEXL8MwcOHIQUp` (unchanged — API-only change, no web rebuild needed) |

## 26. Rollback

`reports/release-backups/` holds the tracked patch and untracked archive, both secret-scanned. Rollback for this change is a single revert plus `pm2 restart arciin-api`.

## 27. Remaining risks

1. **File Requests do not exist.** No inbound-upload capability was added.
2. **UP-007 unfixed** — ambiguous partial uploads still possible.
3. **No browser test has ever certified the Pro path.**
4. **114 missing files, 974 stale sessions** unchanged.
5. **No documentation.**
6. **`take: 500` on shared-folder assets** — a folder with more than 500 files silently truncates in a share. Latent; the largest shared folder today has 74.
7. The one production share that pointed at a deleted folder is now blocked by the fix, but the `ShareLink` row still exists. Harmless — it 404s — but revoking it would be tidier.

## 28. Production-readiness checklist

| Gate | Result |
|---|---|
| Folder shares show their contents | **PASS** — 74 files, live |
| Empty folder shares render correctly | **PASS** |
| Deleted folder revokes its share | **PASS** — live-verified |
| Expired / revoked links fail | **PASS** |
| Lint / typecheck / unit / integration | **PASS** (211) |
| Deployment lock used | **PASS** |
| Release committed | **PASS** |
| File Requests | **FAIL** — not built |
| Playwright auth / 20 Pro refreshes | **FAIL** |
| UP-007 / Idempotency | **FAIL** |
| Missing files / stale sessions | **FAIL** |
| Observability / documentation | **FAIL** |

## 29. Final user-visible result

| Question | Answer |
|---|---|
| Did 20/20 Pro refreshes pass? | **No — not run.** Playwright auth still unfixed. |
| Was the Pro paywall completely absent? | Unit-proven only; unverified in a browser. |
| Does Free gating still work? | Yes (unit). |
| **Why did Season 2025 show zero files?** | **Because it contains zero files.** Created 22:35:43, shared 22:37:06, never held an asset. |
| Does the existing folder share now show files? | **Yes — verified live: 74 files.** It always did for populated folders. |
| Can recipients upload through File Requests? | **No — the feature does not exist.** |
| Can recipients see the owner's existing files? | Only what the folder share intentionally exposes — and no longer after the folder is deleted. |
| Can recipients see other submissions? | N/A — no submissions feature. |
| Are uploads transactional and idempotent? | **No.** |
| Can Redis fail without losing or duplicating uploads? | **No.** |
| How many missing files were recovered? | **0** — untouched. |
| How many marked missing? | **0.** |
| How were stale sessions resolved? | **Not resolved.** |
| Did all tests pass? | Unit and integration yes (211). Browser: 6/9. |
| Deployed commit | **`4d8f36e`** |
| BUILD_ID | **`r7XBcrldEXL8MwcOHIQUp`** |
| Is production fully certified? | **No.** |

**Recommended next, in order:** fix the Playwright login selectors (3 tests from closing that gate) → File Requests, on top of UP-007 rather than the current upload path → UP-007 itself → the 114 files and 974 sessions → documentation.
