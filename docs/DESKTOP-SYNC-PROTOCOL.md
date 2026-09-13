# Arciin desktop computer-backup protocol

This is the server contract for Arciin Desktop folder backup.

It is **not** the pairing protocol. Pairing version remains `1`.

```txt
Discovery     →  an Arciin server exists
Pairing       →  this computer is a trusted device
User login    →  a person is authenticated
Backup grant  →  that person authorized background folder backup on that device
```

A paired device credential must never be treated as file access.

Protocol version: `computerBackupProtocolVersion = 1`

This is independent of the pairing protocol and the Arciin application version.

## 1. Purpose

Computer backup preserves a source folder tree from a paired computer and
indexes its contents in Arciin.

It is **not** a batch of ordinary uploads that scatter files into Images,
Videos, Music, or Documents as physical homes.

Canonical storage stays under:

```txt
Computers → {device name} → {protected root} → {source hierarchy}
```

Libraries are smart views over the same file object.

## 2. Relationship to pairing

| Concern | Protocol | Credential |
|---|---|---|
| Find the server | Pairing / discovery v1 | none |
| Trust this computer | Pairing v1 | `Authorization: Device <credential>` |
| Sign the person in | Auth | session cookie / Bearer session |
| Background backup | This document v1 | `Authorization: ArciinSync <credential>` |

Do not bump pairing `protocolVersion` because backup exists.

Device revocation invalidates pairing trust **and** every backup grant for that
device. Disabling backup invalidates only the backup grant.

## 3. Capability / version negotiation

Public discovery (`GET /.well-known/arciin`) stays pairing-protocol 1 and may
include an optional field:

```json
{
  "protocolVersion": 1,
  "capabilities": {
    "computerBackup": {
      "supported": true,
      "protocolVersion": 1
    }
  }
}
```

Older desktop clients ignore unknown fields.

If `capabilities.computerBackup.supported` is missing or false, the desktop
must not attempt backup APIs. Manual IP/domain connection still works.

## 4. Backup authorization flow

1. The computer is already paired.
2. The user signs into Arciin normally.
3. The desktop (or Settings) asks the signed-in user to protect folders.
4. `POST /api/backup/profiles` with the paired `deviceId` and chosen roots.
5. The server creates a `DeviceBackupProfile` owned by that user + device.
6. The server issues a high-entropy backup credential **once**.
7. Desktop stores it in Windows Credential Manager. Never in localStorage.
8. Background sync uses only `Authorization: ArciinSync <credential>`.
9. The server stores SHA-256 of the secret. The raw value is never logged.

A pairing credential or trusted-device cookie cannot enable backup by itself.

## 5. Credential security

- 32 bytes of cryptographic randomness, prefixed `arcsync_`
- Returned once in the enable/rotate response
- Stored as SHA-256 hex
- Never placed in a URL, query string, or frontend JavaScript storage
- Scheme: `Authorization: ArciinSync <credential>`
- Scope: computer-backup APIs for **that device and that user only**
- Not valid for user admin, settings, licensing, arbitrary asset APIs, or pairing

Rotate with `POST /api/backup/profiles/:id/rotate`. The previous grant is revoked.

## 6. Sync root model

A root is a protected known folder or a custom folder the user chose.

Kinds: `DESKTOP` `DOCUMENTS` `PICTURES` `VIDEOS` `MUSIC` `DOWNLOADS` `CUSTOM`

The server stores:

- `displayName` (e.g. `Desktop`)
- `sourcePathIdentifier` — opaque client id, **not** `C:\Users\…`
- canonical Arciin folder id

Do not send absolute Windows paths unless a future protocol revision needs them.
V1 does not persist absolute personal paths.

## 7. Entry identity

Each tracked file or folder has a stable `clientEntryId` (UUID).

Do not identify entries solely by absolute path. Paths change on rename/move.

Do not use MAC address, hardware serial, Windows product key, or motherboard ID
as file identity.

## 8. Directory structure

Folders are first-class. A project tree stays together:

```txt
Computers
└── Robera Desktop
    └── Desktop
        └── WebProject
            ├── package.json
            ├── public
            │   └── logo.png
            └── demo.mp4
```

The same `logo.png` asset can appear in Images. There is one blob.

## 9. Upload / create

`POST /api/backup/files` (multipart) with `Authorization: ArciinSync`.

Required fields:

- `syncRootId`
- `clientEntryId`
- `relativePath`
- `operationId` (idempotency)
- file body

The server:

- validates the relative path
- creates missing folder entries
- streams to the existing storage pipeline
- stores the asset in the Computers library under the preserved tree
- does **not** reroute into Images/Videos/Music/Documents
- classifies MIME/`mediaType` for smart views
- reuses content-addressed blobs when the checksum already exists

Large files use the existing streamed multipart path. The whole file is not
buffered into RAM.

## 10. Update

`POST /api/backup/files` again with the same `clientEntryId` and a new body.

A content change replaces the asset's storage object using the existing
pipeline. The canonical hierarchy stays the same.

## 11. Rename / move

`POST /api/backup/entries/:clientEntryId/move`

```json
{
  "relativePath": "WebProject/renamed/logo.png",
  "operationId": "uuid"
}
```

Moves stay inside the same sync root. The server updates folder parents and
`relativePath`. It does not rewrite Windows.

## 12. Local deletion

`POST /api/backup/entries/:clientEntryId/tombstone`

V1 meaning:

- the source entry is gone on the PC
- the Arciin object is soft-deleted into existing Trash (30-day retention)
- the sync entry is `TOMBSTONED`
- this does **not** delete any file on Windows (already gone locally)

The desktop must never treat a web-UI trash action as a command to delete the
local file. V1 is one-way: PC → Arciin.

## 13. Idempotency

Retries are expected. Send `operationId` on mutating backup routes.

The same key + same body replays the original result.
A changed body under the same key is `409`.

Creating the same `clientEntryId` twice must not create two logical entries.

## 14. Status / heartbeat

`POST /api/backup/heartbeat`

```json
{
  "health": "SYNCING",
  "lastError": null
}
```

Allowed health: `UP_TO_DATE` `SYNCING` `PAUSED` `OFFLINE` `ERROR`

The server throttles persistent writes (about once per minute). Do not write
PostgreSQL on every filesystem event.

Device last-seen / pairing health is independent of backup health.

## 15. Device revocation

`POST /api/settings/devices/:id/revoke` also:

- revokes every backup grant for that device
- rejects later `ArciinSync` requests
- rejects heartbeats
- does not affect unrelated devices

Pairing sessions for that device are also ended (existing pairing behavior).

## 16. Backup disable

`POST /api/backup/profiles/:id/disable`

- leaves the Device paired
- revokes backup grants
- keeps the canonical files in Arciin
- desktop must drop the stored sync credential

## 17. Errors

Standard Arciin envelope:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

| Code | Meaning |
|---|---|
| `BACKUP_NOT_SUPPORTED` | Server cannot serve computer backup |
| `BACKUP_UNAUTHORIZED` | Missing/invalid user session |
| `BACKUP_CREDENTIAL_INVALID` | Missing/invalid/revoked `ArciinSync` credential |
| `BACKUP_DEVICE_UNPAIRED` | Device is missing or revoked |
| `BACKUP_FORBIDDEN` | Cross-user or cross-device |
| `BACKUP_DISABLED` | Profile is disabled |
| `BACKUP_READ_ONLY` | Server-side hierarchy mutation is not allowed in V1 |
| `PATH_TRAVERSAL` | Relative path escaped the root |
| `PATH_INVALID` | Bad/reserved/empty segment |
| `PATH_TOO_LONG` | Path, segment, or depth exceeded |
| `BACKUP_IDEMPOTENCY_CONFLICT` | Same key, different body |
| `VALIDATION_ERROR` | Schema failed |

## 18. Path security

Desktop sends **relative** source paths only.

The server:

- rejects `..`, absolute paths, drive letters, UNC paths
- rejects NUL, reserved Windows names, oversized paths
- normalizes `\` and `/` to a logical `/` path
- never uses the client path as a host filesystem path
- stores files under server-controlled object keys

Symlinks / reparse points: the desktop must skip them by default. The server
does not follow client paths and must not assume they were followed.

## 19. V1 one-way limitations

V1 is **PC → Arciin**.

Not in V1:

- web rename/move/delete propagating to Windows
- bidirectional conflict resolution
- desktop watching APIs (those live in `arciin-desktop`)
- treating pairing as file access

The Computers web UI is browse / preview / download / restore-oriented.
Unsupported mutations are disabled or labeled as server-copy only.

Server trash of a computer-backed file does **not** delete the Windows file.

## 20. Future bidirectional sync

A later protocol may add:

- server-originated change feed
- explicit conflict policy
- optional two-way delete (must stay opt-in)
- requested-state from the web while the desktop is offline

Any of those requires a new `computerBackup.protocolVersion`. Do not overload
pairing v1 for that work.
