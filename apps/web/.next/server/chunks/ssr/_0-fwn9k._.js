module.exports=[879765,a=>{"use strict";var b=a.i(692030);function c(a){if("u"<typeof document)return!1;let b=document.createElement("textarea");b.value=a,b.setAttribute("readonly",""),b.style.cssText="position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent",document.body.appendChild(b),b.focus(),b.select(),b.setSelectionRange(0,a.length);let c=!1;try{c=document.execCommand("copy")}finally{document.body.removeChild(b)}return c}function d(a,b){let d=b??a?.value??"";if(!d)return!1;if(a){a.focus(),a.select(),a.setSelectionRange(0,a.value.length);try{if(document.execCommand("copy"))return!0}catch{}}return c(d)}function e(a,b){if(!a)return!1;if(b&&d(b,a)||c(a))return!0;if("u">typeof navigator&&window.isSecureContext&&navigator.clipboard?.writeText)try{return navigator.clipboard.writeText(a),!0}catch{}return!1}async function f(a,b){if(e(a,b))return!0;if("u">typeof navigator&&navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(a),!0}catch{}return c(a)}async function g(a,c,d){let e=c?`${c} copied`:"Copied to clipboard";return await f(a,d)?(b.toast.success(e,{description:"Saved to your clipboard."}),!0):(b.toast.error("Could not copy",{description:"Select the field and press Ctrl+C (or Cmd+C)."}),!1)}a.s(["copyFromField",0,d,"copyTextNow",0,e,"copyToClipboard",0,g,"formatApiKeyPreview",0,function(a,b=14,c=8){return a.length<=b+c+3?a:`${a.slice(0,b)}…${a.slice(-c)}`}])},889107,a=>{"use strict";let b=(0,a.i(13248).default)("chevron-up",[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]);a.s(["default",0,b])},280286,a=>{"use strict";let b=(0,a.i(13248).default)("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);a.s(["default",0,b])},783697,a=>{"use strict";var b=a.i(280286);a.s(["ChevronDown",()=>b.default])},518469,a=>{"use strict";var b=a.i(299404);a.s(["Check",()=>b.default])},597790,a=>{"use strict";var b=a.i(520688),c=a.i(290155),d=a.i(559653),e=a.i(195819),f=a.i(147427),g=a.i(118867),h=a.i(780303),i=a.i(830419),j=a.i(273490),k=a.i(855277),l="Collapsible",[m,n]=(0,e.createContextScope)(l),[o,p]=m(l),q=c.forwardRef((a,d)=>{let{__scopeCollapsible:e,open:g,defaultOpen:h,disabled:j,onOpenChange:m,...n}=a,[p,q]=(0,f.useControllableState)({prop:g,defaultProp:h??!1,onChange:m,caller:l});return(0,b.jsx)(o,{scope:e,disabled:j,contentId:(0,k.useId)(),open:p,onOpenToggle:c.useCallback(()=>q(a=>!a),[q]),children:(0,b.jsx)(i.Primitive.div,{"data-state":w(p),"data-disabled":j?"":void 0,...n,ref:d})})});q.displayName=l;var r="CollapsibleTrigger",s=c.forwardRef((a,c)=>{let{__scopeCollapsible:e,...f}=a,g=p(r,e);return(0,b.jsx)(i.Primitive.button,{type:"button","aria-controls":g.contentId,"aria-expanded":g.open||!1,"data-state":w(g.open),"data-disabled":g.disabled?"":void 0,disabled:g.disabled,...f,ref:c,onClick:(0,d.composeEventHandlers)(a.onClick,g.onOpenToggle)})});s.displayName=r;var t="CollapsibleContent",u=c.forwardRef((a,c)=>{let{forceMount:d,...e}=a,f=p(t,a.__scopeCollapsible);return(0,b.jsx)(j.Presence,{present:d||f.open,children:({present:a})=>(0,b.jsx)(v,{...e,ref:c,present:a})})});u.displayName=t;var v=c.forwardRef((a,d)=>{let{__scopeCollapsible:e,present:f,children:j,...k}=a,l=p(t,e),[m,n]=c.useState(f),o=c.useRef(null),q=(0,h.useComposedRefs)(d,o),r=c.useRef(0),s=r.current,u=c.useRef(0),v=u.current,x=l.open||m,y=c.useRef(x),z=c.useRef(void 0);return c.useEffect(()=>{let a=requestAnimationFrame(()=>y.current=!1);return()=>cancelAnimationFrame(a)},[]),(0,g.useLayoutEffect)(()=>{let a=o.current;if(a){z.current=z.current||{transitionDuration:a.style.transitionDuration,animationName:a.style.animationName},a.style.transitionDuration="0s",a.style.animationName="none";let b=a.getBoundingClientRect();r.current=b.height,u.current=b.width,y.current||(a.style.transitionDuration=z.current.transitionDuration,a.style.animationName=z.current.animationName),n(f)}},[l.open,f]),(0,b.jsx)(i.Primitive.div,{"data-state":w(l.open),"data-disabled":l.disabled?"":void 0,id:l.contentId,hidden:!x,...k,ref:q,style:{"--radix-collapsible-content-height":s?`${s}px`:void 0,"--radix-collapsible-content-width":v?`${v}px`:void 0,...a.style},children:x&&j})});function w(a){return a?"open":"closed"}a.s(["Collapsible",0,q,"CollapsibleContent",0,u,"CollapsibleTrigger",0,s,"Content",0,u,"Root",0,q,"Trigger",0,s,"createCollapsibleScope",0,n],949090);var x=a.i(949090),x=x,y=a.i(74192);a.s(["Collapsible",0,function({className:a,...c}){return(0,b.jsx)(x.Root,{"data-slot":"collapsible",className:(0,y.cn)(a),...c})},"CollapsibleContent",0,function({className:a,...c}){return(0,b.jsx)(x.Content,{"data-slot":"collapsible-content",className:(0,y.cn)("overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",a),...c})},"CollapsibleTrigger",0,function({className:a,...c}){return(0,b.jsx)(x.Trigger,{"data-slot":"collapsible-trigger",className:(0,y.cn)(a),...c})}],597790)},503554,a=>{"use strict";var b=a.i(520688),c=a.i(290155),d=a.i(518469),e=a.i(783697),f=a.i(889107),f=f,g=a.i(553294),h=a.i(541487),i=a.i(879765),j=a.i(74192);a.s(["CopyableShellBlock",0,function({title:a,description:k,script:l,copyLabel:m="Copy script",className:n}){let[o,p]=(0,c.useState)(!1),q=l.split("\n").length,r=q>12,[s,t]=(0,c.useState)(!0),u=r&&!s?l.split("\n").slice(0,12).join("\n")+"\n…":l;return(0,b.jsxs)("div",{className:(0,j.cn)("rounded-xl border border-zinc-800 bg-zinc-950",n),children:[(0,b.jsxs)("div",{className:"flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800 px-3 py-2",children:[(0,b.jsxs)("div",{className:"min-w-0",children:[(0,b.jsx)("p",{className:"text-[11px] font-semibold uppercase tracking-wide text-zinc-400",children:a}),k?(0,b.jsx)("p",{className:"mt-0.5 text-[12px] leading-snug text-zinc-500",children:k}):null]}),(0,b.jsxs)(h.Button,{type:"button",size:"sm",variant:"secondary",className:"h-8 shrink-0 gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700",onClick:async()=>{await (0,i.copyToClipboard)(l,m.replace(/^Copy\s+/i,"")),p(!0),window.setTimeout(()=>p(!1),2e3)},children:[o?(0,b.jsx)(d.Check,{className:"size-3.5"}):(0,b.jsx)(g.Copy,{className:"size-3.5"}),o?"Copied":m]})]}),(0,b.jsx)("pre",{className:"p-3 text-[11px] leading-relaxed text-zinc-100",children:(0,b.jsx)("code",{children:u})}),r&&(0,b.jsx)("button",{type:"button",onClick:()=>t(a=>!a),className:"flex w-full items-center justify-center gap-1.5 border-t border-zinc-800 py-2 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200",children:s?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(f.default,{className:"size-3.5"})," Collapse"]}):(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(e.ChevronDown,{className:"size-3.5"})," Show all ",q," lines"]})})]})}],503554)},487167,a=>{"use strict";var b=a.i(109818);let c="plex-placeholder",d="jellyfin-connector",e="1970-01-01T00:00:00.000Z";a.s(["DEFAULT_JELLYFIN_INTEGRATION",0,{id:d,type:"CUSTOM",name:"Jellyfin",enabled:!1,config:{status:"not_connected",connectorKind:"jellyfin"},createdAt:e,updatedAt:e},"DEFAULT_PLEX_INTEGRATION",0,{id:c,type:"PLEX",name:"Plex",enabled:!1,config:{status:"not_connected"},createdAt:e,updatedAt:e},"JELLYFIN_INTEGRATION_ID",0,d,"PLEX_INTEGRATION_ID",0,c,"getJellyfinStatus",0,function(a){return(0,b.fetchApi)("/integrations/jellyfin/status",{method:"GET",signal:a})},"getPlexStatus",0,function(a){return(0,b.fetchApi)("/integrations/plex/status",{method:"GET",signal:a})},"setupJellyfinFolders",0,function(){return(0,b.fetchApi)("/integrations/jellyfin/setup-folders",{method:"POST",body:{}})},"setupPlexFolders",0,function(){return(0,b.fetchApi)("/integrations/plex/setup-folders",{method:"POST",body:{}})},"updateJellyfinIntegration",0,function(a){return(0,b.fetchApi)("/integrations/jellyfin",{method:"PATCH",body:a})},"updatePlexIntegration",0,function(a){return(0,b.fetchApi)("/integrations/plex",{method:"PATCH",body:a})}])},612271,a=>{"use strict";a.s(["ARCIIN_INTEGRATION_CODE_AI_APPEND",0,'\n## Integration code generation (Python, Node.js, curl, Postman)\n\nWhen the user asks you to **write code**, **create a script**, **automate uploads**, **listen to events**, or **call the API** from outside the browser:\n\n### Required behavior\n1. If they did **not** name a language, ask once: *"Do you want Python, Node.js, curl, or Postman?"* — then give **only** the chosen format.\n2. Copy **REST API base** and **library ids** from the **"--- Current Instance Data ---"** block. Never invent ids (they are **cuid** strings like `clx…`, not UUIDs).\n3. Prefer **complete, runnable** examples with a CONFIG section at the top (API base, API key or email/password, file path). Mention `pip install requests` for Python and that keys need the right **scopes**.\n4. Mention matching scripts by **filename only** (e.g. `api/06_upload_to_library.py`) — they live on the server under `scripts/examples/`, not as web pages.\n5. **Footer links (required)** — use **only** these clickable in-app paths (never turn repo paths or REST_BASE into UI URLs):\n   - [Documentation → File uploads](/docs#uploads)\n   - [Documentation → Example scripts](/docs#example-scripts)\n   - [API Keys](/developer/api-keys)\n   - [Documentation](/docs) · [Events](/events)\n6. **Never** link to `http://…/scripts/examples/README.md` — that URL does not exist (404). **Never** put API keys under the REST host (e.g. `http://192.168.x.x:4000/developer/api-keys`). REST_BASE is for `curl`/`requests` only; UI links use relative paths on the **browser origin** (same host/port as the dashboard tab).\n\n### Upload API (current — do not use outdated 3-step JSON initiate flows)\n- **One request:** `POST {REST_BASE}/uploads` with **multipart** field `file`.\n- **Query (optional):** `targetLibraryId={libraryCuid}` and/or `targetFolderId={folderCuid}`.\n- **Omit** `targetLibraryId` to auto-route by MIME (video→Videos, image→Images, etc.).\n- **Auth:** `Authorization: Bearer arc_…` (API key with **uploads:create**; add **libraries:read** to resolve library id by slug) **or** session cookie after `POST {REST_BASE}/auth/login`.\n- **Not valid:** JSON body with `librarySlug` on POST /uploads, `DELETE /libraries/{id}/folders/{id}`, or UUID-shaped ids.\n- Resolve slug → id: `GET {REST_BASE}/libraries`, find `slug`, use that row\'s `id` as `targetLibraryId`.\n\n### Socket.IO (realtime)\n- Connect to the **API origin** (port **4000** in dev), not the Next.js UI port alone.\n- **API key:** header `Authorization: Bearer arc_…` with **events:subscribe** scope.\n- **Session:** login via REST, pass `Cookie` header on `socketio.Client().connect()`.\n- Listen for `upload.completed`, `upload.failed`, `asset.created`, `activity.created`, etc. Browser UI at [Events](/events) shows the same stream when logged in.\n\n### WSL / two-machine\n- Arciin in WSL, Python on Windows: `API_BASE = http://<WSL-IP>:4000/api` (run `bash scripts/examples/lib/wsl_hosts.sh` in WSL).\n- Web UI on Windows host: `http://localhost:3000`.\n\n### API key pitfalls (warn in code comments)\n- Paste the **full** `arc_…` secret from the one-time create dialog — not the short prefix in the table.\n- Revoked keys return `UNAUTHENTICATED`. Create a new key with correct scopes.\n\n### After external upload\n- User sees **Notifications** badge + sound in the dashboard when the tab is open and **Realtime live** (Socket.IO connected).\n',"buildCurlMultipartUploadSnippet",0,function(a){let{apiBase:b,libraryId:c,librarySlug:d="images"}=a;return`export ARCIIN_KEY="arc_paste_full_key_here"
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

//# sourceMappingURL=_0-fwn9k._.js.map