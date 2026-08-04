# Arciin Final Production Certification — Batch 3

**Date:** 2026-08-04 · **Branch:** `production-hardening-batch2` · **Base:** `main` @ `8f4d0ea`

---

## 1. Overall status

```txt
PRODUCTION CERTIFICATION PARTIALLY COMPLETE
```

The Pro entitlement defect — Batch 3's headline — is root-caused, fixed, tested and deployed. Most of the remaining phases are not done, and I will not describe a system as certified when its transactional guarantee is unimplemented, no browser test has ever run, and the release is uncommitted.

---

## 2. Pro-glitch root cause

**Reproduced in code and pinned by tests. Not reproduced in a browser** — see §5 for why that matters.

The defect was in `apps/web/lib/license/use-license.ts`:

```ts
const confirmed = query.isSuccess && !!query.data

function hasFeature(feature) {
  if (!confirmed) {
    return planHasFeature("free", feature)   // ← the bug
  }
  return featureSet.has(feature)
}
```

Three different situations collapsed into one boolean:

| Situation | Old result | Correct result |
|---|---|---|
| Not asked yet | **free** | verifying |
| Request **failed** | **free** | keep last confirmed answer |
| Server said Free | free | free |

`FeatureGate` then rendered `PlanRequiredMessage` whenever `hasFeature` was false and it was outside its narrow `loading && !status` skeleton window. So **any entitlement request failure — timeout, 500, transient 401 during session hydration, offline — downgraded a paying Pro user and rendered the "Upgrade to Pro" screen over their interface.** That is precisely the reported symptom.

The comment above the code said *"Until confirmed: free matrix only — never flash paid UI from stale cache."* It was guarding against the opposite risk (Free briefly seeing Pro) and paid for it with the Pro→Free flash.

**Second defect found in the same file — a cross-user entitlement leak.** The cache key was global:

```ts
const LICENSE_CACHE_KEY = "arciin-license-status-v1"   // not scoped by user
```

and the query key `["license","status"]` was equally unscoped. A Pro user's status survived logout in `localStorage` and seeded the *next* user's first render, so a Free user could briefly see the Pro interface. Display-only (the API enforces independently), but wrong.

**Instance context:** this instance is on an active **Pro** plan (`licensePlan=pro`, `status=active`, `source=hosted`, expires **2026-08-08** — four days out, worth watching).

---

## 3. Entitlement architecture

New single source of truth: `packages/config/src/entitlement-state.ts` — pure, framework-free, fully unit-tested.

```
InstanceConfig.licensePlan  (database, authoritative)
        ↓
GET /api/license/status     (API — enforces independently)
        ↓
useLicense()                (maps query → EntitlementState)
        ↓
decideEntitlement()         (one decision function)
        ↓
FeatureGate                 (Pro UI · stable shell · paywall)
```

```ts
type EntitlementState =
  | { status: "unknown" }
  | { status: "loading"; previous?: EntitlementSnapshot }
  | { status: "resolved"; snapshot: EntitlementSnapshot }
  | { status: "error"; errorCode: string; previous?: EntitlementSnapshot }
```

**The invariant:** a paywall requires a *resolved* snapshot that genuinely lacks the feature. A test asserts this exhaustively — of nine representative states, exactly one produces a paywall.

A 12-hour grace window lets a previously confirmed answer drive the UI while the server is unreachable; past that it reverts to *verifying*, never to a false "Free". Backend authorization is unaffected throughout.

---

## 4. UI state transitions

| State | Paywall | UI |
|---|---|---|
| unknown | never | stable verifying shell |
| loading (cold) | never | stable verifying shell |
| loading (prior Pro) | never | **Pro interface stays mounted** — no teardown on refresh |
| resolved + has feature | never | Pro interface |
| **resolved + lacks feature** | **yes** | paywall — the only path |
| error + prior Pro in grace | never | Pro interface, `degraded: true` |
| error + prior expired/none | never | verifying shell |

`FeatureGate` now branches on `shouldPaywall()` rather than `!hasFeature()`, so the upgrade screen cannot render while verifying or after a failure.

---

## 5. Pro browser results

**Not run. This is the main reason certification is withheld.**

