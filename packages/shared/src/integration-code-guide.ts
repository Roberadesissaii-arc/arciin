/**
 * Canonical REST integration facts and copy-paste snippets for uploads, auth, and Socket.IO.
 * Used by AI chat system instructions and the in-app documentation manual.
 */

export const ARCIIN_EXAMPLE_SCRIPTS = [
  "scripts/examples/README.md",
  "scripts/examples/arciin_example_client.py",
  "scripts/examples/health_check_example.py",
  "scripts/examples/list_libraries_example.py",
  "scripts/examples/list_folders_example.py",
  "scripts/examples/create_folder_example.py",
  "scripts/examples/upload_image_example.py",
  "scripts/examples/upload_video_example.py",
  "scripts/examples/upload_auto_classify_example.py",
  "scripts/examples/list_assets_example.py",
  "scripts/examples/app_databases_example.py",
  "scripts/examples/socket_events_example.py",
  "scripts/examples/arciin_wsl_hosts.sh",
] as const

/** Appended to Arciin chat when users ask for Python, Node.js, curl, or Postman examples. */
export const ARCIIN_INTEGRATION_CODE_AI_APPEND = `
## Integration code generation (Python, Node.js, curl, Postman)

When the user asks you to **write code**, **create a script**, **automate uploads**, **listen to events**, or **call the API** from outside the browser:

### Required behavior
1. If they did **not** name a language, ask once: *"Do you want Python, Node.js, curl, or Postman?"* — then give **only** the chosen format.
2. Copy **REST API base** and **library ids** from the **"--- Current Instance Data ---"** block. Never invent ids (they are **cuid** strings like \`clx…\`, not UUIDs).
3. Prefer **complete, runnable** examples with a CONFIG section at the top (API base, API key or email/password, file path). Mention \`pip install requests\` for Python and that keys need the right **scopes**.
4. Point to \`scripts/examples/README.md\` and the matching \`*_example.py\` script (health, libraries, folders, create folder, upload image/video, auto-classify, list assets, app databases, socket events). Shared config: \`arciin_example_client.py\`. WSL: \`arciin_wsl_hosts.sh\`.
5. Link [Documentation](/docs), [API Keys](/developer/api-keys), [Events](/events).

### Upload API (current — do not use outdated 3-step JSON initiate flows)
- **One request:** \`POST {REST_BASE}/uploads\` with **multipart** field \`file\`.
- **Query (optional):** \`targetLibraryId={libraryCuid}\` and/or \`targetFolderId={folderCuid}\`.
- **Omit** \`targetLibraryId\` to auto-route by MIME (video→Videos, image→Images, etc.).
- **Auth:** \`Authorization: Bearer arc_…\` (API key with **uploads:create**; add **libraries:read** to resolve library id by slug) **or** session cookie after \`POST {REST_BASE}/auth/login\`.
- **Not valid:** JSON body with \`librarySlug\` on POST /uploads, \`DELETE /libraries/{id}/folders/{id}\`, or UUID-shaped ids.
- Resolve slug → id: \`GET {REST_BASE}/libraries\`, find \`slug\`, use that row's \`id\` as \`targetLibraryId\`.

### Socket.IO (realtime)
- Connect to the **API origin** (port **4000** in dev), not the Next.js UI port alone.
- **API key:** header \`Authorization: Bearer arc_…\` with **events:subscribe** scope.
- **Session:** login via REST, pass \`Cookie\` header on \`socketio.Client().connect()\`.
- Listen for \`upload.completed\`, \`upload.failed\`, \`asset.created\`, \`activity.created\`, etc. Browser UI at [Events](/events) shows the same stream when logged in.

### WSL / two-machine
- Arciin in WSL, Python on Windows: \`API_BASE = http://<WSL-IP>:4000/api\` (run \`bash scripts/examples/arciin_wsl_hosts.sh\` in WSL).
- Web UI on Windows host: \`http://localhost:3000\`.

### API key pitfalls (warn in code comments)
- Paste the **full** \`arc_…\` secret from the one-time create dialog — not the short prefix in the table.
- Revoked keys return \`UNAUTHENTICATED\`. Create a new key with correct scopes.

### After external upload
- User sees **Notifications** badge + sound in the dashboard when the tab is open and **Realtime live** (Socket.IO connected).
`

