# Upload recovery: assets whose bytes are missing

How to diagnose and repair assets that exist in the database but not on disk,
plus the record of the 2026-08-12 run.

Tooling: `scripts/repair-missing-assets.mjs` (dry run by default). Operational
context: [`OPERATIONS.md`](./OPERATIONS.md).

---

## The 2026-08-12 repair

## Finding

115 of 647 live assets (17.8%) had a database row marked `READY` but **no file on
disk**. The UI therefore offered downloads that 404 and thumbnails that resolved
to nothing, with no explanation to the user.

| | |
|---|---|
| Affected | 115 assets — 114 IMAGE, 1 DOCUMENT |
| Library | all in `images` |
| Created | 114 in 2026-07, 1 in 2026-06 |
| Status before | `READY` (all 115) |
| Distinct storage objects | 114 |

## Root cause

Emptying the trash deleted storage objects that other, still-live assets
referenced. Fixed in `37ded9d` (2026-08-10, *"emptying trash deleted originals
still in use; serve cached thumbs"*). These 115 are that bug's victims, all
predating the fix.

Corroborating evidence: **114 of the 115 still have thumbnails on disk.** The
files existed and were fully processed — the originals were removed afterwards,
which is exactly the shape of the trash bug rather than a failed upload.

## Recovery attempt

Searched by SHA-256 across every location that could hold an original:

- 5 backup snapshots (`arciin-backups/*/storage/objects`)
- dev storage root
- library mirrors (Plex/Jellyfin) — 0 of the 115 had a mirror path
- `temp/` and `libraries/` under the storage root

561 distinct checksums indexed. **0 of 115 matched.** The bytes were already gone
when the earliest snapshot was taken, so no backup contains them.

## Action taken

All 115 marked `FAILED` with:

> Original file missing from storage. Lost before the 2026-08-10 trash fix, which
> allowed emptying the trash to delete objects still referenced by live assets.
> No copy was found in backups; re-upload to restore.

Deliberately **not** done:

- **Thumbnails were not written back as originals.** A 400px WebP is not the
  photograph someone uploaded; substituting one turns missing data into wrong
  data, which is the worse failure.
- **Asset rows were not deleted.** The filename, size, timestamps and thumbnail
  are the only surviving record that the file existed, and the owner may want to
  re-upload against it.
- **Nothing was marked READY.**

## Verification

```
live assets                    : 647
bytes present                  : 532
missing + still claiming READY : 0   (was 115)
missing + marked FAILED        : 115
```

## Rollback

`reports/missing-assets-snapshot-<timestamp>.json` (gitignored, kept on the server) records every affected asset's
previous status. To revert, set `status` back to `READY` and clear
`processingError` for the listed ids.

The update was guarded on `status: "READY"`, so no concurrent edit was overwritten.

## Remaining

The 115 files are **permanently lost**. Nothing on this machine can restore them;
they must be re-uploaded from wherever the originals came from. What has changed
is that Arciin now says so instead of pretending they are fine.
