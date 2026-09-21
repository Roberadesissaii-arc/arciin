# Arciin AI Desktop tools protocol (v1)

This is the **server ↔ native Desktop** contract for constrained This PC
tools used by Arciin AI.

It is **not** pairing protocol v1 and **not** the computer-backup protocol.

```txt
Chat AI
  → server desktop.* tool broker
  → authenticated Device channel
  → native Desktop dispatcher
  → Windows filesystem
  → sanitized metadata result
  → server
  → model
```

**The remote WebView never gets native filesystem access.**

`isArciinDesktopWebView()` may only show future UI. It is not authorization.

Protocol version: `aiDesktopTools.protocolVersion = 1`

## 1. Purpose

Let a user who has enabled This PC ask questions such as:

- What's on my Desktop?
- Find resume.pdf.
- What's inside my Interview folder?

The model may request a **constrained** native tool. The server never reads
the PC disk. Fastify never executes desktop tools.

## 2. Threat model

Assume:

- The chat WebView is hostile.
- User-agent, IP, device display name, and `window.chrome.webview` are spoofable.
- Chat transcripts persist tool results.

Require:

- Paired **ACTIVE** Device credential (`Authorization: Device …`)
- Device belongs to the chat user (pairing creator, bound session, or backup profile)
- AI Security `desktopComputerAccess = metadata_only`
- Chat turn `desktopContext.enabled` + `deviceId` (untrusted until those checks pass)
- Native Desktop still confirms upload and backup actions

## 3. Transport

Socket.IO namespace:

```txt
/desktop-tools
```

Events:

| Direction | Event | Payload |
|---|---|---|
| Server → Desktop | `desktop.tool.request` | `DesktopToolRequest` |
| Desktop → Server | `desktop.tool.result` | `DesktopToolResult` |

Properties:

- Device-authenticated (not session cookies, not ArciinSync)
- Reconnectable (Socket.IO)
- One logical channel per Device: a new connection **replaces** the previous
- No durable command backlog
- If Desktop is offline, the broker returns `DESKTOP_OFFLINE` immediately
- Requests expire (`expiresAt`). A late result is `DESKTOP_REQUEST_EXPIRED`

Do not use the server-hosted WebView as this transport.

## 4. Authentication

Handshake:

```txt
Authorization: Device <pairing-credential>
```

or Socket.IO `auth.deviceCredential`.

Optional `auth.protocolVersion` (default 1).

The server verifies:

- Device exists
- Device `ACTIVE` (not revoked)
- Credential hash matches

On Device revoke the channel is disconnected immediately and in-flight
requests fail.

## 5. Capabilities

Discovery (`GET /.well-known/arciin`) is additive:

```json
{
  "capabilities": {
    "computerBackup": { "supported": true, "protocolVersion": 1 },
    "aiDesktopTools": { "supported": true, "protocolVersion": 1 }
  }
}
```

Older Desktop clients ignore unknown fields and simply never connect to
`/desktop-tools`. The server withholds `desktop.*` tools from the model
unless the Device is eligible. A connected client with the wrong protocol
version yields `DESKTOP_TOOL_UNSUPPORTED`.

Do not bump pairing `protocolVersion` for this feature.

## 6. Envelopes

### DesktopToolRequest

```ts
{
  id: string
  version: 1
  deviceId: string
  conversationId: string | null
  tool: DesktopToolName
  arguments: object
  confirmation: "none" | "required"
  createdAt: string
  expiresAt: string
}
```

### DesktopToolResult

```ts
{
  requestId: string
  status: "ok" | "error" | "denied"
  result?: unknown
  error?: { code: DesktopToolErrorCode, message: string }
  completedAt: string
}
```

## 7. V1 tools