Phase 3 requires 20 hard refreshes with screenshots and traces, and states "Do not call it fixed until the exact cause is reproduced". I reproduced the cause **deterministically in unit tests against the real decision logic**, which is stronger than a screenshot for *this* bug — a test proves the error-state branch returns Pro, where a screenshot only shows it did not flash on that run. But it is not the browser evidence the phase asked for.

Blockers: Playwright is not installed, and I have no Pro/Free test-account credentials. Creating end-user accounts and driving a browser session is not something I should do unilaterally against a live instance.

## 6. Free browser results

**Not run**, same blockers. Free gating is covered by unit tests: a resolved Free snapshot is the one and only state that produces a paywall.

## 7. Network-failure results

Covered by unit tests, not by a browser:

| Condition | Result |
|---|---|
| Timeout / 500 / 401 / offline, prior Pro | **No paywall**, Pro retained, `degraded: true` |
| Failure with no prior answer | **No paywall**, verifying shell |
| Failure with prior answer past grace | **No paywall**, back to verifying |
| Unparseable `verifiedAt` | Not trusted — verifying |

## 8–9. Upload transactions and idempotency

**UP-007 remains unimplemented.** A Redis failure after `asset.create` still returns HTTP 500 with the asset persisted, and a retry after a lost response can still duplicate an asset. No `Idempotency-Key`, no outbox, no reconciliation worker. Unchanged from Batch 2 and still the largest outstanding item.

## 10. Missing-file findings

**Not investigated further this batch.** Batch 2 established by direct filesystem check that **114 of 330 referenced storage objects have no bytes on disk** (35% of live assets). No per-record forensics, no recovery attempt, no status change. `reports/missing-storage-forensics-*` was not produced.

## 11. Historical-session actions

**No action taken.** Batch 2 established the root cause: the assets were hard-deleted and `UploadSession.assetId` is `ON DELETE SET NULL`, which stranded 974 sessions at CLASSIFIED (723 on a single day). 114 more have missing files. Neither group was modified — both need a dry run, snapshot and rollback path first.

## 12. Browser E2E totals

**0 tests. Playwright not installed.**

## 13. Unit / integration totals

| Command | Exit | Files | Passed | Failed |
|---|---|---|---|---|
| `pnpm lint` | **0** | — | 0 errors, 16 warnings | 0 |
| `pnpm typecheck` | **0** | 9 projects | — | 0 |
| `pnpm test` | **0** | 12 | **162** | 0 |
| `pnpm test:integration` | **0** | 4 | **35** | 0 |
| `pnpm build:web` | **0** | — | — | 0 |

**197 automated tests, all passing** (+15 this batch, all entitlement).

Three lint errors were fixed en route, two of them from concurrent work that landed during this batch:
- `use-license.ts` — **mine**: `Date.now()` called during render (impure read). Removed; `dataUpdatedAt` is always set when data exists.
- `chat-prompt-box.tsx` — a new setState-in-effect from the slash-menu scroll hints. The closed-menu case is now derived rather than written into state.

## 14. Security findings

**Fixed this batch — 1 (Medium): cross-user entitlement cache leak.** The `localStorage` key and the query key are now scoped by user id (`…-v2:<userId>`, `["license","status",userId]`), and logout removes both the `license` query cache and every `arciin-license-status*` key.

Unchanged and still open from earlier batches: UP-007 partial-write ambiguity. Phase 9's broader surface review (SVG/HTML/PDF preview isolation, CSP, ffmpeg argument injection, archive/image bombs, Socket.IO room authorization) was **not** performed.

Worth stating plainly: this fix is presentation-only. It cannot grant Pro access — the API validates entitlements on every premium call, so editing `localStorage` still buys nothing.

## 15. Performance

**Not measured this batch.** Nothing in the changed paths affects upload throughput; the Batch 2 figures (20 mixed files in 3.7 s; health median 2.8 ms) stand.

## 16. Documentation

**None written.** All 13 documents remain outstanding.

## 17–20. Deployment

