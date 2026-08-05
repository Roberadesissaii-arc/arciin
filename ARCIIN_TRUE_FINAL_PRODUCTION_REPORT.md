# Arciin — True Final Production Report

**Date:** 2026-08-04 · **Branch:** `production-hardening-batch2` · **Tag:** `v0.1.0-hardening.1`

---

## 1. Overall status

```txt
PRODUCTION CERTIFICATION PARTIALLY COMPLETE
```

The release is now **committed, tagged, deployed and verified**, which was the single largest outstanding risk. Browser certification and UP-007 remain unimplemented, so certification is not claimable.

---

## 2. Executive summary

I prioritised by risk rather than by phase order. Three batches of production work existed only in the working tree — a `git checkout` would have destroyed all of it, and production could not be pinned to any commit. That is now fixed: **9 logical commits, a clean tree, a tag, a manifest, and production running the exact committed code.**

Along the way I found and closed a live production hazard: **a concurrent `pnpm build` took the site down while I was capturing the baseline.** `next start` serves out of `apps/web/.next` and `next build` rewrites it in place, so the running site served a half-written directory — HTTP 500, "client reference manifest for route / does not exist", no BUILD_ID. It self-recovered when the build finished. A deployment lock now makes that collision fail loudly instead of corrupting the build.

Not done: Playwright, UP-007, the 114 missing files, the 974 stale sessions, documentation, ops commands, recovery drills. Listed plainly in §27.

---

## 3. Baseline

| | |
|---|---|
| Branch / HEAD at start | `production-hardening-batch2` @ `8f4d0ea` |
| Dirty entries | **148** |
| Diffstat | 103 files, +4,292 / −1,134 |
| BUILD_ID | **missing** — concurrent build in flight |
| API / web health | 200 / **500** |
| Worker heartbeat | 1.4 s |
| Queue | wait 0, active 0, delayed 0, completed 96, failed 23 |
| UploadSession | READY 833 · CLASSIFIED 1,088 · FAILED 16 |
| Orphan storage objects | 29 |
| Temp dir | 4 KB (cleanup working) |
| Disk | 35 GB free |
| Migrations | up to date |
| Ports | :3002 prod web · :4000 prod api · :3100 free · :4100 **dev api (correctly isolated)** |
| Dev stacks | 2 running, all `ARCIIN_ENV_NAMESPACE=dev` on isolated ports — **isolation holding** |

## 4–6. Pro browser, Free gating, entitlement failure results

**Not run. Playwright was not installed and no browser test ran.**

The entitlement fix from the previous batch is deployed and covered by 15 unit tests, including an exhaustive assertion that of nine representative states exactly one produces a paywall. That is strong evidence for the decision logic and **no evidence at all** about what a browser renders. I am not going to convert unit results into browser claims.

## 7–10. Transaction design, idempotency, outbox, failure injection

**UP-007 is not implemented.** No transaction, no outbox table, no `Idempotency-Key`, no dispatcher, no reconciliation, no failure-injection tests. A Redis failure after `asset.create` still returns HTTP 500 with the asset persisted, and a retry after a lost response can still duplicate an asset. This is the largest outstanding technical item.

## 11–12. Missing files and stale sessions

**No action taken on either.** Both remain as previously established:

- **114 of 330** referenced storage objects have no bytes on disk (confirmed by stat-ing every one).
- **974 sessions** stranded at CLASSIFIED because their assets were hard-deleted and `UploadSession.assetId` is `ON DELETE SET NULL`. Evidence: all 974 have Job rows, all 975 referenced asset ids are gone, FK `confdeltype = 'n'`. 723 fall on a single day.

Per-record forensics and the maintenance script were not written.

## 13–14. Test totals

| Command | Exit | Files | Passed | Failed |
|---|---|---|---|---|
| `pnpm lint` | **0** | — | 0 errors, 16 warnings | 0 |
| `pnpm typecheck` | **0** | 9 projects | — | 0 |
| `pnpm test` | **0** | 12 | **162** | 0 |
| `pnpm test:integration` | **0** | 4 | **35** | 0 |
| `pnpm build:web` | **0** | — | — | 0 |
| **Browser E2E** | — | **0** | **0** | — |

**197 automated tests, all passing**, re-verified against the committed tree.

## 15. Security results

Nothing new this batch. Previously fixed and still deployed: upload-history authorization (UP-010), the cross-user entitlement cache leak, path-escape in temp cleanup, and refusal to promote a renamed archive to an Office MIME. The broader surface review (preview isolation, CSP, ffmpeg argument injection, archive bombs, Socket.IO room authorization) remains outstanding.

## 16–17. Observability and recovery drills

**Neither done.** No `ops:*` commands; no drills run.

## 18. Documentation

**None written.** All 14 documents remain outstanding.

## 19–20. Data migrations and repairs

**No migration added this batch** (a `prisma/schema.prisma` change from concurrent work was committed along with its migration; migrations report up to date). **No data repair applied.**

## 21. Performance

**Not measured this batch.** Nothing changed in the upload path. Batch 2 figures stand: 20 mixed files in 3.7 s; health median 2.8 ms.

## 22–25. Deployment, commit, BUILD_ID, PM2

