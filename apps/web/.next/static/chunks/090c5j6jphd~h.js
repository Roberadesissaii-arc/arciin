(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,324803,e=>{"use strict";var t=e.i(397339);function n(e){if("u"<typeof document)return!1;let t=document.createElement("textarea");t.value=e,t.setAttribute("readonly",""),t.style.cssText="position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent",document.body.appendChild(t),t.focus(),t.select(),t.setSelectionRange(0,e.length);let n=!1;try{n=document.execCommand("copy")}finally{document.body.removeChild(t)}return n}function o(e,t){let o=t??e?.value??"";if(!o)return!1;if(e){e.focus(),e.select(),e.setSelectionRange(0,e.value.length);try{if(document.execCommand("copy"))return!0}catch{}}return n(o)}function i(e,t){if(!e)return!1;if(t&&o(t,e)||n(e))return!0;if("u">typeof navigator&&window.isSecureContext&&navigator.clipboard?.writeText)try{return navigator.clipboard.writeText(e),!0}catch{}return!1}async function r(e,t){if(i(e,t))return!0;if("u">typeof navigator&&navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(e),!0}catch{}return n(e)}async function a(e,n,o){let i=n?`${n} copied`:"Copied to clipboard";return await r(e,o)?(t.toast.success(i,{description:"Saved to your clipboard."}),!0):(t.toast.error("Could not copy",{description:"Select the field and press Ctrl+C (or Cmd+C)."}),!1)}e.s(["copyFromField",0,o,"copyTextNow",0,i,"copyToClipboard",0,a,"formatApiKeyPreview",0,function(e,t=14,n=8){return e.length<=t+n+3?e:`${e.slice(0,t)}…${e.slice(-n)}`}])},380797,e=>{"use strict";let t=(0,e.i(433721).default)("chevron-up",[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]);e.s(["default",0,t])},558680,e=>{"use strict";let t=(0,e.i(433721).default)("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);e.s(["default",0,t])},650654,e=>{"use strict";var t=e.i(558680);e.s(["ChevronDown",()=>t.default])},344118,e=>{"use strict";var t=e.i(50153);e.s(["Check",()=>t.default])},96222,e=>{"use strict";var t=e.i(992844),n=e.i(26263),o=e.i(291967),i=e.i(9413),r=e.i(136567),a=e.i(18731),s=e.i(922353),l=e.i(285565),c=e.i(690816),d=e.i(411207),p="Collapsible",[u,h]=(0,i.createContextScope)(p),[m,f]=u(p),b=n.forwardRef((e,o)=>{let{__scopeCollapsible:i,open:a,defaultOpen:s,disabled:c,onOpenChange:u,...h}=e,[f,b]=(0,r.useControllableState)({prop:a,defaultProp:s??!1,onChange:u,caller:p});return(0,t.jsx)(m,{scope:i,disabled:c,contentId:(0,d.useId)(),open:f,onOpenToggle:n.useCallback(()=>b(e=>!e),[b]),children:(0,t.jsx)(l.Primitive.div,{"data-state":A(f),"data-disabled":c?"":void 0,...h,ref:o})})});b.displayName=p;var y="CollapsibleTrigger",g=n.forwardRef((e,n)=>{let{__scopeCollapsible:i,...r}=e,a=f(y,i);return(0,t.jsx)(l.Primitive.button,{type:"button","aria-controls":a.contentId,"aria-expanded":a.open||!1,"data-state":A(a.open),"data-disabled":a.disabled?"":void 0,disabled:a.disabled,...r,ref:n,onClick:(0,o.composeEventHandlers)(e.onClick,a.onOpenToggle)})});g.displayName=y;var I="CollapsibleContent",_=n.forwardRef((e,n)=>{let{forceMount:o,...i}=e,r=f(I,e.__scopeCollapsible);return(0,t.jsx)(c.Presence,{present:o||r.open,children:({present:e})=>(0,t.jsx)(x,{...i,ref:n,present:e})})});_.displayName=I;var x=n.forwardRef((e,o)=>{let{__scopeCollapsible:i,present:r,children:c,...d}=e,p=f(I,i),[u,h]=n.useState(r),m=n.useRef(null),b=(0,s.useComposedRefs)(o,m),y=n.useRef(0),g=y.current,_=n.useRef(0),x=_.current,v=p.open||u,E=n.useRef(v),C=n.useRef(void 0);return n.useEffect(()=>{let e=requestAnimationFrame(()=>E.current=!1);return()=>cancelAnimationFrame(e)},[]),(0,a.useLayoutEffect)(()=>{let e=m.current;if(e){C.current=C.current||{transitionDuration:e.style.transitionDuration,animationName:e.style.animationName},e.style.transitionDuration="0s",e.style.animationName="none";let t=e.getBoundingClientRect();y.current=t.height,_.current=t.width,E.current||(e.style.transitionDuration=C.current.transitionDuration,e.style.animationName=C.current.animationName),h(r)}},[p.open,r]),(0,t.jsx)(l.Primitive.div,{"data-state":A(p.open),"data-disabled":p.disabled?"":void 0,id:p.contentId,hidden:!v,...d,ref:b,style:{"--radix-collapsible-content-height":g?`${g}px`:void 0,"--radix-collapsible-content-width":x?`${x}px`:void 0,...e.style},children:v&&c})});function A(e){return e?"open":"closed"}e.s(["Collapsible",0,b,"CollapsibleContent",0,_,"CollapsibleTrigger",0,g,"Content",0,_,"Root",0,b,"Trigger",0,g,"createCollapsibleScope",0,h],906470);var v=e.i(906470),v=v,E=e.i(152236);e.s(["Collapsible",0,function({className:e,...n}){return(0,t.jsx)(v.Root,{"data-slot":"collapsible",className:(0,E.cn)(e),...n})},"CollapsibleContent",0,function({className:e,...n}){return(0,t.jsx)(v.Content,{"data-slot":"collapsible-content",className:(0,E.cn)("overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",e),...n})},"CollapsibleTrigger",0,function({className:e,...n}){return(0,t.jsx)(v.Trigger,{"data-slot":"collapsible-trigger",className:(0,E.cn)(e),...n})}],96222)},787610,e=>{"use strict";var t=e.i(992844),n=e.i(26263),o=e.i(344118),i=e.i(650654),r=e.i(380797),r=r,a=e.i(159619),s=e.i(466691),l=e.i(324803),c=e.i(152236);e.s(["CopyableShellBlock",0,function({title:e,description:d,script:p,copyLabel:u="Copy script",className:h}){let[m,f]=(0,n.useState)(!1),b=p.split("\n").length,y=b>12,[g,I]=(0,n.useState)(!0),_=y&&!g?p.split("\n").slice(0,12).join("\n")+"\n…":p;return(0,t.jsxs)("div",{className:(0,c.cn)("rounded-xl border border-zinc-800 bg-zinc-950",h),children:[(0,t.jsxs)("div",{className:"flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800 px-3 py-2",children:[(0,t.jsxs)("div",{className:"min-w-0",children:[(0,t.jsx)("p",{className:"text-[11px] font-semibold uppercase tracking-wide text-zinc-400",children:e}),d?(0,t.jsx)("p",{className:"mt-0.5 text-[12px] leading-snug text-zinc-500",children:d}):null]}),(0,t.jsxs)(s.Button,{type:"button",size:"sm",variant:"secondary",className:"h-8 shrink-0 gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700",onClick:async()=>{await (0,l.copyToClipboard)(p,u.replace(/^Copy\s+/i,"")),f(!0),window.setTimeout(()=>f(!1),2e3)},children:[m?(0,t.jsx)(o.Check,{className:"size-3.5"}):(0,t.jsx)(a.Copy,{className:"size-3.5"}),m?"Copied":u]})]}),(0,t.jsx)("pre",{className:"p-3 text-[11px] leading-relaxed text-zinc-100",children:(0,t.jsx)("code",{children:_})}),y&&(0,t.jsx)("button",{type:"button",onClick:()=>I(e=>!e),className:"flex w-full items-center justify-center gap-1.5 border-t border-zinc-800 py-2 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200",children:g?(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(r.default,{className:"size-3.5"})," Collapse"]}):(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)(i.ChevronDown,{className:"size-3.5"})," Show all ",b," lines"]})})]})}],787610)},65066,e=>{"use strict";var t=e.i(151351);let n="plex-placeholder",o="jellyfin-connector",i="1970-01-01T00:00:00.000Z";e.s(["DEFAULT_JELLYFIN_INTEGRATION",0,{id:o,type:"CUSTOM",name:"Jellyfin",enabled:!1,config:{status:"not_connected",connectorKind:"jellyfin"},createdAt:i,updatedAt:i},"DEFAULT_PLEX_INTEGRATION",0,{id:n,type:"PLEX",name:"Plex",enabled:!1,config:{status:"not_connected"},createdAt:i,updatedAt:i},"JELLYFIN_INTEGRATION_ID",0,o,"PLEX_INTEGRATION_ID",0,n,"getJellyfinStatus",0,function(e){return(0,t.fetchApi)("/integrations/jellyfin/status",{method:"GET",signal:e})},"getPlexStatus",0,function(e){return(0,t.fetchApi)("/integrations/plex/status",{method:"GET",signal:e})},"setupJellyfinFolders",0,function(){return(0,t.fetchApi)("/integrations/jellyfin/setup-folders",{method:"POST",body:{}})},"setupPlexFolders",0,function(){return(0,t.fetchApi)("/integrations/plex/setup-folders",{method:"POST",body:{}})},"updateJellyfinIntegration",0,function(e){return(0,t.fetchApi)("/integrations/jellyfin",{method:"PATCH",body:e})},"updatePlexIntegration",0,function(e){return(0,t.fetchApi)("/integrations/plex",{method:"PATCH",body:e})}])},982194,e=>{"use strict";e.s(["ARCIIN_INTEGRATION_CODE_AI_APPEND",0,'\n## Integration code generation (Python, Node.js, curl, Postman)\n\nWhen the user asks you to **write code**, **create a script**, **automate uploads**, **listen to events**, or **call the API** from outside the browser:\n\n### Required behavior\n1. If they did **not** name a language, ask once: *"Do you want Python, Node.js, curl, or Postman?"* — then give **only** the chosen format.\n2. Copy **REST API base** and **library ids** from the **"--- Current Instance Data ---"** block. Never invent ids (they are **cuid** strings like `clx…`, not UUIDs).\n3. Prefer **complete, runnable** examples with a CONFIG section at the top (API base, API key or email/password, file path). Mention `pip install requests` for Python and that keys need the right **scopes**.\n4. Mention matching scripts by **filename only** (e.g. `api/06_upload_to_library.py`) — they live on the server under `scripts/examples/`, not as web pages.\n5. **Footer links (required)** — use **only** these clickable in-app paths (never turn repo paths or REST_BASE into UI URLs):\n   - [Documentation → File uploads](/docs#uploads)\n   - [Documentation → Example scripts](/docs#example-scripts)\n   - [API Keys](/developer/api-keys)\n   - [Documentation](/docs) · [Events](/events)\n6. **Never** link to `http://…/scripts/examples/README.md` — that URL does not exist (404). **Never** put API keys under the REST host (e.g. `http://192.168.x.x:4000/developer/api-keys`). REST_BASE is for `curl`/`requests` only; UI links use relative paths on the **browser origin** (same host/port as the dashboard tab).\n\n### Upload API (current — do not use outdated 3-step JSON initiate flows)\n- **One request:** `POST {REST_BASE}/uploads` with **multipart** field `file`.\n- **Query (optional):** `targetLibraryId={libraryCuid}` and/or `targetFolderId={folderCuid}`.\n- **Omit** `targetLibraryId` to auto-route by MIME (video→Videos, image→Images, etc.).\n- **Auth:** `Authorization: Bearer arc_…` (API key with **uploads:create**; add **libraries:read** to resolve library id by slug) **or** session cookie after `POST {REST_BASE}/auth/login`.\n- **Not valid:** JSON body with `librarySlug` on POST /uploads, `DELETE /libraries/{id}/folders/{id}`, or UUID-shaped ids.\n- Resolve slug → id: `GET {REST_BASE}/libraries`, find `slug`, use that row\'s `id` as `targetLibraryId`.\n\n### Socket.IO (realtime)\n- Connect to the **API origin** (port **4000** in dev), not the Next.js UI port alone.\n- **API key:** header `Authorization: Bearer arc_…` with **events:subscribe** scope.\n- **Session:** login via REST, pass `Cookie` header on `socketio.Client().connect()`.\n- Listen for `upload.completed`, `upload.failed`, `asset.created`, `activity.created`, etc. Browser UI at [Events](/events) shows the same stream when logged in.\n\n### WSL / two-machine\n- Arciin in WSL, Python on Windows: `API_BASE = http://<WSL-IP>:4000/api` (run `bash scripts/examples/lib/wsl_hosts.sh` in WSL).\n- Web UI on Windows host: `http://localhost:3000`.\n\n### API key pitfalls (warn in code comments)\n- Paste the **full** `arc_…` secret from the one-time create dialog — not the short prefix in the table.\n- Revoked keys return `UNAUTHENTICATED`. Create a new key with correct scopes.\n\n### After external upload\n- User sees **Notifications** badge + sound in the dashboard when the tab is open and **Realtime live** (Socket.IO connected).\n',"buildCurlMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:n,librarySlug:o="images"}=e;return`export ARCIIN_KEY="arc_paste_full_key_here"
export API="${t}"
export FILE="./photo.jpg"
export LIB_ID="${n??"clx_paste_library_id"}"   # ${o} — from GET $API/libraries

curl -sS -X POST "$API/uploads?targetLibraryId=$LIB_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@$FILE" | jq .`},"buildNodeMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:n,librarySlug:o="images"}=e;return`// npm i form-data node-fetch  (Node 18+ can use global fetch + FormData)
import fs from "node:fs";
import path from "node:path";

const API_BASE = "${t}".replace(/\\/$/, "");
const API_KEY = process.env.ARCIIN_API_KEY ?? "arc_paste_full_key_here";
const FILE = "./photo.jpg";
const TARGET_LIBRARY_ID = "${n??"clx_paste_from_GET_libraries"}"; // slug "${o}" — from GET /libraries

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
console.log("OK", json.data.status, json.data.assetId);`},"buildPythonMultipartUploadSnippet",0,function(e){let{apiBase:t,libraryId:n,librarySlug:o="images"}=e,i=n?`# Library "${o}" id from GET /libraries:
TARGET_LIBRARY_ID = "${n}"`:`# Get id: GET ${t}/libraries — match slug "${o}"
TARGET_LIBRARY_ID = "clx_paste_from_libraries_response"`;return`#!/usr/bin/env python3
"""Upload one file to Arciin — multipart POST (see scripts/examples/api/06_upload_to_library.py)."""
# pip install requests

API_BASE = "${t}".rstrip("/")
API_KEY = "arc_paste_full_key_here"  # scopes: uploads:create, libraries:read

FILE_PATH = r"C:\\path\\to\\file.jpg"

${i}

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
print("OK", data.get("status"), data.get("assetId"), data.get("targetLibrary", {}).get("slug"))`},"buildPythonSocketSnippet",0,function(e){let{apiBase:t,socketUrl:n}=e;return`# pip install requests "python-socketio[client]" websocket-client
# Full script: scripts/examples/events/01_monitor_api_key.py

import os
import socketio

API_KEY = os.environ.get("ARCIIN_API_KEY", "arc_paste_full_key_here")
SOCKET_URL = "${n}"
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