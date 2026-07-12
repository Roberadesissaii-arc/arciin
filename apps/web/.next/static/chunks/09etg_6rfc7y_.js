(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,357301,e=>{"use strict";let t=(0,e.i(433721).default)("rotate-ccw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]);e.s(["RotateCcw",0,t],357301)},332277,e=>{"use strict";let t=(0,e.i(433721).default)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);e.s(["Eye",0,t],332277)},558680,e=>{"use strict";let t=(0,e.i(433721).default)("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);e.s(["default",0,t])},650654,e=>{"use strict";var t=e.i(558680);e.s(["ChevronDown",()=>t.default])},16301,e=>{"use strict";let t=(0,e.i(433721).default)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);e.s(["Lock",0,t],16301)},415360,e=>{"use strict";let t=(0,e.i(433721).default)("sparkles",[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]]);e.s(["Sparkles",0,t],415360)},844347,e=>{"use strict";var t=e.i(151351);e.s(["createModelProfile",0,function(e){return(0,t.fetchApi)("/models",{method:"POST",body:e})},"deleteModelProfile",0,function(e){return(0,t.fetchApi)(`/models/${e}`,{method:"DELETE"})},"getAvailableModels",0,function(e,a){let r=a?.refresh?"?refresh=1":"";return(0,t.fetchApi)(`/models/${e}/available-models${r}`,{method:"GET",signal:a?.signal})},"getModelProfiles",0,function(e){return(0,t.fetchApi)("/models",{method:"GET",signal:e})},"getOllamaCloudModels",0,function(e,a){let r=a?.refresh?"?refresh=1":"";return(0,t.fetchApi)(`/models/${e}/cloud-models${r}`,{method:"GET",signal:a?.signal})},"getOllamaModelCapabilities",0,function(e,a,r){return(0,t.fetchApi)(`/models/${e}/model-capabilities`,{method:"POST",body:a,signal:r})},"getOllamaModelShow",0,function(e,a,r){return(0,t.fetchApi)(`/models/${e}/show`,{method:"POST",body:a,signal:r})},"setDefaultModelProfile",0,function(e){return(0,t.fetchApi)(`/models/${e}/set-default`,{method:"POST",body:{}})},"testModelProfile",0,function(e,a){return(0,t.fetchApi)(`/models/${e}/test`,{method:"POST",body:a??{}})},"updateModelProfile",0,function(e,a){return(0,t.fetchApi)(`/models/${e}`,{method:"PATCH",body:a})}])},85662,e=>{"use strict";let t=(0,e.i(433721).default)("cloud",[["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",key:"p7xjir"}]]);e.s(["Cloud",0,t],85662)},957356,e=>{"use strict";let t=["ollama","ollama-local","ollama-cloud"];e.s(["isOllamaProvider",0,function(e){return t.includes(e)},"ollamaCapabilitiesIncludeVision",0,function(e){return e&&0!==e.length?e.some(e=>"vision"===e.toLowerCase()):null}])},953700,e=>{"use strict";let t=(0,e.i(433721).default)("plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);e.s(["Plus",0,t],953700)},38157,e=>{"use strict";var t=e.i(992844),a=e.i(433721);let r=(0,a.default)("building-2",[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]]),s=(0,a.default)("crown",[["path",{d:"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z",key:"1vdc57"}],["path",{d:"M5 21h14",key:"11awu3"}]]);var i=e.i(529658);e.s(["PlanBadge",0,function({plan:e}){let a=e.toLowerCase();return"pro"===a?(0,t.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",style:{background:"linear-gradient(to right, var(--arciin-accent, #ff4f12), var(--arciin-accent-hover, #ff6a33))",boxShadow:"0 4px 12px -4px color-mix(in srgb, var(--arciin-accent, #ff4f12) 50%, transparent)"},children:[(0,t.jsx)(s,{className:"size-3","aria-hidden":!0}),"Pro"]}):"team"===a?(0,t.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.5)]",children:[(0,t.jsx)(i.Users,{className:"size-3","aria-hidden":!0}),"Team"]}):"business"===a?(0,t.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",children:[(0,t.jsx)(r,{className:"size-3","aria-hidden":!0}),"Business"]}):(0,t.jsx)("span",{className:"inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600",children:"Free"})}],38157)},550080,e=>{"use strict";let t=(0,e.i(433721).default)("file",[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}]]);e.s(["File",0,t],550080)},149387,77413,e=>{"use strict";var t=e.i(433721);let a=(0,t.default)("thumbs-down",[["path",{d:"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",key:"m61m77"}],["path",{d:"M17 14V2",key:"8ymqnk"}]]);e.s(["ThumbsDown",0,a],149387);let r=(0,t.default)("thumbs-up",[["path",{d:"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",key:"emmmcr"}],["path",{d:"M7 10v12",key:"1qc93n"}]]);e.s(["ThumbsUp",0,r],77413)},785741,e=>{"use strict";var t=e.i(992844),a=e.i(452953),r=e.i(16301),s=e.i(38157),i=e.i(466691),o=e.i(152236);e.s(["SoftLockBanner",0,function({plan:e,title:n,description:l,className:d,actions:c}){return(0,t.jsxs)("div",{className:(0,o.cn)("flex flex-col items-center text-center",d),children:[(0,t.jsx)(r.Lock,{className:"size-12 text-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_45%,transparent)]",strokeWidth:1.5,"aria-hidden":!0}),(0,t.jsxs)("div",{className:"mt-4 flex flex-wrap items-center justify-center gap-2",children:[(0,t.jsx)("p",{className:"text-sm font-semibold tracking-tight text-foreground",children:n}),(0,t.jsx)(s.PlanBadge,{plan:e})]}),(0,t.jsx)("p",{className:"mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground",children:l??`Activate a ${e} license to use this feature. Your files stay on this server either way.`}),(0,t.jsx)("div",{className:"mt-5 flex flex-wrap items-center justify-center gap-2",children:c??(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(i.Button,{asChild:!0,size:"sm",className:"bg-[color:var(--arciin-accent,#FF4F12)] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90",children:(0,t.jsx)(a.default,{href:"/settings?tab=license",children:"Activate license"})}),(0,t.jsx)(i.Button,{asChild:!0,size:"sm",variant:"outline",children:(0,t.jsx)("a",{href:"http://localhost:3010/account",target:"_blank",rel:"noreferrer",children:"Manage license"})})]})})]})}])},982194,e=>{"use strict";e.s(["ARCIIN_INTEGRATION_CODE_AI_APPEND",0,'\n## Integration code generation (Python, Node.js, curl, Postman)\n\nWhen the user asks you to **write code**, **create a script**, **automate uploads**, **listen to events**, or **call the API** from outside the browser:\n\n### Required behavior\n1. If they did **not** name a language, ask once: *"Do you want Python, Node.js, curl, or Postman?"* — then give **only** the chosen format.\n2. Copy **REST API base** and **library ids** from the **"--- Current Instance Data ---"** block. Never invent ids (they are **cuid** strings like `clx…`, not UUIDs).\n3. Prefer **complete, runnable** examples with a CONFIG section at the top (API base, API key or email/password, file path). Mention `pip install requests` for Python and that keys need the right **scopes**.\n4. Mention matching scripts by **filename only** (e.g. `api/06_upload_to_library.py`) — they live on the server under `scripts/examples/`, not as web pages.\n5. **Footer links (required)** — use **only** these clickable in-app paths (never turn repo paths or REST_BASE into UI URLs):\n   - [Documentation → File uploads](/docs#uploads)\n   - [Documentation → Example scripts](/docs#example-scripts)\n   - [API Keys](/developer/api-keys)\n   - [Documentation](/docs) · [Events](/events)\n6. **Never** link to `http://…/scripts/examples/README.md` — that URL does not exist (404). **Never** put API keys under the REST host (e.g. `http://192.168.x.x:4000/developer/api-keys`). REST_BASE is for `curl`/`requests` only; UI links use relative paths on the **browser origin** (same host/port as the dashboard tab).\n\n### Upload API (current — do not use outdated 3-step JSON initiate flows)\n- **One request:** `POST {REST_BASE}/uploads` with **multipart** field `file`.\n- **Query (optional):** `targetLibraryId={libraryCuid}` and/or `targetFolderId={folderCuid}`.\n- **Omit** `targetLibraryId` to auto-route by MIME (video→Videos, image→Images, etc.).\n- **Auth:** `Authorization: Bearer arc_…` (API key with **uploads:create**; add **libraries:read** to resolve library id by slug) **or** session cookie after `POST {REST_BASE}/auth/login`.\n- **Not valid:** JSON body with `librarySlug` on POST /uploads, `DELETE /libraries/{id}/folders/{id}`, or UUID-shaped ids.\n- Resolve slug → id: `GET {REST_BASE}/libraries`, find `slug`, use that row\'s `id` as `targetLibraryId`.\n\n### Socket.IO (realtime)\n- Connect to the **API origin** (port **4000** in dev), not the Next.js UI port alone.\n- **API key:** header `Authorization: Bearer arc_…` with **events:subscribe** scope.\n- **Session:** login via REST, pass `Cookie` header on `socketio.Client().connect()`.\n- Listen for `upload.completed`, `upload.failed`, `asset.created`, `activity.created`, etc. Browser UI at [Events](/events) shows the same stream when logged in.\n\n### WSL / two-machine\n- Arciin in WSL, Python on Windows: `API_BASE = http://<WSL-IP>:4000/api` (run `bash scripts/examples/lib/wsl_hosts.sh` in WSL).\n- Web UI on Windows host: `http://localhost:3000`.\n\n### API key pitfalls (warn in code comments)\n- Paste the **full** `arc_…` secret from the one-time create dialog — not the short prefix in the table.\n- Revoked keys return `UNAUTHENTICATED`. Create a new key with correct scopes.\n\n### After external upload\n- User sees **Notifications** badge + sound in the dashboard when the tab is open and **Realtime live** (Socket.IO connected).\n',"buildCurlMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:a,librarySlug:r="images"}=e;return`export ARCIIN_KEY="arc_paste_full_key_here"
export API="${t}"
export FILE="./photo.jpg"
export LIB_ID="${a??"clx_paste_library_id"}"   # ${r} — from GET $API/libraries

curl -sS -X POST "$API/uploads?targetLibraryId=$LIB_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@$FILE" | jq .`},"buildNodeMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:a,librarySlug:r="images"}=e;return`// npm i form-data node-fetch  (Node 18+ can use global fetch + FormData)
import fs from "node:fs";
import path from "node:path";

const API_BASE = "${t}".replace(/\\/$/, "");
const API_KEY = process.env.ARCIIN_API_KEY ?? "arc_paste_full_key_here";
const FILE = "./photo.jpg";
const TARGET_LIBRARY_ID = "${a??"clx_paste_from_GET_libraries"}"; // slug "${r}" — from GET /libraries

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
console.log("OK", json.data.status, json.data.assetId);`},"buildPythonMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:a,librarySlug:r="images"}=e,s=a?`# Library "${r}" id from GET /libraries:
TARGET_LIBRARY_ID = "${a}"`:`# Get id: GET ${t}/libraries — match slug "${r}"
TARGET_LIBRARY_ID = "clx_paste_from_libraries_response"`;return`#!/usr/bin/env python3
"""Upload one file to Arciin — multipart POST (see scripts/examples/api/06_upload_to_library.py)."""
# pip install requests

API_BASE = "${t}".rstrip("/")
API_KEY = "arc_paste_full_key_here"  # scopes: uploads:create, libraries:read

FILE_PATH = r"C:\\path\\to\\file.jpg"

${s}

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
print("OK", data.get("status"), data.get("assetId"), data.get("targetLibrary", {}).get("slug"))`},"buildPythonSocketSnippet",0,function(e){let{apiBase:t,socketUrl:a}=e;return`# pip install requests "python-socketio[client]" websocket-client
# Full script: scripts/examples/events/01_monitor_api_key.py

import os
import socketio

API_KEY = os.environ.get("ARCIIN_API_KEY", "arc_paste_full_key_here")
SOCKET_URL = "${a}"
API_BASE = "${t}".rstrip("/")

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
sio.wait()`}])}]);