| | |
|---|---|
| **Release tag** | **`v0.1.0-hardening.1`** |
| **Deployed commit** | **`1f2583b8099b8dfe2644d457c923bd834b3c458e`** |
| HEAD (incl. manifest) | `83a8320` |
| **BUILD_ID** | **`z2QBaY3S_CdS6HkYTUQmF`** (was `k8XRHndjrNjbfKRYJ21QJ`) |
| Working tree | **clean — 0 changes** |
| Build | `ARCIIN_ENV_NAMESPACE=production pnpm build:web`, **under the deployment lock** |
| Restarted | `arciin-api`, `arciin-worker`, `arciin-web` only |
| Untouched | `arciin-mobile`, `arceclaw`, `arceclaw-tunnel` — restarts still 2 |
| Health | API **200** in 4.4 ms · web 307 |
| Worker heartbeat | 8.9 s, production key |
| Queue | drained (wait 0, active 0) |
| `bull-dev:*` in prod Redis | **0** |
| Lock after deploy | released |
| PM2 restarts | api 49 · worker 10 · web 10 |

### The 9 commits

```
83a8320 chore(release): add release manifest for v0.1.0-hardening.1
1f2583b chore: commit concurrent in-flight work already running in production
e44c59c docs(reports): add diagnostic, repair and certification reports
d77bd1d feat(deploy): add a deployment lock
cc944d7 test: add a working test runner and 197 tests
5c37880 fix(entitlements): a failed license request showed paying users the paywall
491eecb fix(security,storage): scope upload history, identify Office files, schedule cleanup
859ca5b feat(env): isolate development from production
be83791 fix(libraries): sidebar counts showed files the library page could not display
3214d32 fix(uploads): uploads never reached READY — completedAt meant two different things
```

**`1f2583b` needs your attention.** It contains ~75 files of concurrent work — Trash, chat/AI composer, dashboard, toasts, password vault, storage discovery, a schema change — that I did not author or review. It was already deployed and serving traffic, so the release could not be pinned without it. The commit message says so explicitly. If you would rather it were split out or rewritten, the tree is clean and the history is local, so that is straightforward.

**Nothing was pushed.** No remote authorization was given.

## 26. Backups and rollback

| Artifact | Path |
|---|---|
| Binary-safe patch of all tracked changes | `reports/release-backups/final-20260804-223059/tracked.patch` |
| Untracked source archive (secret-scanned) | `reports/release-backups/final-20260804-223059/untracked.tar.gz` |
| Previous BUILD_IDs | `reports/release-backups/build-id-before-batch{2,3}.txt` |
| Release manifest | `reports/release-manifest-v0.1.0-hardening.1.json` |
| Earlier snapshots and scans | `reports/` |

Both backups were scanned for `SESSION_SECRET`, `DATABASE_URL`, API keys and private keys — clean. Rollback: `git checkout <previous-commit> && ARCIIN_ENV_NAMESPACE=production pnpm build:web && pm2 restart arciin-api arciin-worker arciin-web`.

## 27. Remaining risks

1. **No browser has ever exercised this UI.** The Pro fix is unit-proven only.
2. **UP-007 unfixed** — ambiguous partial uploads remain possible.
3. **114 storage objects have no bytes.** Cause unknown.
4. **974 stranded sessions** — cause known, unrepaired.
5. **Documentation absent.**
6. **`1f2583b` bundles unreviewed concurrent work.**
7. **The Pro licence expires 2026-08-08.** When it lapses the new code will correctly show the paywall; that will look like a regression and will not be one.
8. **Concurrent activity continues** — dev stacks are running (correctly isolated) and someone ran a full `pnpm build` mid-baseline. The lock protects deployments from *now on*; it cannot retroactively serialise anything already in flight.

## 28. Production-readiness checklist

| Gate | Result |
|---|---|
| Release committed | **PASS** |
| Production matches committed release | **PASS** |
| Release tag + manifest | **PASS** |
| Working tree clean | **PASS** |
| Deployment lock | **PASS** — concurrent attempt tested and refused |
| Lint / typecheck / unit / integration | **PASS** (197) |
| Build | **PASS** |
| Health / PM2 scope | **PASS** |
| Backups + rollback | **PASS** (documented, not drilled) |
| Migration status | **PASS** |
| 20/20 Pro browser refreshes | **BLOCKED** — Playwright not installed |
| Free browser gating | **BLOCKED** |
| Entitlement offline/failure in browser | **BLOCKED** |
| UP-007 | **FAIL** |
| Idempotency-Key | **FAIL** |
| Redis-failure outbox recovery | **FAIL** |
| 114 missing files handled | **FAIL** |
| 974 stale sessions resolved | **FAIL** |
| Observability commands | **FAIL** |
| Documentation | **FAIL** |
| Recovery drills | **FAIL** |

## 29. Final user-visible result

| Question | Answer |
|---|---|
| Did 20/20 Pro refresh tests pass? | **Not run.** No browser test exists. |
| Did the Pro paywall remain hidden? | **Unit-proven for every non-authoritative state; not observed in a browser.** |
| Did Free gating still work? | **Yes** (unit) — a resolved Free snapshot is the only state that paywalls. |
| Is UP-007 fixed? | **No.** |
| Are retries idempotent? | **No.** |
| Can Redis fail without losing or duplicating an upload? | **No.** |
| How many missing files were recovered? | **0** — not investigated this batch. |
| How many marked missing/failed? | **0.** |
| How were the 974 stale sessions resolved? | **Not resolved.** Root cause established only. |
| Did all Playwright tests pass? | **No suite exists.** |
| Are all documents complete? | **No — none written.** |
| Deployed commit hash | **`1f2583b8099b8dfe2644d457c923bd834b3c458e`** |
| BUILD_ID | **`z2QBaY3S_CdS6HkYTUQmF`** |
| Is production running the committed release? | **Yes** — clean tree, tagged, manifest recorded. |
| Are API, worker and web healthy? | **Yes** — 200, fresh heartbeat, drained queue, no restart loop. |

**Recommended next, in order:** Playwright + Pro/Free fixtures (closes the headline gate) → UP-007 with failure injection → the 114 missing files → the 974 sessions → documentation.
