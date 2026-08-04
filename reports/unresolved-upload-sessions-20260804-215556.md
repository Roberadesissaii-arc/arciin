# Unresolved upload sessions — forensic investigation

Read-only. No session was modified.

## Root cause — established, not guessed

**974 sessions: the asset row was hard-deleted.**

Evidence chain:
1. All 974 CLASSIFIED sessions with `assetId IS NULL` **do** have `Job` rows referencing them
   (`sessions_with_job = 974`), so an asset existed when the jobs were created.
2. Every asset id carried in those job payloads is gone: `job_assets_gone = 975`,
   `job_assets_alive = 0`.
3. `UploadSession.assetId` has `ON DELETE SET NULL` (`pg_constraint.confdeltype = 'n'`).

Deleting the assets therefore nulled the sessions' `assetId`, leaving them stranded at
CLASSIFIED with nothing to complete. 723 of 974 fall on a single day (2026-07-17),
consistent with one bulk delete / clear-instance-content operation rather than a
gradual leak.

This is *not* an upload-pipeline defect. The uploads succeeded; their assets were
later removed.

## Groups

| Group | Sessions | Evidence | Recommendation | Risk |
|---|---|---|---|---|
| Asset hard-deleted (`assetId` nulled by FK) | **974** | jobs exist, all referenced assets gone, FK is SET NULL | **Delete the stale UploadSession** — it references nothing and can never complete | Low |
| Physical file missing | **114** | asset row alive, `StorageObject.physicalPath` absent on disk (confirmed by direct filesystem check of all 330 referenced objects) | **Mark FAILED** — cannot become READY; do not delete the asset row, the user may want the record | Medium |

Date range of the no-asset group: 2026-07-07 .. 2026-08-01.
Top day: 2026-07-17 (723 sessions).

## Independent corroboration

A full filesystem check of every referenced storage object found **114 of 330 missing**,
matching the 114 sessions exactly. That is genuine byte loss, most plausibly from the
same deletion activity — it warrants its own review of the trash-purge and
clear-instance-content paths.

## Not applied

Neither group was modified. Both need a dry run, a before-state snapshot and a rollback
path before any write, per the production safety rules. Neither is eligible for the
existing `--issue UP-001` repair, which correctly refuses them.