| Tool | Class | Notes |
|---|---|---|
| `desktop.list_directory` | metadata | `scopeId` + relative path. No absolute paths. |
| `desktop.search_files` | metadata | query + scope ids. No contents. |
| `desktop.stat_file` | metadata | metadata only |
| `desktop.open_path` | local action | `confirmation: required`; native UI is the final gate |
| `desktop.upload_file_to_arciin` | data leaves PC | server requires `confirmed: true`; native confirms again |
| `desktop.enable_backup_for_folder` | backup change | reuses Computer Backup lifecycle; dual confirmation |

**Not in V1:** `desktop.read_file`, `write_file`, `delete_file`, `rename_file`, `run_command`, `shell`.

Inputs use **opaque scope/root id** + **root-relative path**. Never `C:\…`.

Results may contain: `name`, `kind`, `relativePath`, `size`, `modifiedAt`, `scopeId`.

## 8. Scope model

Desktop owns native scope grants (which folders This PC may see).

The server does not receive Windows absolute paths. If a result contains one,
the server rejects it as `DESKTOP_RESULT_INVALID`.

## 9. Timeouts and limits

| Limit | Value |
|---|---|
| Request timeout | 15s |
| Request expiry | 20s |
| Concurrent requests per Device | 2 |
| Tool rounds (existing agent loop) | 4 |
| List entries | 50 |
| Search entries | 25 |
| Result payload | 32 KiB |
| Argument payload | 8 KiB |

There is no persistent queue. Stale “open this folder” commands must not run
hours later.

## 10. Privacy

Tool results can be stored in chat transcripts. Minimize fields.

Forbidden in results:

- Windows absolute paths (`C:\`, `D:\`, UNC `\\server\share`)
- file contents (text, base64, binary)
- Windows username, volume serial, file id, NTFS ids, SIDs

Even filenames can be sensitive. This PC remains explicitly user-enabled
(AI Security default **off**).

## 11. Approval classes

| Class | Tools | Server | Native |
|---|---|---|---|
| Metadata | list, search, stat | allowed once This PC is enabled and the Device is eligible | native scope grants |
| Local UI | open_path | `confirmed: true` | final gate |
| Data leaves PC | upload_file_to_arciin | `confirmed: true` | confirm before bytes leave |
| Backup | enable_backup_for_folder | `confirmed: true` | existing backup lifecycle |

Do not rely on server confirmation alone.

## 12. Offline / errors

| Code | Meaning |
|---|---|
| `DESKTOP_OFFLINE` | No live Device channel. AI: “I can't reach this PC right now.” |
| `DESKTOP_TOOL_TIMEOUT` | No result before timeout |
| `DESKTOP_TOOL_DENIED` | Missing confirmation, concurrency, or native deny |
| `DESKTOP_SCOPE_DENIED` | Native scope not granted |
| `DESKTOP_PATH_NOT_FOUND` | Relative path missing |
| `DESKTOP_TOOL_UNSUPPORTED` | Protocol / tool not available |
| `DESKTOP_RESULT_INVALID` | Absolute path, contents, oversized, or forbidden keys |
| `DESKTOP_REQUEST_EXPIRED` | Result arrived after expiry; not executed later |

Messages must not include internal paths or stack traces.

## 13. Chat gates

All of these must pass or `desktop.*` stay withheld from the model:

1. Chat body `desktopContext.enabled` + `deviceId`
2. AI Security `desktopComputerAccess = metadata_only`
3. Device ACTIVE and owned by the session user
4. Connected Desktop uses protocol v1 (if connected; offline still exposes tools so the broker can return `DESKTOP_OFFLINE`)

Default security value: **off**.

## 14. Desktop implementation (next)

Native Arciin Desktop must:

1. Advertise/ignore `capabilities.aiDesktopTools`
2. Connect to `/desktop-tools` with `Authorization: Device <credential>`
3. Handle `desktop.tool.request` / emit `desktop.tool.result`
4. Map `scopeId` to a granted local folder; never send absolute paths
5. Enforce native confirmation for open / upload / enable-backup
6. Reconnect; tolerate replacement of a duplicate channel
7. Not keep a durable backlog of expired requests