| | |
|---|---|
| Deployed commit | **none — uncommitted** |
| BUILD_ID before | `epTMhmTMi62dCXCkUB3n0` |
| **BUILD_ID after** | **`LSzcGgoo_kVkurKlwMHwz`** |
| Command | `ARCIIN_ENV_NAMESPACE=production pnpm build:web` (exit 0) |
| Restarted | `arciin-api`, `arciin-worker`, `arciin-web` only |
| Untouched | `arciin-mobile`, `arceclaw`, `arceclaw-tunnel` (restarts 2) |
| Health | **200** |
| PM2 | api 47, worker 8, web 8 — all online |

**Concurrent deploys are happening.** BUILD_ID moved twice during this batch without my involvement (`zrbZ3k7dSyavtgyKf8sqi` → `epTMhmTMi62dCXCkUB3n0` before my build). Someone else is building and restarting this instance.

## 21. Rollback artifacts

| Artifact | Path |
|---|---|
| Working-tree patch | `reports/release-backups/worktree-tracked-20260804-213100.patch` |
| Untracked archive | `reports/release-backups/untracked-20260804-213100.tar.gz` |
| BUILD_ID before Batch 2 / 3 | `reports/release-backups/build-id-before-batch{2,3}.txt` |
| Batch 2 baseline | `reports/batch2-baseline-20260804-213100.md` |
| Forensics | `reports/unresolved-upload-sessions-20260804-215556.md` |
| Storage scans | `reports/storage-scan-*.json` |

Backups predate Batch 3's edits — a fresh capture should be taken before the next change.

## 22. Remaining risks

1. **No browser has ever exercised this UI.** The entitlement fix is proven by unit tests only.
2. **UP-007 unfixed** — ambiguous partial uploads remain possible.
3. **114 storage objects have no bytes.** Cause unknown.
4. **974 stranded sessions** — cause known, unrepaired.
5. **Nothing is committed.** Backed up, but a `git checkout` destroys it.
6. **Documentation absent.**
7. **The Pro licence expires 2026-08-08** — four days out. If it lapses, the new code correctly shows the paywall, which will look like a regression but is not.
8. Concurrent deploys mean production may not match what I tested.

## 23. Production-readiness checklist

| Gate | Result |
|---|---|
| Pro refresh never flashes paywall | **PASS (unit)** / **BLOCKED (browser)** |
| Free gating correct | **PASS (unit)** |
| Entitlement failure recovery | **PASS (unit)** |
| Cross-user entitlement leak closed | **PASS** |
| Browser E2E | **BLOCKED** — Playwright absent, no test accounts |
| UP-007 | **FAIL** — not implemented |
| Idempotency | **FAIL** — not implemented |
| Missing files handled | **FAIL** — investigated only |
| Stale sessions resolved | **FAIL** — investigated only |
| Documentation | **FAIL** |
| Observability commands | **FAIL** |
| Lint / typecheck / unit / integration | **PASS** (197) |
| Build | **PASS** |
| Deployed from committed release | **FAIL** — uncommitted |
| Health / PM2 scope | **PASS** |

## 24. Final user-visible result

| Question | Answer |
|---|---|
| Was the Pro flash reproduced? | **In code and unit tests, yes. In a browser, no.** |
| What caused it? | `!confirmed → free feature matrix`, so a failed or pending entitlement request downgraded a paying user; `FeatureGate` then rendered the paywall. Plus an unscoped cache that leaked plan state between users. |
| Was it fixed? | **Yes** — explicit five-state machine, paywall reachable from exactly one state, identity-scoped cache, logout clears it. Deployed. |
| Did 20/20 Pro refresh tests pass? | **Not run** — no Playwright, no Pro test account. |
| Did the paywall stay hidden for Pro? | **Proven for every non-authoritative state by test**; not observed in a browser. |
| Did Free gating still work? | **Yes** — a resolved Free snapshot is the one state that paywalls. |
| Is UP-007 fixed? | **No.** |
| Are retries idempotent? | **No.** |
| What happened to the 114 missing files? | Nothing. Confirmed real; not investigated per-record. |
| What happened to the 974 stale sessions? | Nothing. Root cause known; unrepaired. |
| Are all docs complete? | **No — none written.** |
| Is production running a committed release? | **No.** |

**Recommended next batch, in order:** commit the release (highest risk right now is losing this work) → install Playwright and obtain Pro/Free test accounts to close the browser gap → UP-007 with failure injection → the 114 missing files → the 974 sessions → documentation.
