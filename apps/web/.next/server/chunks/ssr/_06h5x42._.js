module.exports=[275631,a=>{"use strict";let b=(0,a.i(13248).default)("rotate-ccw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]);a.s(["RotateCcw",0,b],275631)},8219,a=>{"use strict";let b=(0,a.i(13248).default)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);a.s(["Eye",0,b],8219)},280286,a=>{"use strict";let b=(0,a.i(13248).default)("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);a.s(["default",0,b])},783697,a=>{"use strict";var b=a.i(280286);a.s(["ChevronDown",()=>b.default])},785655,a=>{"use strict";let b=(0,a.i(13248).default)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);a.s(["Lock",0,b],785655)},84825,a=>{"use strict";let b=(0,a.i(13248).default)("sparkles",[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]]);a.s(["Sparkles",0,b],84825)},174893,a=>{"use strict";var b=a.i(109818);a.s(["createModelProfile",0,function(a){return(0,b.fetchApi)("/models",{method:"POST",body:a})},"deleteModelProfile",0,function(a){return(0,b.fetchApi)(`/models/${a}`,{method:"DELETE"})},"getAvailableModels",0,function(a,c){let d=c?.refresh?"?refresh=1":"";return(0,b.fetchApi)(`/models/${a}/available-models${d}`,{method:"GET",signal:c?.signal})},"getModelProfiles",0,function(a){return(0,b.fetchApi)("/models",{method:"GET",signal:a})},"getOllamaCloudModels",0,function(a,c){let d=c?.refresh?"?refresh=1":"";return(0,b.fetchApi)(`/models/${a}/cloud-models${d}`,{method:"GET",signal:c?.signal})},"getOllamaModelCapabilities",0,function(a,c,d){return(0,b.fetchApi)(`/models/${a}/model-capabilities`,{method:"POST",body:c,signal:d})},"getOllamaModelShow",0,function(a,c,d){return(0,b.fetchApi)(`/models/${a}/show`,{method:"POST",body:c,signal:d})},"setDefaultModelProfile",0,function(a){return(0,b.fetchApi)(`/models/${a}/set-default`,{method:"POST",body:{}})},"testModelProfile",0,function(a,c){return(0,b.fetchApi)(`/models/${a}/test`,{method:"POST",body:c??{}})},"updateModelProfile",0,function(a,c){return(0,b.fetchApi)(`/models/${a}`,{method:"PATCH",body:c})}])},61364,a=>{"use strict";let b=(0,a.i(13248).default)("cloud",[["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",key:"p7xjir"}]]);a.s(["Cloud",0,b],61364)},987251,a=>{"use strict";let b=["ollama","ollama-local","ollama-cloud"];a.s(["isOllamaProvider",0,function(a){return b.includes(a)},"ollamaCapabilitiesIncludeVision",0,function(a){return a&&0!==a.length?a.some(a=>"vision"===a.toLowerCase()):null}])},256518,a=>{"use strict";let b=(0,a.i(13248).default)("plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);a.s(["Plus",0,b],256518)},977456,a=>{"use strict";var b=a.i(520688),c=a.i(13248);let d=(0,c.default)("building-2",[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]]),e=(0,c.default)("crown",[["path",{d:"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z",key:"1vdc57"}],["path",{d:"M5 21h14",key:"11awu3"}]]);var f=a.i(318996);a.s(["PlanBadge",0,function({plan:a}){let c=a.toLowerCase();return"pro"===c?(0,b.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",style:{background:"linear-gradient(to right, var(--arciin-accent, #ff4f12), var(--arciin-accent-hover, #ff6a33))",boxShadow:"0 4px 12px -4px color-mix(in srgb, var(--arciin-accent, #ff4f12) 50%, transparent)"},children:[(0,b.jsx)(e,{className:"size-3","aria-hidden":!0}),"Pro"]}):"team"===c?(0,b.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.5)]",children:[(0,b.jsx)(f.Users,{className:"size-3","aria-hidden":!0}),"Team"]}):"business"===c?(0,b.jsxs)("span",{className:"inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",children:[(0,b.jsx)(d,{className:"size-3","aria-hidden":!0}),"Business"]}):(0,b.jsx)("span",{className:"inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600",children:"Free"})}],977456)},719891,a=>{"use strict";let b=(0,a.i(13248).default)("file",[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}]]);a.s(["File",0,b],719891)},762108,690503,a=>{"use strict";var b=a.i(13248);let c=(0,b.default)("thumbs-down",[["path",{d:"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",key:"m61m77"}],["path",{d:"M17 14V2",key:"8ymqnk"}]]);a.s(["ThumbsDown",0,c],762108);let d=(0,b.default)("thumbs-up",[["path",{d:"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",key:"emmmcr"}],["path",{d:"M7 10v12",key:"1qc93n"}]]);a.s(["ThumbsUp",0,d],690503)},61433,a=>{"use strict";var b=a.i(520688),c=a.i(47370),d=a.i(785655),e=a.i(977456),f=a.i(541487),g=a.i(74192);a.s(["SoftLockBanner",0,function({plan:a,title:h,description:i,className:j,actions:k}){return(0,b.jsxs)("div",{className:(0,g.cn)("flex flex-col items-center text-center",j),children:[(0,b.jsx)(d.Lock,{className:"size-12 text-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_45%,transparent)]",strokeWidth:1.5,"aria-hidden":!0}),(0,b.jsxs)("div",{className:"mt-4 flex flex-wrap items-center justify-center gap-2",children:[(0,b.jsx)("p",{className:"text-sm font-semibold tracking-tight text-foreground",children:h}),(0,b.jsx)(e.PlanBadge,{plan:a})]}),(0,b.jsx)("p",{className:"mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground",children:i??`Activate a ${a} license to use this feature. Your files stay on this server either way.`}),(0,b.jsx)("div",{className:"mt-5 flex flex-wrap items-center justify-center gap-2",children:k??(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(f.Button,{asChild:!0,size:"sm",className:"bg-[color:var(--arciin-accent,#FF4F12)] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90",children:(0,b.jsx)(c.default,{href:"/settings?tab=license",children:"Activate license"})}),(0,b.jsx)(f.Button,{asChild:!0,size:"sm",variant:"outline",children:(0,b.jsx)("a",{href:"http://localhost:3010/account",target:"_blank",rel:"noreferrer",children:"Manage license"})})]})})]})}])},612271,a=>{"use strict";a.s(["ARCIIN_INTEGRATION_CODE_AI_APPEND",0,'\n## Integration code generation (Python, Node.js, curl, Postman)\n\nWhen the user asks you to **write code**, **create a script**, **automate uploads**, **listen to events**, or **call the API** from outside the browser:\n\n### Required behavior\n1. If they did **not** name a language, ask once: *"Do you want Python, Node.js, curl, or Postman?"* — then give **only** the chosen format.\n2. Copy **REST API base** and **library ids** from the **"--- Current Instance Data ---"** block. Never invent ids (they are **cuid** strings like `clx…`, not UUIDs).\n3. Prefer **complete, runnable** examples with a CONFIG section at the top (API base, API key or email/password, file path). Mention `pip install requests` for Python and that keys need the right **scopes**.\n4. Mention matching scripts by **filename only** (e.g. `api/06_upload_to_library.py`) — they live on the server under `scripts/examples/`, not as web pages.\n5. **Footer links (required)** — use **only** these clickable in-app paths (never turn repo paths or REST_BASE into UI URLs):\n   - [Documentation → File uploads](/docs#uploads)\n   - [Documentation → Example scripts](/docs#example-scripts)\n   - [API Keys](/developer/api-keys)\n   - [Documentation](/docs) · [Events](/events)\n6. **Never** link to `http://…/scripts/examples/README.md` — that URL does not exist (404). **Never** put API keys under the REST host (e.g. `http://192.168.x.x:4000/developer/api-keys`). REST_BASE is for `curl`/`requests` only; UI links use relative paths on the **browser origin** (same host/port as the dashboard tab).\n\n### Upload API (current — do not use outdated 3-step JSON initiate flows)\n- **One request:** `POST {REST_BASE}/uploads` with **multipart** field `file`.\n- **Query (optional):** `targetLibraryId={libraryCuid}` and/or `targetFolderId={folderCuid}`.\n- **Omit** `targetLibraryId` to auto-route by MIME (video→Videos, image→Images, etc.).\n- **Auth:** `Authorization: Bearer arc_…` (API key with **uploads:create**; add **libraries:read** to resolve library id by slug) **or** session cookie after `POST {REST_BASE}/auth/login`.\n- **Not valid:** JSON body with `librarySlug` on POST /uploads, `DELETE /libraries/{id}/folders/{id}`, or UUID-shaped ids.\n- Resolve slug → id: `GET {REST_BASE}/libraries`, find `slug`, use that row\'s `id` as `targetLibraryId`.\n\n### Socket.IO (realtime)\n- Connect to the **API origin** (port **4000** in dev), not the Next.js UI port alone.\n- **API key:** header `Authorization: Bearer arc_…` with **events:subscribe** scope.\n- **Session:** login via REST, pass `Cookie` header on `socketio.Client().connect()`.\n- Listen for `upload.completed`, `upload.failed`, `asset.created`, `activity.created`, etc. Browser UI at [Events](/events) shows the same stream when logged in.\n\n### WSL / two-machine\n- Arciin in WSL, Python on Windows: `API_BASE = http://<WSL-IP>:4000/api` (run `bash scripts/examples/lib/wsl_hosts.sh` in WSL).\n- Web UI on Windows host: `http://localhost:3000`.\n\n### API key pitfalls (warn in code comments)\n- Paste the **full** `arc_…` secret from the one-time create dialog — not the short prefix in the table.\n- Revoked keys return `UNAUTHENTICATED`. Create a new key with correct scopes.\n\n### After external upload\n- User sees **Notifications** badge + sound in the dashboard when the tab is open and **Realtime live** (Socket.IO connected).\n',"buildCurlMultipartUploadSnippet",0,function(a){let{apiBase:b,libraryId:c,librarySlug:d="images"}=a;return`export ARCIIN_KEY="arc_paste_full_key_here"
export API="${b}"
export FILE="./photo.jpg"
export LIB_ID="${c??"clx_paste_library_id"}"   # ${d} — from GET $API/libraries

curl -sS -X POST "$API/uploads?targetLibraryId=$LIB_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@$FILE" | jq .`},"buildNodeMultipartUploadSnippet",0,function(a){let{apiBase:b,libraryId:c,librarySlug:d="images"}=a;return`// npm i form-data node-fetch  (Node 18+ can use global fetch + FormData)
import fs from "node:fs";
import path from "node:path";

const API_BASE = "${b}".replace(/\\/$/, "");
const API_KEY = process.env.ARCIIN_API_KEY ?? "arc_paste_full_key_here";
const FILE = "./photo.jpg";
const TARGET_LIBRARY_ID = "${c??"clx_paste_from_GET_libraries"}"; // slug "${d}" — from GET /libraries

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
console.log("OK", json.data.status, json.data.assetId);`},"buildPythonMultipartUploadSnippet",0,function(a){let{apiBase:b,libraryId:c,librarySlug:d="images"}=a,e=c?`# Library "${d}" id from GET /libraries:
TARGET_LIBRARY_ID = "${c}"`:`# Get id: GET ${b}/libraries — match slug "${d}"
TARGET_LIBRARY_ID = "clx_paste_from_libraries_response"`;return`#!/usr/bin/env python3
"""Upload one file to Arciin — multipart POST (see scripts/examples/api/06_upload_to_library.py)."""
# pip install requests

API_BASE = "${b}".rstrip("/")
API_KEY = "arc_paste_full_key_here"  # scopes: uploads:create, libraries:read

FILE_PATH = r"C:\\path\\to\\file.jpg"

${e}

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
print("OK", data.get("status"), data.get("assetId"), data.get("targetLibrary", {}).get("slug"))`},"buildPythonSocketSnippet",0,function(a){let{apiBase:b,socketUrl:c}=a;return`# pip install requests "python-socketio[client]" websocket-client
# Full script: scripts/examples/events/01_monitor_api_key.py

import os
import socketio

API_KEY = os.environ.get("ARCIIN_API_KEY", "arc_paste_full_key_here")
SOCKET_URL = "${c}"
API_BASE = "${b}".rstrip("/")

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
sio.wait()`}])}];

//# sourceMappingURL=_06h5x42._.js.map