type UploadSnippetOpts = {
  apiBase: string
  libraryId?: string
  librarySlug?: string
  socketUrl?: string
}

export function buildPythonMultipartUploadSnippet(opts: UploadSnippetOpts): string {
  const { apiBase, libraryId, librarySlug = "images" } = opts
  const libComment = libraryId
    ? `# Library "${librarySlug}" id from GET /libraries:\nTARGET_LIBRARY_ID = "${libraryId}"`
    : `# Get id: GET ${apiBase}/libraries — match slug "${librarySlug}"\nTARGET_LIBRARY_ID = "clx_paste_from_libraries_response"`

  return `#!/usr/bin/env python3
"""Upload one file to Arciin — multipart POST (see scripts/examples/upload_file_example.py)."""
# pip install requests

API_BASE = "${apiBase}".rstrip("/")
API_KEY = "arc_paste_full_key_here"  # scopes: uploads:create, libraries:read

FILE_PATH = r"C:\\path\\to\\file.jpg"

${libComment}

import mimetypes
from pathlib import Path
import requests

path = Path(FILE_PATH)
mime, _ = mimetypes.guess_type(path.name)
mime = mime or "application/octet-stream"

r = requests.post(
    f"{apiBase}/uploads",
    params={"targetLibraryId": TARGET_LIBRARY_ID},
    headers={"Authorization": f"Bearer {API_KEY}"},
    files={"file": (path.name, path.open("rb"), mime)},
    timeout=600,
)
r.raise_for_status()
data = r.json()["data"]
print("OK", data.get("status"), data.get("assetId"), data.get("targetLibrary", {}).get("slug"))`
}

export function buildNodeMultipartUploadSnippet(opts: UploadSnippetOpts): string {
  const { apiBase, libraryId, librarySlug = "images" } = opts
  const libId = libraryId ?? "clx_paste_from_GET_libraries"

  return `// npm i form-data node-fetch  (Node 18+ can use global fetch + FormData)
import fs from "node:fs";
import path from "node:path";

const API_BASE = "${apiBase}".replace(/\\/$/, "");
const API_KEY = process.env.ARCIIN_API_KEY ?? "arc_paste_full_key_here";
const FILE = "./photo.jpg";
const TARGET_LIBRARY_ID = "${libId}"; // slug "${librarySlug}" — from GET /libraries

const filePath = path.resolve(FILE);
const blob = new Blob([fs.readFileSync(filePath)]);
const form = new FormData();
form.append("file", blob, path.basename(filePath));

const url = new URL(\`\${API_BASE}/uploads\`);
url.searchParams.set("targetLibraryId", TARGET_LIBRARY_ID);

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: \`Bearer \${API_KEY}\` },
  body: form,
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
console.log("OK", json.data.status, json.data.assetId);`
}

export function buildCurlMultipartUploadSnippet(opts: UploadSnippetOpts): string {
  const { apiBase, libraryId, librarySlug = "images" } = opts
  const libId = libraryId ?? "clx_paste_library_id"

  return `export ARCIIN_KEY="arc_paste_full_key_here"
export API="${apiBase}"
export FILE="./photo.jpg"
export LIB_ID="${libId}"   # ${librarySlug} — from GET $API/libraries

curl -sS -X POST "$API/uploads?targetLibraryId=$LIB_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@$FILE" | jq .`
}

export function buildPythonSocketSnippet(opts: { apiBase: string; socketUrl: string }): string {
  const { apiBase, socketUrl } = opts
  return `# pip install requests "python-socketio[client]" websocket-client
# Full script: scripts/examples/socket_events_test.py

import os
import socketio

API_KEY = os.environ.get("ARCIIN_API_KEY", "arc_paste_full_key_here")
SOCKET_URL = "${socketUrl}"
API_BASE = "${apiBase}".rstrip("/")

sio = socketio.Client()

@sio.on("upload.completed")
def on_upload(data):
    print("upload.completed", data)

@sio.on("activity.created")
def on_activity(data):
    print("activity.created", data)

sio.connect(
    SOCKET_URL,
    headers={"Authorization": f"Bearer {API_KEY}"},
    transports=["websocket", "polling"],
)
print("Connected — Ctrl+C to stop")
sio.wait()`
}
