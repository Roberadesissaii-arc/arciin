(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,230684,e=>{"use strict";e.i(809539);var s=e.i(992844),r=e.i(26263),t=e.i(452953),a=e.i(650654);e.i(924856);var i=e.i(302529),o=e.i(982194),n=e.i(96222),l=e.i(324803),d=e.i(152236),c=e.i(718239),p=e.i(787610);function h(e){if(!e?.mirrorRootHint)return[];let s=e.mirrorRootHint.replace(/\/$/,""),r=["videos","images","music"];return[...e.folders].sort((e,s)=>r.indexOf(e.librarySlug)-r.indexOf(s.librarySlug)).map(e=>({libraryName:e.libraryName,path:`${s}/${e.folderPath}`}))}function x(e,s){let r=s[e];if(r)return r;let t=s.librariesDir?.replace(/\/$/,"")??(s.storageRoot?`${s.storageRoot.replace(/\/$/,"")}/libraries`:"/srv/arciin-storage/arciin/libraries");return`${t}/${e}/jellyfin`}let m="/srv/plex";function u(e){if(!e)return{};let s=Object.fromEntries(h(e).map(s=>{let r=e.folders.find(e=>e.libraryName===s.libraryName);return[r?.librarySlug??s.libraryName,s.path]}));return{storageRoot:e.storageRoot,librariesDir:e.mirrorRootHint,videos:s.videos,images:s.images,music:s.music}}function b(e,s){let r=s[e];if(r)return r;let t=s.librariesDir?.replace(/\/$/,"")??(s.storageRoot?`${s.storageRoot.replace(/\/$/,"")}/libraries`:"/srv/arciin-storage/arciin/libraries");return`${t}/${e}/plex`}function f(e){let s=e.installDir??m,r=`${s}/config`,t=e.paths.videos??b("videos",e.paths),a=e.paths.images??b("images",e.paths),i=e.paths.music??b("music",e.paths),o=e.puid??"1000",n=e.pgid??"1000",l=e.tz??"America/New_York",d=e.claimToken??"claim-YOUR_TOKEN_FROM_https://plex.tv/claim";return`version: "3.8"

services:
  plex:
    image: lscr.io/linuxserver/plex:latest
    container_name: plex_server
    network_mode: host
    environment:
      - PUID=${o}
      - PGID=${n}
      - TZ=${l}
      - VERSION=docker
      - PLEX_CLAIM=${d}
    volumes:
      - ${r}:/config
      - ${t}:/movies:ro
      - ${a}:/photos:ro
      - ${i}:/music:ro
    restart: unless-stopped
`}function y(e){return e?.trim()?e.replace(/\/$/,""):null}function j(e){return/^\/(srv|opt|usr|var|etc|mnt)\//.test(e)}function g(e){return/^[a-zA-Z0-9_./-]+$/.test(e)?e:`'${e.replace(/'/g,"'\"'\"'")}'`}let I="ARCIIN_COMPOSE_YML_END",A={plex:["Arciin and Plex do not talk over the network. They share folders on the same machine (or any host that can read your storage root).","In Integrations, turn on Use Plex folders — Arciin registers Videos/Images/Music → Plex and creates those directories under your storage root (Settings → Storage). You do not need to create library folders manually on disk.","The setup script below only prepares /srv/plex (or your install dir): config/ plus docker-compose.yml beside it. Volume lines point at Arciin’s libraries/…/plex paths when folders are enabled.","When you upload in Arciin, files land under libraries/…/plex/. Plex reads them via Docker volume mounts in docker-compose.yml."],jellyfin:["Arciin and Jellyfin share disk folders the same way as Plex — there is no network API connection between them.","In Integrations, turn on Use Jellyfin folders — Arciin creates Videos/Images/Music → Jellyfin on disk. Do not mkdir those paths manually.","The setup script prepares your Jellyfin install dir (config/, cache/, docker-compose.yml). Use the paths shown for this instance in the compose file.","When you upload in Arciin, files land under libraries/…/jellyfin/. Jellyfin reads them via Docker volume mounts."]};function v({kind:e,status:r,pathsLoading:t,installDir:a,className:i}){var o;let n,l,c,m,b,_,P,N,w,E,k,S,T,$,z,R,C,L,O,B,D,U=(n=r?"plex"===e?u(r):function(e){if(!e)return{};let s=Object.fromEntries(h(e).map(s=>{let r=e.folders.find(e=>e.libraryName===s.libraryName);return[r?.librarySlug??s.libraryName,s.path]}));return{storageRoot:e.storageRoot,librariesDir:e.mirrorRootHint,videos:s.videos,images:s.images,music:s.music}}(r):{},l=y(r?.storageRoot),c=y(r?.mirrorRootHint),m={videos:n.videos,images:n.images,music:n.music},b=j(a)?"sudo ":"",_="plex"===e?`${b}mkdir -p ${g(`${a}/config`)}`:`${b}mkdir -p ${g(`${a}/config`)} ${g(`${a}/cache`)}`,R="plex"===e?f({installDir:a,paths:n}):(P=(o={installDir:a,paths:n}).installDir??"/srv/jellyfin",N=`${P}/config`,w=`${P}/cache`,E=o.paths.videos??x("videos",o.paths),k=o.paths.images??x("images",o.paths),S=o.paths.music??x("music",o.paths),T=o.puid??"1000",$=o.pgid??"1000",z=o.tz??"America/New_York",`version: "3.8"

services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin_server
    environment:
      - PUID=${T}
      - PGID=${$}
      - TZ=${z}
    volumes:
      - ${N}:/config
      - ${w}:/cache
      - ${E}:/media/movies:ro
      - ${k}:/media/photos:ro
      - ${S}:/media/music:ro
    ports:
      - "8096:8096"
    restart: unless-stopped
`),C=`${a}/docker-compose.yml`,{script:(L=j(a)?"sudo ":"",O="plex"===e?"Plex":"Jellyfin",B="plex"===e?"plex":"jellyfin",D=["# Paste into your SSH session on the host that runs Arciin (runs line by line; safe to paste).",`# ${O} stack — separate from Arciin data under your storage root.`,"#",`#   ${a}/docker-compose.yml   ← compose file (edit claim token / PUID / PGID here)`,`#   ${a}/config/            ← ${O} app database (created empty)`,..."jellyfin"===e?[`#   ${a}/cache/             ← Jellyfin transcode cache`]:[],"#",`# Arciin media paths: enable "Use ${O} folders" in Integrations — Arciin creates`,`# libraries/videos|images|music/${B}/ for you. Do not mkdir those here.`,"",`INSTALL_DIR=${g(a)}`,`${L}mkdir -p "$INSTALL_DIR/config"`],"jellyfin"===e&&D.push(`${L}mkdir -p "$INSTALL_DIR/cache"`),D.push("","# Write docker-compose.yml next to config/ (not inside config/)",`cat <<'${I}' | ${L}tee "$INSTALL_DIR/docker-compose.yml" > /dev/null`,R.trimEnd(),I,"",'echo ""','echo "Created $INSTALL_DIR/docker-compose.yml"','echo "         $INSTALL_DIR/config/"'),l?D.push(`echo "Arciin media folders: ${l}/libraries/…/${B}/"`):D.push(`echo "Tip: turn on Use ${O} folders in Arciin → Integrations, then re-copy the compose block for real volume paths."`),D.push(`echo 'Next: ${L}nano "$INSTALL_DIR/docker-compose.yml"'`,"echo 'Then: cd \"$INSTALL_DIR\" && docker compose up -d'"),D.join("\n")),stackMkdir:_,mediaMkdirs:[],storageRoot:l,librariesDir:c,mediaPaths:m,composePath:C}),K=function(e,s,r){let t="plex"===s?"plex":"jellyfin",a=y(e?.storageRoot)??"/srv/arciin-storage/arciin  ← your ARCIIN_DATA_DIR / Settings → Storage",i=h(e),o=`${r}/`,n=[`${a}/`,"  libraries/   ← Arciin creates …/plex (or jellyfin) when Integrations is enabled"];if(i.length>0)for(let s of i){let r=s.path.replace(`${y(e?.mirrorRootHint)??""}/`,"");n.push(`    ${r}/   ← ${s.libraryName} (${t})`)}else n.push(`    videos/${t}/`),n.push(`    images/${t}/`),n.push(`    music/${t}/`);return n.push(`  objects/          ← binary storage (not mounted in ${"plex"===s?"Plex":"Jellyfin"})`),n.push(""),n.push(`${o}   ← ${"plex"===s?"Plex":"Jellyfin"} Docker stack (not inside Arciin data)`),n.push("  docker-compose.yml"),n.push(`  config/           ← ${"plex"===s?"Plex":"Jellyfin"} database`),n.join("\n")}(r,e,a),Y=A[e];return(0,s.jsxs)("div",{className:(0,d.cn)("space-y-4",i),children:[(0,s.jsxs)("div",{className:"rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground",children:[(0,s.jsx)("p",{className:"font-semibold text-foreground",children:"How the connection works"}),(0,s.jsx)("ul",{className:"mt-2 list-disc space-y-1.5 pl-4",children:Y.map(e=>(0,s.jsx)("li",{children:e},e))})]}),(0,s.jsxs)("div",{className:"rounded-xl border border-border bg-muted/25 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground",children:[(0,s.jsx)("p",{className:"font-medium text-foreground",children:"Paths on this instance"}),t?(0,s.jsx)("p",{className:"mt-2 text-xs",children:"Loading storage root from the API…"}):(0,s.jsxs)(s.Fragment,{children:[U.storageRoot?(0,s.jsxs)("p",{className:"mt-2",children:[(0,s.jsx)("span",{className:"font-medium text-foreground",children:"Storage root: "}),(0,s.jsx)("span",{className:"break-all font-mono text-[11px] text-zinc-700",children:U.storageRoot})]}):null,(0,s.jsx)("pre",{className:"mt-2 overflow-x-auto font-mono text-[11px] text-zinc-700",children:K}),U.mediaPaths.videos||t?null:(0,s.jsxs)("p",{className:"mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900",children:["Turn on ",(0,s.jsxs)("strong",{children:["Use ","plex"===e?"Plex":"Jellyfin"," folders"]})," in the card above so Arciin registers folders and reports real paths (under your storage root, not a generic /srv example)."]})]})]}),(0,s.jsx)(p.CopyableShellBlock,{title:`Host setup — writes ${U.composePath}`,description:"Paste into SSH on the Arciin host. Creates the Plex/Jellyfin stack directory and docker-compose.yml (next to config/, not inside it). Library folders come from Integrations — not this script.",script:U.script,copyLabel:"Copy setup script"})]})}var _=e.i(65066),P=e.i(42720);function N({id:e,children:r}){return(0,s.jsxs)("h2",{id:e,className:"scroll-mt-28 flex items-center gap-3 font-heading text-[1.55rem] font-semibold tracking-tight text-zinc-900",children:[(0,s.jsx)("span",{className:"h-6 w-1 shrink-0 rounded-full bg-primary/70","aria-hidden":!0}),r]})}function w({children:e,className:r}){return(0,s.jsx)("p",{className:(0,d.cn)("text-[15px] leading-7 text-zinc-700",r),children:e})}function E({children:e}){return(0,s.jsx)("code",{className:"rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-900",children:e})}function k({variant:e,title:r,children:t}){return(0,s.jsxs)("aside",{className:`rounded-xl border border-zinc-200/80 border-l-4 px-4 py-3 text-sm leading-relaxed shadow-sm ${"warning"===e?"border-l-amber-500 bg-amber-50":"success"===e?"border-l-emerald-500 bg-emerald-50":"border-l-primary bg-primary/[0.06]"}`,children:[(0,s.jsx)("p",{className:"font-semibold text-zinc-900",children:r}),(0,s.jsx)("div",{className:"mt-1.5 text-zinc-700 [&>p+p]:mt-2",children:t})]})}function S(){return(0,s.jsx)("div",{className:"h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent"})}function T(){let e=(0,c.useQuery)({queryKey:P.queryKeys.plexStatus,queryFn:({signal:e})=>(0,_.getPlexStatus)(e)}),r=e.data,a=f({installDir:m,paths:u(r)});return(0,s.jsxs)("div",{className:"space-y-12",children:[(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"integrations-overview",children:"How connectors work"}),(0,s.jsxs)(w,{children:["Arciin connectors (Plex, Jellyfin) are ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"folder-based"}),", not a live Plex API link. When you enable a connector on"," ",(0,s.jsx)(t.default,{href:"/integrations",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Integrations"}),", Arciin creates ",(0,s.jsx)(E,{children:"Videos/Plex"}),", ",(0,s.jsx)(E,{children:"Images/Plex"}),", and ",(0,s.jsx)(E,{children:"Music/Plex"})," folders (or Jellyfin equivalents), routes new uploads there, and ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"mirrors files on disk"})," ","under ",(0,s.jsx)(E,{children:"libraries/<slug>/plex"})," inside your storage root."]}),(0,s.jsxs)("div",{className:"overflow-hidden rounded-xl border border-zinc-200 bg-white text-[13px] shadow-sm",children:[(0,s.jsx)("div",{className:"border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500",children:"Upload → Plex sees a file"}),(0,s.jsx)("pre",{className:"overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-zinc-600",children:`You upload a video in Arciin
  ↓
Asset stored under storage/objects/…
  ↓
Metadata in PostgreSQL (library, folder, filename)
  ↓
Connector mirror copies (or hard-links) into:
  <storage>/libraries/videos/plex/my-movie.mp4
  ↓
Plex library points at that folder on disk
  ↓
You scan the library in Plex → video appears`})]}),(0,s.jsx)(k,{variant:"tip",title:"What API keys, webhooks, and Socket.IO do",children:(0,s.jsxs)("p",{children:["They tell ",(0,s.jsx)("em",{children:"your"})," scripts and apps that Arciin finished an upload (",(0,s.jsx)(E,{children:"upload.completed"}),","," ",(0,s.jsx)(E,{children:"asset.created"}),"). They do ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"not"})," push bytes into a remote Plex server. Plex only sees new files when it can read the same folder path on disk (same host or a shared mount)."]})}),(0,s.jsxs)(w,{children:["Full REST examples for uploads and keys live in"," ",(0,s.jsx)("a",{href:"#uploads",className:"font-medium text-primary underline-offset-4 hover:underline",children:"File uploads"})," ","and"," ",(0,s.jsx)("a",{href:"#api-keys",className:"font-medium text-primary underline-offset-4 hover:underline",children:"API keys"}),"."]})]}),(0,s.jsx)(S,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"plex-same-server",children:"Plex on the same server"}),(0,s.jsxs)(w,{children:["Best case: Arciin and Plex run on one machine and Plex Docker mounts the ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"same"})," ","storage root Arciin uses. No API keys or webhooks are required for Plex to see files — only shared folders."]}),(0,s.jsxs)(w,{children:[(0,s.jsx)("strong",{className:"text-zinc-900",children:"Order of operations:"})," On"," ",(0,s.jsx)(t.default,{href:"/integrations",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Integrations"}),", turn on ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Use Plex folders"})," first. Arciin creates"," ",(0,s.jsx)(E,{children:"libraries/videos|images|music/plex"})," under your storage root (see"," ",(0,s.jsx)(t.default,{href:"/settings/storage",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Settings → Storage"}),"). Then install Plex and map libraries to those paths."]}),(0,s.jsxs)("div",{className:"rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700",children:[(0,s.jsx)("p",{className:"font-medium text-zinc-900",children:"Where files live on the host"}),(0,s.jsx)("pre",{className:"mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-800",children:`${m}/
  docker-compose.yml   ← setup script writes this here
  config/              ← Plex database

<your storage root>/libraries/…/plex/   ← Arciin mirrors uploads here`})]}),(0,s.jsx)(v,{kind:"plex",status:r,pathsLoading:e.isLoading,installDir:m}),(0,s.jsxs)(w,{children:["After the setup script runs: claim token from"," ",(0,s.jsx)("a",{href:"https://www.plex.tv/claim/",className:"font-medium text-primary underline-offset-4 hover:underline",target:"_blank",rel:"noopener noreferrer",children:"plex.tv/claim"}),", edit ",(0,s.jsxs)(E,{children:[m,"/docker-compose.yml"]})," (",(0,s.jsx)(E,{children:"PLEX_CLAIM"}),", ",(0,s.jsx)(E,{children:"PUID"}),","," ",(0,s.jsx)(E,{children:"PGID"}),"), then ",(0,s.jsxs)(E,{children:["cd ",m," && docker compose up -d"]}),"."]}),(0,s.jsx)(p.CopyableShellBlock,{title:`${m}/docker-compose.yml`,description:"Same file the setup script writes. Refresh volume paths if your storage root changed.",script:a,copyLabel:"Copy docker-compose.yml"}),(0,s.jsxs)("div",{className:"rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700",children:[(0,s.jsx)("p",{className:"font-medium text-zinc-900",children:"Plex library mapping"}),(0,s.jsxs)("p",{className:"mt-1.5 leading-relaxed",children:[(0,s.jsx)("strong",{className:"text-zinc-900",children:"Movies"})," → container ",(0,s.jsx)(E,{children:"/movies"})," (host:"," ",(0,s.jsx)(E,{children:"…/libraries/videos/plex"}),"), ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Photos"})," → ",(0,s.jsx)(E,{children:"/photos"}),","," ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Music"})," → ",(0,s.jsx)(E,{children:"/music"}),". Host paths must match the mirror paths Arciin shows on the Plex integration card."]})]})]}),(0,s.jsx)(S,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"plex-remote-server",children:"Plex on a different server"}),(0,s.jsxs)(w,{children:["Arciin does ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"not"})," stream files to a remote Plex box over the network. The remote Plex server must read the ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"same folder tree"}),"Arciin writes — usually by mounting Arciin's storage on the Plex host."]}),(0,s.jsx)(k,{variant:"warning",title:"API keys and webhooks are not a Plex transport",children:(0,s.jsxs)("p",{children:["An API key lets a script ",(0,s.jsx)("em",{children:"talk to Arciin"})," (upload, list assets). A webhook fires when Arciin finishes an upload. Neither copies the file to another machine. For split hosts, use NFS, SMB, or sync — then point Plex libraries at the mount."]})}),(0,s.jsxs)("div",{className:"space-y-4",children:[(0,s.jsxs)("div",{className:"rounded-xl border border-zinc-200 bg-white p-4 shadow-sm",children:[(0,s.jsx)("p",{className:"text-[13px] font-semibold text-zinc-900",children:"Option A — NFS (Linux → Linux)"}),(0,s.jsxs)(w,{className:"mt-2 text-sm",children:["Export ",(0,s.jsx)(E,{children:"/srv/arciin-storage/arciin/libraries"})," from the Arciin host. On the Plex server, mount it (e.g. ",(0,s.jsx)(E,{children:"/mnt/arciin-libraries"}),") and add Plex libraries that point at"," ",(0,s.jsx)(E,{children:"/mnt/arciin-libraries/videos/plex"}),", etc."]}),(0,s.jsx)("pre",{className:"overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100",children:`# Arciin host (/etc/exports)
/srv/arciin-storage/arciin/libraries  192.168.1.50(rw,sync,no_subtree_check)

# Plex host
sudo mount 192.168.1.10:/srv/arciin-storage/arciin/libraries /mnt/arciin-libraries`})]}),(0,s.jsxs)("div",{className:"rounded-xl border border-zinc-200 bg-white p-4 shadow-sm",children:[(0,s.jsx)("p",{className:"text-[13px] font-semibold text-zinc-900",children:"Option B — SMB (Windows / NAS)"}),(0,s.jsxs)(w,{className:"mt-2 text-sm",children:["Share the Arciin ",(0,s.jsx)(E,{children:"libraries"})," folder on the network. Map the share on the Plex machine and use those paths when creating Plex libraries."]})]}),(0,s.jsxs)("div",{className:"rounded-xl border border-zinc-200 bg-white p-4 shadow-sm",children:[(0,s.jsx)("p",{className:"text-[13px] font-semibold text-zinc-900",children:"Option C — Replication (advanced)"}),(0,s.jsxs)(w,{className:"mt-2 text-sm",children:["Use ",(0,s.jsx)(E,{children:"rsync"}),", Syncthing, or similar to replicate ",(0,s.jsx)(E,{children:"libraries/…/plex"})," to the Plex host. Run on a schedule or trigger from a webhook handler that starts a sync job — Arciin does not ship this job yet."]})]})]}),(0,s.jsx)(w,{children:"After the Plex server can read the mirrored paths, new Arciin uploads appear as files on disk immediately; Plex still needs a library scan (see next section)."})]}),(0,s.jsx)(S,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"plex-library-scan",children:"Refresh Plex libraries"}),(0,s.jsxs)(w,{children:["Arciin copies files into Plex folders but ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"does not call the Plex API"})," ","to refresh metadata. After uploads, tell Plex to scan:"]}),(0,s.jsxs)("ol",{className:"list-decimal space-y-2 pl-5 text-[15px] leading-7 text-zinc-700",children:[(0,s.jsxs)("li",{children:["Open Plex → your library → ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"⋯"})," → ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Scan Library Files"}),"."]}),(0,s.jsxs)("li",{children:["Or enable ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Settings → Library → Scan my library automatically"})," on the Plex server (periodic scan)."]})]}),(0,s.jsx)(k,{variant:"success",title:"Same-server tip",children:(0,s.jsx)("p",{children:"If Plex and Arciin share one storage root, uploads land in the folder Plex already watches — you only need scans when Plex does not auto-detect new files."})})]}),(0,s.jsx)(S,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"jellyfin-connector",children:"Jellyfin"}),(0,s.jsxs)(w,{children:["Jellyfin uses the ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"same connector model"})," as Plex: enable"," ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Use Jellyfin folders"})," on"," ",(0,s.jsx)(t.default,{href:"/integrations",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Integrations"}),", mirror into ",(0,s.jsx)(E,{children:"libraries/…/jellyfin"}),", then point Jellyfin libraries at those paths on disk."]}),(0,s.jsxs)(w,{children:["Same-server: mount the Arciin storage root in Jellyfin Docker. Remote server: NFS/SMB mount the"," ",(0,s.jsx)(E,{children:"libraries"})," tree on the Jellyfin host — identical to Plex remote setup."]}),(0,s.jsx)(w,{children:"Jellyfin setup commands and compose snippets are on the Jellyfin card under Integrations (same pattern as Plex)."})]}),(0,s.jsx)(S,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(N,{id:"connector-automation",children:"Webhooks, Socket.IO & API keys"}),(0,s.jsxs)(w,{children:["Use these when ",(0,s.jsx)("em",{children:"another app"})," should react to Arciin uploads — not when Plex needs the file bytes."]}),(0,s.jsx)("div",{className:"overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",children:(0,s.jsxs)("table",{className:"w-full border-collapse text-left text-sm",children:[(0,s.jsx)("thead",{children:(0,s.jsxs)("tr",{className:"border-b border-zinc-100 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500",children:[(0,s.jsx)("th",{className:"px-4 py-2 font-semibold",children:"Tool"}),(0,s.jsx)("th",{className:"px-4 py-2 font-semibold",children:"Use for connectors"})]})}),(0,s.jsxs)("tbody",{className:"divide-y divide-zinc-100 text-zinc-700",children:[(0,s.jsxs)("tr",{children:[(0,s.jsx)("td",{className:"px-4 py-2.5 font-medium",children:"API key"}),(0,s.jsxs)("td",{className:"px-4 py-2.5",children:["Upload from a script (",(0,s.jsx)(E,{children:"uploads:create"}),"), list assets, check folder paths. Does not notify Plex."]})]}),(0,s.jsxs)("tr",{children:[(0,s.jsx)("td",{className:"px-4 py-2.5 font-medium",children:"Webhook"}),(0,s.jsxs)("td",{className:"px-4 py-2.5",children:["Your server receives ",(0,s.jsx)(E,{children:"upload.completed"})," → run rsync, send a push notification, or log. Plex scan is still manual unless you automate it yourself."]})]}),(0,s.jsxs)("tr",{children:[(0,s.jsx)("td",{className:"px-4 py-2.5 font-medium",children:"Socket.IO"}),(0,s.jsxs)("td",{className:"px-4 py-2.5",children:["Live dashboard updates in Arciin; scripts can subscribe with ",(0,s.jsx)(E,{children:"events:subscribe"}),". Same events as webhooks."]})]})]})]})}),(0,s.jsxs)(w,{children:["See"," ",(0,s.jsx)("a",{href:"#webhooks",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Webhooks"}),","," ",(0,s.jsx)("a",{href:"#realtime",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Socket.IO"}),", and"," ",(0,s.jsx)("a",{href:"#events",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Event catalogue"})," ","for payloads. Configure webhook endpoints under"," ",(0,s.jsx)(t.default,{href:"/developer/webhooks",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Developer → Webhooks"}),"."]})]})]})}let $=[{label:"Getting started",items:[{id:"overview",label:"Overview"},{id:"upgrading",label:"Install & upgrade"},{id:"urls",label:"URLs & environment"}]},{label:"API & auth",items:[{id:"external-apps",label:"External apps & keys"},{id:"playground",label:"API explorer"},{id:"rest",label:"Authentication"},{id:"api-keys",label:"API keys"}]},{label:"Libraries & files",items:[{id:"libraries",label:"Libraries & folders"},{id:"assets",label:"Assets"},{id:"uploads",label:"File uploads"},{id:"example-scripts",label:"Example scripts"}]},{label:"Integrations",items:[{id:"integrations-overview",label:"How connectors work"},{id:"plex-same-server",label:"Plex · same server"},{id:"plex-remote-server",label:"Plex · remote server"},{id:"plex-library-scan",label:"Refresh Plex libraries"},{id:"jellyfin-connector",label:"Jellyfin"},{id:"connector-automation",label:"Webhooks & realtime"}]},{label:"App data",items:[{id:"databases",label:"App databases"}]},{label:"Realtime & access",items:[{id:"responses",label:"JSON responses"},{id:"realtime",label:"Socket.IO"},{id:"webhooks",label:"Webhooks"},{id:"remote",label:"Remote access"}]},{label:"Reference",items:[{id:"events",label:"Event catalogue"}]}],z="/api",R="http://localhost:4000",C="http://192.168.4.53:3002",L="http://localhost:4000".replace(/\/$/,""),O=z.startsWith("http")?z:`${C}${z}`,B=$.flatMap(e=>e.items),D=(0,r.createContext)({lang:"node",set:()=>{}}),U={node:"Node.js",python:"Python",curl:"curl",postman:"Postman"};function K({title:e,lang:t="js",children:a}){let[i,o]=(0,r.useState)(!1);async function n(){await (0,l.copyToClipboard)(a),o(!0),setTimeout(()=>o(!1),1800)}return(0,s.jsxs)("div",{className:"relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#09090b] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-black/[0.06]",children:[(0,s.jsx)("div",{className:"pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(180deg,rgba(255,75,51,0.08)_0%,transparent_40%)]","aria-hidden":!0}),(0,s.jsxs)("div",{className:"relative flex items-center justify-between border-b border-white/[0.07] bg-black/30 px-4 py-2",children:[(0,s.jsx)("span",{className:"text-[11px] font-semibold uppercase tracking-wide text-zinc-500",children:e??t}),(0,s.jsx)("button",{type:"button",onClick:n,className:"rounded px-2 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-zinc-300",children:i?"Copied!":"Copy"})]}),(0,s.jsx)("pre",{className:"overflow-x-auto p-4 text-[13px] leading-relaxed text-zinc-100",children:(0,s.jsx)("code",{children:a})})]})}function Y(){return`JSON REST base for this manual (paste as URL prefix in Postman):

${O}

Setup:
1. New → HTTP request.
2. Full URL = base above + path from the curl tab (e.g. …/libraries, …/auth/me). Paths are like /libraries — not /api-keys/libraries.
3. Authorization → Bearer Token → your arc_live_… key (or Headers: Authorization = Bearer …).
4. Accept: application/json.

Wrong URL (HTML login / 404): http://localhost:3000/api-keys/libraries
That path does not exist. To list libraries use:
GET ${O}/libraries
(scopes: libraries:read). The /api-keys routes only manage key records (admin), not library folders.`}function H({node:e,python:t,curl:a,postman:i,title:o}){let{lang:n}=(0,r.useContext)(D),l="postman"===n?i??Y():"python"===n?t:"curl"===n?a:e;if(!l){let r=e??t??a??i??Y();return(0,s.jsx)(K,{title:o,lang:"js",children:r})}return(0,s.jsx)(K,{title:o,lang:"postman"===n?"txt":"python"===n?"python":"curl"===n?"sh":"js",children:l})}function q({variant:e,title:r,children:t}){return(0,s.jsxs)("aside",{className:`rounded-xl border border-zinc-200/80 border-l-4 px-4 py-3 text-sm leading-relaxed shadow-sm ${"warning"===e?"border-l-amber-500 bg-amber-50":"success"===e?"border-l-emerald-500 bg-emerald-50":"border-l-primary bg-primary/[0.06]"}`,children:[(0,s.jsx)("p",{className:"font-semibold text-zinc-900",children:r}),(0,s.jsx)("div",{className:"mt-1.5 text-zinc-700 [&>p+p]:mt-2",children:t})]})}function G({id:e,children:r}){return(0,s.jsxs)("h2",{id:e,className:"scroll-mt-28 flex items-center gap-3 font-heading text-[1.55rem] font-semibold tracking-tight text-zinc-900",children:[(0,s.jsx)("span",{className:"h-6 w-1 shrink-0 rounded-full bg-primary/70","aria-hidden":!0}),r]})}function J({id:e,children:r,className:t}){return(0,s.jsx)("h3",{id:e,className:(0,d.cn)("scroll-mt-28 text-[15px] font-semibold tracking-tight text-zinc-900",t),children:r})}function F({children:e,className:r}){return(0,s.jsx)("p",{className:(0,d.cn)("text-[15px] leading-7 text-zinc-700",r),children:e})}function M({children:e}){return(0,s.jsx)("code",{className:"rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-900",children:e})}function W(){return(0,s.jsx)("div",{className:"h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent"})}function X({method:e,path:r,desc:t}){let a="GET"===e?"bg-emerald-100 text-emerald-800":"POST"===e?"bg-blue-100 text-blue-800":"PATCH"===e?"bg-amber-100 text-amber-800":"bg-red-100 text-red-800",i=r.replace(/:[a-zA-Z]+/g,"{id}"),o=i.startsWith("/")?i:`/${i}`;return(0,s.jsxs)("div",{className:"flex flex-col gap-1.5 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 shadow-sm sm:flex-row sm:items-start sm:gap-3",children:[(0,s.jsx)("span",{className:`mt-0.5 w-fit shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${a}`,children:e}),(0,s.jsxs)("div",{className:"min-w-0 flex-1 space-y-1",children:[(0,s.jsx)("span",{className:"font-mono text-[13px] text-zinc-900",children:r}),(0,s.jsx)("p",{className:"text-[12px] text-zinc-500",children:t}),(0,s.jsxs)("p",{className:"break-all font-mono text-[11px] leading-relaxed text-zinc-400",children:["→ ",(0,s.jsx)("span",{className:"text-zinc-600",children:"full URL shape:"})," ",O,o]})]})]})}function V({label:e,requests:t}){let[i,o]=(0,r.useState)(null);async function c(e,s){await (0,l.copyToClipboard)(e),o(s),setTimeout(()=>o(null),2e3)}return(0,s.jsxs)(n.Collapsible,{defaultOpen:!0,className:"rounded-xl border border-zinc-200/90 bg-zinc-50/80 shadow-sm",children:[(0,s.jsxs)(n.CollapsibleTrigger,{className:"flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-semibold text-zinc-800 transition-colors hover:bg-zinc-100/80 [&[data-state=open]>svg]:rotate-180",children:[e,(0,s.jsx)(a.ChevronDown,{className:"size-4 shrink-0 text-zinc-500 transition-transform duration-200","aria-hidden":!0})]}),(0,s.jsx)(n.CollapsibleContent,{children:(0,s.jsx)("div",{className:"space-y-2 border-t border-zinc-200/80 px-4 pb-4 pt-2",children:t.map(e=>{let r=`${O}${e.fullPath.startsWith("/")?e.fullPath:`/${e.fullPath}`}`,t=`${e.method}:${e.fullPath}`;return(0,s.jsxs)("div",{className:"flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3",children:[(0,s.jsxs)("div",{className:"min-w-0 flex-1 space-y-1",children:[(0,s.jsxs)("div",{className:"flex flex-wrap items-center gap-2",children:[(0,s.jsx)("span",{className:(0,d.cn)("rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase","GET"===e.method&&"bg-emerald-100 text-emerald-800","POST"===e.method&&"bg-blue-100 text-blue-800","PATCH"===e.method&&"bg-amber-100 text-amber-800","DELETE"===e.method&&"bg-red-100 text-red-800"),children:e.method}),e.hint?(0,s.jsx)("span",{className:"text-[11px] text-zinc-500",children:e.hint}):null]}),(0,s.jsx)("code",{className:"block break-all font-mono text-[12px] leading-relaxed text-zinc-800",children:r})]}),(0,s.jsx)("button",{type:"button",onClick:()=>c(r,t),className:"shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.06]",children:i===t?"Copied":"Copy URL"})]},t)})})})]})}function Q(){let{lang:e,set:t}=(0,r.useContext)(D);return(0,s.jsxs)("div",{className:"-mx-1 flex items-center gap-1 rounded-xl border border-zinc-200/80 bg-white/80 px-2 py-2 shadow-sm backdrop-blur-sm",children:[(0,s.jsx)("span",{className:"mr-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400",children:"Language"}),Object.keys(U).map(r=>(0,s.jsx)("button",{type:"button",onClick:()=>t(r),className:(0,d.cn)("rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",e===r?"bg-primary text-white shadow-sm":"text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"),children:U[r]},r))]})}let Z={Uploads:{events:["upload.started","upload.progress","upload.completed","upload.failed"],desc:"File ingest lifecycle."},Assets:{events:["asset.created","asset.updated","asset.moved","asset.deleted","asset.classified"],desc:"Asset lifecycle."},Media:{events:["thumbnail.created","media.metadata.extracted","media.processing.completed","media.processing.failed"],desc:"Background worker events."},Libraries:{events:["library.created","library.updated","library.scanned"],desc:"Library changes."},Jobs:{events:["job.created","job.progress","job.completed","job.failed"],desc:"BullMQ job lifecycle."},Activity:{events:["activity.created"],desc:"All user and system actions."},Plex:{events:["plex.connected","plex.sync.started","plex.sync.completed","plex.sync.failed"],desc:"Plex sync lifecycle (coming soon)."}},ee={GET:"text-emerald-700 bg-emerald-50 border-emerald-200",POST:"text-blue-700 bg-blue-50 border-blue-200",PATCH:"text-amber-700 bg-amber-50 border-amber-200",PUT:"text-amber-700 bg-amber-50 border-amber-200",DELETE:"text-red-700 bg-red-50 border-red-200"};function es(){let[e,t]=(0,r.useState)("GET"),[a,i]=(0,r.useState)("/auth/me"),[o,n]=(0,r.useState)("headers"),[l,c]=(0,r.useState)([{id:"a1",key:"Authorization",value:"Bearer arc_live_your_key_here",enabled:!0}]),[p,h]=(0,r.useState)("{\n  \n}"),[x,m]=(0,r.useState)(null),[u,b]=(0,r.useState)(!1),f=["POST","PATCH","PUT"].includes(e);async function y(){b(!0);let s=Date.now();try{let r=`${z}${a.startsWith("/")?a:`/${a}`}`,t={"Content-Type":"application/json",Accept:"application/json"};for(let e of l)e.enabled&&e.key.trim()&&(t[e.key.trim()]=e.value.trim());let i=await fetch(r,{method:e,headers:t,credentials:"include",body:f&&p.trim()?p:void 0}),o=await i.text(),n=o;try{n=JSON.stringify(JSON.parse(o),null,2)}catch{}m({status:i.status,statusText:i.statusText,ms:Date.now()-s,text:n})}catch(e){m({status:0,statusText:e instanceof Error?e.message:"Network error",ms:Date.now()-s,text:""})}finally{b(!1)}}return(0,s.jsxs)("div",{className:"overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",children:[(0,s.jsxs)("div",{className:"flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5",children:[(0,s.jsx)("select",{value:e,onChange:e=>{t(e.target.value),["POST","PATCH","PUT"].includes(e.target.value)||n("headers")},className:(0,d.cn)("cursor-pointer rounded-lg border px-2.5 py-1.5 font-mono text-[12px] font-bold outline-none",ee[e]??""),children:["GET","POST","PATCH","PUT","DELETE"].map(e=>(0,s.jsx)("option",{value:e,children:e},e))}),(0,s.jsxs)("div",{className:"flex flex-1 items-center overflow-hidden rounded-lg border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20",children:[(0,s.jsx)("span",{className:"shrink-0 select-none font-mono text-[12px] text-zinc-400",children:z}),(0,s.jsx)("input",{value:a,onChange:e=>i(e.target.value),onKeyDown:e=>"Enter"===e.key&&y(),className:"flex-1 bg-transparent pl-0.5 font-mono text-[13px] text-zinc-900 outline-none",placeholder:"/auth/me",spellCheck:!1})]}),(0,s.jsx)("button",{type:"button",onClick:y,disabled:u,className:"shrink-0 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60",children:u?"Sending…":"Send"})]}),(0,s.jsx)("div",{className:"flex border-b border-zinc-100",children:["headers",...f?["body"]:[]].map(e=>(0,s.jsxs)("button",{type:"button",onClick:()=>n(e),className:(0,d.cn)("px-4 py-2 text-[12px] font-semibold capitalize transition-colors",o===e?"border-b-2 border-primary text-primary":"text-zinc-400 hover:text-zinc-700"),children:[e,"headers"===e&&(0,s.jsx)("span",{className:"ml-1.5 rounded-md bg-zinc-100 px-1 py-0.5 text-[10px] tabular-nums text-zinc-500",children:l.filter(e=>e.enabled&&e.key).length})]},e))}),"headers"===o&&(0,s.jsxs)("div",{className:"p-3",children:[(0,s.jsxs)("table",{className:"w-full border-separate border-spacing-y-1 text-[12px]",children:[(0,s.jsx)("thead",{children:(0,s.jsxs)("tr",{children:[(0,s.jsx)("th",{className:"w-5 text-left"}),(0,s.jsx)("th",{className:"pb-1 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400",children:"Key"}),(0,s.jsx)("th",{className:"pb-1 pl-2 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400",children:"Value"}),(0,s.jsx)("th",{className:"w-6"})]})}),(0,s.jsx)("tbody",{children:l.map(e=>(0,s.jsxs)("tr",{className:"group",children:[(0,s.jsx)("td",{className:"pr-2",children:(0,s.jsx)("input",{type:"checkbox",checked:e.enabled,onChange:s=>c(r=>r.map(r=>r.id===e.id?{...r,enabled:s.target.checked}:r)),className:"accent-primary rounded"})}),(0,s.jsx)("td",{children:(0,s.jsx)("input",{value:e.key,onChange:s=>c(r=>r.map(r=>r.id===e.id?{...r,key:s.target.value}:r)),className:"w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[12px] text-zinc-700 outline-none focus:border-primary/40 focus:bg-white",placeholder:"Header-Name"})}),(0,s.jsx)("td",{className:"pl-2",children:(0,s.jsx)("input",{value:e.value,onChange:s=>c(r=>r.map(r=>r.id===e.id?{...r,value:s.target.value}:r)),className:"w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[12px] text-zinc-700 outline-none focus:border-primary/40 focus:bg-white",placeholder:"value"})}),(0,s.jsx)("td",{className:"pl-2",children:(0,s.jsx)("button",{type:"button",onClick:()=>c(s=>s.filter(s=>s.id!==e.id)),className:"rounded p-1 text-zinc-300 transition-colors hover:text-red-500 group-hover:text-zinc-400","aria-label":"Remove",children:"×"})})]},e.id))})]}),(0,s.jsx)("button",{type:"button",onClick:()=>c(e=>[...e,{id:crypto.randomUUID(),key:"",value:"",enabled:!0}]),className:"mt-1 text-[11px] font-medium text-primary hover:underline",children:"+ Add header"})]}),"body"===o&&f&&(0,s.jsx)("div",{className:"p-3",children:(0,s.jsx)("textarea",{value:p,onChange:e=>h(e.target.value),rows:7,spellCheck:!1,className:"w-full rounded-xl border border-zinc-200 bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus:border-primary/40",placeholder:'{"key": "value"}'})}),x&&(0,s.jsxs)("div",{className:"border-t border-zinc-200",children:[(0,s.jsxs)("div",{className:"flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-2",children:[(0,s.jsxs)("span",{className:(0,d.cn)("text-[12px] font-bold tabular-nums",x.status>=200&&x.status<300?"text-emerald-400":x.status>=400?"text-red-400":"text-zinc-400"),children:[x.status||"—"," ",x.statusText]}),(0,s.jsxs)("span",{className:"text-[11px] text-zinc-500",children:[x.ms," ms"]})]}),(0,s.jsx)("pre",{className:"overflow-x-auto bg-zinc-950 p-4 text-[12px] leading-relaxed text-zinc-100",children:(0,s.jsx)("code",{children:x.text||"(empty response)"})})]})]})}e.s(["DocumentationManual",0,function(){let[e,a]=(0,r.useState)("overview"),[n,l]=(0,r.useState)("node"),c=(0,r.useRef)(null),p=(0,r.useCallback)((e,s=!0)=>{let r=document.getElementById(e);if(!r)return;r.scrollIntoView({behavior:s?"smooth":"auto",block:"start"}),a(e);let t=`#${e}`;window.location.hash!==t&&window.history.replaceState(null,"",t)},[]),h=(0,r.useCallback)((e,s)=>{s.metaKey||s.ctrlKey||s.shiftKey||s.altKey||0!==s.button||(s.preventDefault(),p(e))},[p]);return(0,r.useEffect)(()=>{let e=c.current;if(!e)return;let s=function(e){let s=e?.parentElement??null;for(;s;){let{overflowY:e}=getComputedStyle(s);if("auto"===e||"scroll"===e||"overlay"===e)return s;s=s.parentElement}return null}(e.querySelector("h2[id]")??e),r=()=>{let r=Array.from(e.querySelectorAll("h2[id]"));if(0===r.length)return;let t=s?s.getBoundingClientRect().top+96:96,i=r[0].id;for(let e of r)if(e.getBoundingClientRect().top<=t)i=e.id;else break;a(e=>e===i?e:i);{let e=`#${i}`;window.location.hash!==e&&window.history.replaceState(null,"",e)}},t=s??window;t.addEventListener("scroll",r,{passive:!0}),window.addEventListener("resize",r);let i=new Set(B.map(e=>e.id)),o=window.location.hash.slice(1),n=o?({"plex-media-server":"plex-same-server"})[o]??o:"";return n&&i.has(n)&&queueMicrotask(()=>p(n,!1)),r(),()=>{t.removeEventListener("scroll",r),window.removeEventListener("resize",r)}},[p]),(0,s.jsx)(D.Provider,{value:{lang:n,set:l},children:(0,s.jsxs)("div",{className:"xl:grid xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] xl:items-start xl:gap-12",children:[(0,s.jsxs)("nav",{"aria-label":"On this page",className:"mb-10 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white/80 p-4 text-sm shadow-sm ring-1 ring-black/[0.04] backdrop-blur-sm xl:sticky xl:top-8 xl:mb-0 xl:block",children:[(0,s.jsx)("p",{className:"mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400",children:"On this page"}),(0,s.jsx)("ul",{className:"space-y-3",children:$.map(r=>(0,s.jsxs)("li",{children:[(0,s.jsx)("p",{className:"mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400",children:r.label}),(0,s.jsx)("ul",{className:"space-y-0.5",children:r.items.map(({id:r,label:t})=>{let a=e===r;return(0,s.jsx)("li",{className:(0,d.cn)("rounded-lg border-l-[3px] transition-colors",a?"border-primary bg-primary/[0.1]":"border-transparent hover:bg-zinc-100/70"),children:(0,s.jsx)("a",{href:`#${r}`,onClick:e=>h(r,e),className:(0,d.cn)("block rounded-r-md py-2 pl-3 pr-2 text-[13px] transition-colors",a?"font-semibold text-primary":"text-zinc-600 hover:text-zinc-900"),children:t})},r)})})]},r.label))}),(0,s.jsxs)("p",{className:"mt-5 border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-400",children:["Values in ",(0,s.jsx)("span",{className:"font-mono",children:"code blocks"}),"use this instance's env vars."]})]}),(0,s.jsxs)("div",{className:"min-w-0 space-y-5",children:[(0,s.jsx)(Q,{}),(0,s.jsxs)("article",{ref:c,className:"space-y-12 border-t border-zinc-200/80 pt-5 xl:border-t-0 xl:pt-0",children:[(0,s.jsxs)("nav",{className:"rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-4 xl:hidden",children:[(0,s.jsx)("p",{className:"mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500",children:"Jump to"}),(0,s.jsx)("div",{className:"flex flex-wrap gap-2",children:B.map(({id:r,label:t})=>{let a=e===r;return(0,s.jsx)("a",{href:`#${r}`,onClick:e=>h(r,e),className:(0,d.cn)("rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors",a?"border-primary/50 bg-primary/[0.12] text-primary":"border-zinc-200 bg-white text-zinc-700 hover:border-primary/30 hover:text-primary"),children:t},r)})})]}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"overview",children:"Overview"}),(0,s.jsxs)(F,{children:["Arciin is a self-hosted private file, library, and media management platform. The web app talks to a separate ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Fastify API"})," and optional ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"BullMQ workers"}),". This manual covers every integration surface: REST, uploads, app databases, realtime events, and webhooks."]}),(0,s.jsxs)("div",{className:"overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",children:[(0,s.jsx)("div",{className:"border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400",children:"Architecture"}),(0,s.jsx)("pre",{className:"overflow-auto p-4 font-mono text-[12px] leading-7 text-zinc-600",children:`Browser / your script
  ↓ HTTPS
  ┌─────────────────────────────┐
  │   Next.js web app  :3000    │
  └──────────────┬──────────────┘
                 │ REST / Socket.IO
  ┌──────────────▼──────────────┐
  │   Fastify API       :4000   │
  └──────┬────────────┬─────────┘
         │ Prisma     │ BullMQ
  ┌──────▼──┐   ┌─────▼──────┐
  │ Postgres│   │   Redis    │
  └─────────┘   └────┬───────┘
                     │
              ┌──────▼──────┐
              │   Workers   │
              └─────────────┘`})]})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"upgrading",children:"Install & upgrade"}),(0,s.jsxs)(F,{children:["First-time setup uses ",(0,s.jsx)(M,{children:"install.sh"})," from the repository root (dependencies, ",(0,s.jsx)(M,{children:".env"}),", migrations, storage). After that, when you pull changes or edit the server yourself, rebuild and restart the three PM2 apps."]}),(0,s.jsx)(K,{title:"Upgrade after git pull",lang:"sh",children:`cd /path/to/arciin
git pull
pnpm install
pnpm exec prisma migrate deploy
pnpm build
pm2 restart arciin-api arciin-web arciin-worker`}),(0,s.jsxs)(F,{children:[(0,s.jsx)(M,{children:"pnpm build"})," compiles the Next.js web app, Fastify API, and worker. Restart ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"arciin-api"}),", ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"arciin-web"}),", and ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"arciin-worker"})," so each process loads the new output. If you only changed ",(0,s.jsx)(M,{children:".env"}),", restart is enough — no build required."]}),(0,s.jsx)(K,{title:"Check processes",lang:"sh",children:`pm2 status
pm2 logs arciin-api --lines 50`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"urls",children:"URLs & environment"}),(0,s.jsx)("div",{className:"grid gap-3 sm:grid-cols-2",children:[{label:"Web app",value:C,note:"Browser UI. Session cookie is set here after email/password login."},{label:"REST API base",value:O,note:'Use this string as PREFIX: every path in this manual is appended to it (e.g. base + "/libraries").'},{label:"Direct API (optional)",value:`${L}/api`,note:"Bypass Next.js by calling Fastify on its port when the proxy is not involved.",wide:!0},{label:"Socket.IO server",value:R,note:"Connect socket.io-client to this origin.",wide:!0}].map(e=>(0,s.jsxs)("div",{className:(0,d.cn)("rounded-xl border border-zinc-200 bg-white p-4 shadow-sm",e.wide&&"sm:col-span-2"),children:[(0,s.jsx)("p",{className:"text-[11px] font-bold uppercase tracking-wide text-primary",children:e.label}),(0,s.jsx)("p",{className:"mt-1 break-all font-mono text-[13px] text-zinc-800",children:e.value}),(0,s.jsx)("p",{className:"mt-1.5 text-[12px] text-zinc-500",children:e.note})]},e.label))}),(0,s.jsx)(K,{title:".env",lang:"sh",children:`NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_ARCIIN_API_ORIGIN=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_ARCIIN_PUBLIC_URL=http://localhost:3000
ARCIIN_API_URL=http://localhost:4000
DATABASE_URL=postgresql://user:pass@localhost:5432/arciin
REDIS_URL=redis://localhost:6379
SESSION_SECRET=replace-with-64-char-random-string`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"external-apps",children:"Your website, another server & API keys"}),(0,s.jsxs)(F,{children:[(0,s.jsx)("strong",{className:"text-zinc-900",children:"You do not use your Arciin email/password inside your own app."})," That login only exists for humans using the Arciin web UI in a browser (it sets an httpOnly session cookie on the Arciin origin)."]}),(0,s.jsxs)(F,{children:["To call Arciin from ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"your website backend, a script, or curl"}),", create an ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"API key"})," once in Arciin (",(0,s.jsx)(t.default,{href:"/developer/api-keys",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Developer → API Keys"}),"), choose the ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"scopes"})," you need (e.g. ",(0,s.jsx)(M,{children:"libraries:read"}),", ",(0,s.jsx)(M,{children:"assets:read"}),", ",(0,s.jsx)(M,{children:"uploads:create"}),"), and store the raw key server-side—same idea as a Supabase service role or Firebase server key: one secret represents that integration."]}),(0,s.jsx)(q,{variant:"warning",title:'Why you saw "Sign in" or 401',children:(0,s.jsxs)("p",{children:["Every JSON API request must send ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"either"})," the browser session cookie (only works from the Arciin web app, same origin) ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"or"})," an ",(0,s.jsx)(M,{children:"Authorization: Bearer arc_…"})," header with a valid API key. If you paste only ",(0,s.jsx)(M,{children:"http://IP:4000/api/libraries"})," in the browser address bar, there is ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"no"})," cookie and ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"no"})," Bearer header—you will get 401. That is expected: use curl/your server with the header instead."]})}),(0,s.jsx)(J,{children:"Copy-paste: list libraries from another machine (LAN IP)"}),(0,s.jsxs)(F,{children:["Replace ",(0,s.jsx)(M,{children:"YOUR_KEY"})," with your API key, ",(0,s.jsx)(M,{children:"192.168.x.x"})," with your server IP. The REST prefix is always ",(0,s.jsx)(M,{children:"/api"})," then the path from this manual (e.g. ",(0,s.jsx)(M,{children:"/libraries"}),")."]}),(0,s.jsx)(K,{title:"curl (direct to Fastify)",lang:"sh",children:`curl -sS -H "Authorization: Bearer YOUR_KEY" \\
  -H "Accept: application/json" \\
  "${L}/api/libraries"`}),(0,s.jsx)(K,{title:"curl (via Next.js proxy on :3000, same as browser origin)",lang:"sh",children:`curl -sS -H "Authorization: Bearer YOUR_KEY" \\
  -H "Accept: application/json" \\
  "${C}/api/libraries"`}),(0,s.jsxs)(F,{children:["Your separate product’s ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"user accounts"})," (Google login, etc.) stay in ",(0,s.jsx)("em",{children:"your"})," app. Arciin does not replace that. The API key ties automation to ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"one Arciin user"})," on the server—the owner of the key—so keep keys on the server and never ship them to browsers if the key can write or upload."]})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"playground",children:"API explorer"}),(0,s.jsxs)(F,{children:["Try any endpoint directly from this page. Paste your API key in the Authorization header, pick a method, enter a path relative to the base URL, and hit ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Send"}),". The response appears below with status code and latency."]}),(0,s.jsx)(q,{variant:"tip",title:"Same-origin requests",children:"Requests go from your browser to the API server. Session cookies are included automatically — no API key needed for endpoints that accept cookie auth."}),(0,s.jsx)(es,{})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"rest",children:"Authentication"}),(0,s.jsxs)(F,{children:["Two auth mechanisms are supported. ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"Session cookie"})," for the Arciin web UI only (same origin as the app). ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"API key Bearer token"}),' for scripts, curl, and your own backends—this is how you integrate without "logging in" with a password on every request.']}),(0,s.jsx)(J,{children:"Reusable helper (start here)"}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["Below, ",(0,s.jsx)(M,{children:O})," is your ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"REST API base"}),' (same value as in "URLs & environment"). Every request is ',(0,s.jsx)(M,{children:O})," + path, e.g. ",(0,s.jsxs)(M,{children:[O,"/auth/me"]}),"."]}),(0,s.jsx)(V,{label:"Copy full URL — GET current user",requests:[{method:"GET",fullPath:"/auth/me",hint:"Bearer API key or session cookie"}]}),(0,s.jsx)(H,{title:"Helper — paste once, use everywhere",postman:`Environment: arciin_base = ${O}, arciin_key = arc_live_…

GET {{arciin_base}}/auth/me  \xb7  Authorization: Bearer {{arciin_key}}

List libraries: GET {{arciin_base}}/libraries`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}"; // same as docs "REST API base"

// One-off: full URL is \`\${BASE}/auth/me\`
const res = await fetch(\`\${BASE}/auth/me\`, {
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "application/json",
  },
});
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body));
console.log(body.data.user.name);

// Reusable helper (path only, still uses full BASE above):
async function arciin(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: \`Bearer \${API_KEY}\`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j));
  return j;
}
// Example full URLs: \`\${BASE}/libraries\`, \`\${BASE}/assets\` …`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"  # full REST base — request URL is always API + path

# One-off: requests.get("http://localhost:3000/api/auth/me") style
r = requests.get(
    f"{API}/auth/me",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
    timeout=60,
)
r.raise_for_status()
print(r.json()["data"]["user"]["name"])

# Session helper
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

def arciin(method, path, **kwargs):
    r = s.request(method, API + path, **kwargs)
    r.raise_for_status()
    return r.json()`,curl:`# Full URL for "who am I" is: ${O}/auth/me
export ARCIIN_KEY="arc_live_your_key_here"
curl -sS \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  "${O}/auth/me" | jq .

# Reuse base for other routes (same as docs REST base):
export API="${O}"

arc() {
  curl -sS \\
    -H "Authorization: Bearer $ARCIIN_KEY" \\
    -H "Accept: application/json" \\
    -H "Content-Type: application/json" \\
    "$@"
}

arc "$API/auth/me" | jq .data.user.name`}),(0,s.jsx)(J,{children:"Login with email + password (browser session)"}),(0,s.jsx)(H,{postman:`Email/password login sets a cookie — in Postman use the Cookie jar, not Bearer:

1. POST ${O}/auth/login
   Body → raw JSON: {"email":"…","password":"…"}
2. Postman saves cookies for the host if "Automatically follow redirects" / cookies enabled.
3. GET ${O}/auth/me with no Bearer header — cookie sent.

For automation prefer API keys (Bearer) instead of scraping cookies.`,node:`// Browser only — sets httpOnly session cookie
await fetch("${O}/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
});

// Subsequent calls send cookie automatically
const me = await fetch("${O}/auth/me", { credentials: "include" });`,python:`import requests

s = requests.Session()
s.post("${O}/auth/login",
    json={"email": "admin@example.com", "password": "secret"})

# Cookie is attached automatically
me = s.get("${O}/auth/me").json()
print(me["data"]["user"]["name"])`,curl:`# Same REST base as the rest of this manual:
export API="${O}"

# POST full URL: $API/auth/login
curl -c cookies.txt -sS -X POST "$API/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@example.com","password":"secret"}'

# GET full URL: $API/auth/me (cookie sent via -b)
curl -sS -b cookies.txt "$API/auth/me" | jq .`}),(0,s.jsx)(q,{variant:"warning",title:"Never paste live session cookies into chat or logs",children:"Session tokens grant full UI access. Prefer API keys for automation so you can scope and rotate access."})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"api-keys",children:"API keys"}),(0,s.jsxs)(F,{children:["Create scoped keys under ",(0,s.jsx)(t.default,{className:"font-medium text-primary underline-offset-4 hover:underline",href:"/developer/api-keys",children:"API keys"}),". The raw secret is shown once — store it immediately."]}),(0,s.jsxs)("div",{className:"space-y-2",children:[(0,s.jsx)(X,{method:"GET",path:"/api-keys",desc:"List all keys (prefix + scopes, secret never returned)"}),(0,s.jsx)(X,{method:"POST",path:"/api-keys",desc:"Create a key — rawKey returned once"}),(0,s.jsx)(X,{method:"POST",path:"/api-keys/:id/rotate",desc:"Issue a new secret, invalidate the old one"}),(0,s.jsx)(X,{method:"DELETE",path:"/api-keys/:id",desc:"Revoke permanently"})]}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["Managing keys is often done from the UI; from scripts you call ",(0,s.jsxs)(M,{children:["POST ",O,"/api-keys"]})," with an ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"admin session cookie"})," or a key that already has permission to create keys."]}),(0,s.jsx)(V,{label:"Copy full URLs — API keys admin routes",requests:[{method:"GET",fullPath:"/api-keys",hint:"List keys"},{method:"POST",fullPath:"/api-keys",hint:"Create — body: name, scopes"},{method:"DELETE",fullPath:"/api-keys/{keyId}",hint:"Revoke — substitute id"}]}),(0,s.jsx)(H,{title:"Create an API key",postman:`POST ${O}/api-keys
Authorization: Bearer YOUR_ADMIN_OR_SESSION — creating keys usually needs a logged-in admin; from Postman you can use cookie session after login, or call from the app UI.

Body (raw JSON):
{
  "name": "My integration",
  "scopes": ["libraries:read", "uploads:create", "assets:read"]
}

Response: copy data.rawKey once.

Then use that key as Bearer on all other requests (GET ${O}/libraries, etc.).`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_admin_or_existing_key";
const BASE = "${O}";
const auth = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

// POST — full URL: \`\${BASE}/api-keys\`
const res = await fetch(\`\${BASE}/api-keys\`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    name: "Uploader bot",
    scopes: ["uploads:create", "assets:read"],
  }),
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const { data } = json;
console.log(data.rawKey);  // "arc_live_abc…" — save this now
console.log(data.prefix);`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_admin_or_existing_key")
API = "${O}"  # full URL prefix

# POST — request URL = f"{API}/api-keys"
r = requests.post(
    f"{API}/api-keys",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    },
    json={
        "name": "Uploader bot",
        "scopes": ["uploads:create", "assets:read"],
    },
    timeout=60,
)
r.raise_for_status()
data = r.json()["data"]
print(data["rawKey"])
print(data["prefix"])`,curl:`export ARCIIN_KEY="arc_live_admin_or_existing_key"
export API="${O}"

# POST full URL: $API/api-keys
curl -sS -X POST "$API/api-keys" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Uploader bot","scopes":["uploads:create","assets:read"]}' \\
  | jq '{key:.data.rawKey,prefix:.data.prefix}'`}),(0,s.jsx)(J,{children:"Available scopes"}),(0,s.jsx)("div",{className:"grid gap-2 sm:grid-cols-2 lg:grid-cols-3",children:i.API_KEY_SCOPES.map(e=>(0,s.jsxs)("div",{className:"flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2",children:[(0,s.jsx)("span",{className:"size-1.5 shrink-0 rounded-full bg-primary/60"}),(0,s.jsx)("code",{className:"font-mono text-[12px] text-zinc-800",children:e})]},e))})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-8",children:[(0,s.jsx)(G,{id:"libraries",children:"Libraries & folders"}),(0,s.jsxs)(F,{children:["Arciin ships with ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"five fixed libraries"}),". You do"," ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"not"})," create new top-level libraries through the API — you"," ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"organize inside them"})," with ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"folders"}),", then upload or move assets."]}),(0,s.jsxs)("div",{className:"overflow-hidden rounded-xl border border-zinc-200 bg-white text-[13px] shadow-sm",children:[(0,s.jsxs)("div",{className:"border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500",children:["Default libraries (stable ",(0,s.jsx)(M,{children:"slug"})," · resolve ",(0,s.jsx)(M,{children:"id"})," via ",(0,s.jsx)(M,{children:"GET /libraries"}),", then ",(0,s.jsx)(M,{children:"targetLibraryId"})," on ",(0,s.jsx)(M,{children:"POST /uploads"}),")"]}),(0,s.jsxs)("table",{className:"w-full border-collapse text-left",children:[(0,s.jsx)("thead",{children:(0,s.jsxs)("tr",{className:"border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500",children:[(0,s.jsx)("th",{className:"px-4 py-2 font-semibold",children:"Library"}),(0,s.jsx)("th",{className:"px-4 py-2 font-semibold",children:"slug"}),(0,s.jsx)("th",{className:"px-4 py-2 font-semibold",children:"Typical use"})]})}),(0,s.jsx)("tbody",{className:"text-zinc-800",children:[["Videos","videos","Video files; optional subfolders (e.g. year, project)."],["Images","images","Photos & image assets."],["Music","music","Audio tracks & albums."],["Documents","documents","PDFs, docs, archives."],["Inbox","inbox","Unclassified or catch-all uploads."]].map(([e,r,t])=>(0,s.jsxs)("tr",{className:"border-b border-zinc-50 last:border-0",children:[(0,s.jsx)("td",{className:"px-4 py-2.5 font-medium",children:e}),(0,s.jsx)("td",{className:"px-4 py-2.5 font-mono text-[12px] text-primary",children:r}),(0,s.jsx)("td",{className:"px-4 py-2.5 text-zinc-600",children:t})]},r))})]})]}),(0,s.jsx)(q,{variant:"warning",title:"POST /libraries is disabled",children:(0,s.jsxs)("p",{children:["Calling ",(0,s.jsxs)(M,{children:["POST ",O,"/libraries"]})," returns ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"403"})," with code"," ",(0,s.jsx)(M,{children:"LIBRARY_CREATION_DISABLED"}),". Use folder routes under an existing library instead."]})}),(0,s.jsx)(q,{variant:"warning",title:"403 FORBIDDEN — API key missing scope",children:(0,s.jsxs)("p",{children:["If ",(0,s.jsx)(M,{children:"GET …/libraries"})," returns ",(0,s.jsx)(M,{children:"This API key is missing a required scope."}),", add"," ",(0,s.jsx)(M,{children:"libraries:read"})," on your key. Folder create/delete/rename needs ",(0,s.jsx)(M,{children:"libraries:write"}),". Edit keys under"," ",(0,s.jsx)(t.default,{className:"font-medium text-primary underline-offset-4 hover:underline",href:"/developer/api-keys",children:"Developer → API keys"}),"."]})}),(0,s.jsxs)("div",{className:"space-y-2 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3",children:[(0,s.jsx)("p",{className:"text-[12px] font-semibold text-zinc-700",children:"Quick reference — library & folder routes"}),(0,s.jsx)(X,{method:"GET",path:"/libraries",desc:"List the five libraries (+ counts). Scope: libraries:read"}),(0,s.jsx)(X,{method:"GET",path:"/libraries/:libraryId",desc:"One library by id. Scope: libraries:read"}),(0,s.jsx)(X,{method:"POST",path:"/libraries",desc:"Disabled — returns 403 LIBRARY_CREATION_DISABLED"}),(0,s.jsx)(X,{method:"PATCH",path:"/libraries/:libraryId",desc:"Update metadata (advanced). Scope: libraries:write"}),(0,s.jsx)(X,{method:"DELETE",path:"/libraries/:libraryId",desc:"Only non-default / legacy custom libraries; defaults return 409. Scope: libraries:write"}),(0,s.jsx)(X,{method:"GET",path:"/libraries/:libraryId/folders",desc:"List folders in that library. Scope: libraries:read"}),(0,s.jsx)(X,{method:"POST",path:"/libraries/:libraryId/folders",desc:"Create folder (optional parentFolderId). Scope: libraries:write"}),(0,s.jsx)(X,{method:"PATCH",path:"/folders/:folderId",desc:"Rename folder. Scope: libraries:write"}),(0,s.jsx)(X,{method:"DELETE",path:"/folders/:folderId",desc:"Soft-delete folder (and descendants). Scope: libraries:write"})]}),(0,s.jsx)(q,{variant:"warning",title:"Postman: wrong URL",children:(0,s.jsxs)("p",{children:[(0,s.jsx)(M,{children:"http://localhost:3000/api-keys/libraries"})," is not a JSON library route. Use ",(0,s.jsxs)(M,{children:["GET ",O,"/libraries"]})," with Bearer + ",(0,s.jsx)(M,{children:"libraries:read"}),"."]})}),(0,s.jsxs)(F,{className:"text-zinc-600",children:[(0,s.jsx)("strong",{className:"text-zinc-900",children:"REST base"})," for all examples: ",(0,s.jsx)(M,{children:O})," (every path is ",(0,s.jsxs)(M,{children:[O,"/…"]}),")."]}),(0,s.jsx)(V,{label:"Copy full URLs — common library & folder calls",requests:[{method:"GET",fullPath:"/libraries",hint:"libraries:read"},{method:"GET",fullPath:"/libraries/{libraryId}/folders",hint:"libraries:read"},{method:"POST",fullPath:"/libraries/{libraryId}/folders",hint:"libraries:write — JSON body"},{method:"PATCH",fullPath:"/folders/{folderId}",hint:"libraries:write"},{method:"DELETE",fullPath:"/folders/{folderId}",hint:"libraries:write"}]}),(0,s.jsx)(J,{children:"Find a library id from its slug"}),(0,s.jsxs)(F,{children:["Folder routes need ",(0,s.jsx)(M,{children:"libraryId"})," (a CUID/UUID from your instance). List libraries once, then pick by ",(0,s.jsx)(M,{children:"slug"})," (e.g. ",(0,s.jsx)(M,{children:"videos"}),")."]}),(0,s.jsx)(X,{method:"GET",path:"/libraries",desc:"Returns data[] with id, name, slug, assetCount, …"}),(0,s.jsx)(H,{title:"GET /libraries — resolve Videos",postman:`GET ${O}/libraries
Authorization: Bearer {{key}} (scope libraries:read)`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const res = await fetch(\`\${BASE}/libraries\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const videos = json.data.find((l) => l.slug === "videos");
console.log(videos.id); // use as libraryId below`,python:`import os, requests
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
r = requests.get(f"{API}/libraries", headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})
r.raise_for_status()
videos = next(l for l in r.json()["data"] if l["slug"] == "videos")
print(videos["id"])`,curl:`export ARCIIN_KEY="arc_live_your_key_here" API="${O}"
curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" \\
  "$API/libraries" | jq '.data[] | select(.slug=="videos") | .id'`}),(0,s.jsx)(J,{children:"List folders inside a specific library"}),(0,s.jsxs)(F,{children:["After you have ",(0,s.jsx)(M,{children:"libraryId"}),", list its folder tree. Response order follows ",(0,s.jsx)(M,{children:"pathCache"}),"."]}),(0,s.jsx)(X,{method:"GET",path:"/libraries/:libraryId/folders",desc:"Scope: libraries:read"}),(0,s.jsx)(H,{title:"GET /libraries/{libraryId}/folders",postman:`GET ${O}/libraries/{{library_id}}/folders`,node:`// LIB_ID = id from GET /libraries (e.g. videos library)
const LIB_ID = "paste-library-id";
const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const res = await fetch(\`\${BASE}/libraries/\${LIB_ID}/folders\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
console.log(JSON.stringify(await res.json(), null, 2));`,python:`import os, requests
API = "${O}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
LIB_ID = "paste-library-id"
r = requests.get(
    f"{API}/libraries/{LIB_ID}/folders",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
)
print(r.json())`,curl:`curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" \\
  "$API/libraries/$LIB_ID/folders" | jq .`}),(0,s.jsx)(J,{children:"Create a folder inside a library (or inside another folder)"}),(0,s.jsxs)(F,{children:[(0,s.jsxs)(M,{children:["POST ",O,"/libraries/<libraryId>/folders"]})," with JSON ",(0,s.jsx)(M,{children:'{ "name": "2024" }'})," creates a root-level folder. Optional"," ",(0,s.jsx)(M,{children:"parentFolderId"}),": another folder's id in the same library to nest under; omit it or send ",(0,s.jsx)(M,{children:"null"})," for the library root."]}),(0,s.jsx)(X,{method:"POST",path:"/libraries/:libraryId/folders",desc:"Body: { name, parentFolderId? }. Scope: libraries:write"}),(0,s.jsx)(H,{title:"POST /libraries/{libraryId}/folders",postman:`POST ${O}/libraries/{{library_id}}/folders
Body: { "name": "2024" } or { "name": "raw", "parentFolderId": "{{parent_folder_id}}" }`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const auth = { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json", "Content-Type": "application/json" } as const;

const libs = (await (await fetch(\`\${BASE}/libraries\`, { headers: auth })).json()).data;
const lib = libs.find((l) => l.slug === "videos");
const res = await fetch(\`\${BASE}/libraries/\${lib.id}/folders\`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ name: "2024" }), // or { name: "raw", parentFolderId: "…" }
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const folder = json.data;
console.log(folder.id, folder.pathCache);`,python:`import os, requests
API = "${O}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
h = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json", "Content-Type": "application/json"}
lib = next(l for l in requests.get(f"{API}/libraries", headers=h).json()["data"] if l["slug"] == "videos")
r = requests.post(f"{API}/libraries/{lib['id']}/folders", headers=h, json={"name": "2024"})
r.raise_for_status()
print(r.json()["data"]["pathCache"])`,curl:`VID=$(curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" "$API/libraries" | jq -r '.data[]|select(.slug=="videos")|.id')
curl -sS -X POST "$API/libraries/$VID/folders" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"2024"}' | jq .data`}),(0,s.jsx)(J,{children:"Rename a folder"}),(0,s.jsxs)(F,{children:["Use the folder's ",(0,s.jsx)(M,{children:"id"})," from list or create response — not the library id."]}),(0,s.jsx)(X,{method:"PATCH",path:"/folders/:folderId",desc:'Body JSON: {"name":"New name"}. Scope: libraries:write'}),(0,s.jsx)(H,{title:"PATCH /folders/{folderId}",postman:`PATCH ${O}/folders/{{folder_id}}
Body: { "name": "Renamed" }`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const FOLDER_ID = "paste-folder-id";
const res = await fetch(\`\${BASE}/folders/\${FOLDER_ID}\`, {
  method: "PATCH",
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ name: "Renamed" }),
});
console.log(await res.json());`,python:`import os, requests
API = "${O}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
FID = "paste-folder-id"
requests.patch(
    f"{API}/folders/{FID}",
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    json={"name": "Renamed"},
).raise_for_status()`,curl:`curl -sS -X PATCH "$API/folders/$FOLDER_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Renamed"}' | jq .`}),(0,s.jsx)(J,{children:"Delete a folder you created"}),(0,s.jsxs)(F,{children:[(0,s.jsx)(M,{children:"DELETE"})," soft-deletes the folder and any child folders under the same path prefix. Ensure assets are moved or deleted first if your policy requires empty folders only."]}),(0,s.jsx)(X,{method:"DELETE",path:"/folders/:folderId",desc:"Scope: libraries:write"}),(0,s.jsx)(H,{title:"DELETE /folders/{folderId}",postman:`DELETE ${O}/folders/{{folder_id}}`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const FOLDER_ID = "paste-folder-id";
const res = await fetch(\`\${BASE}/folders/\${FOLDER_ID}\`, {
  method: "DELETE",
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
console.log(await res.json());`,python:`import os, requests
API = "${O}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
FID = "paste-folder-id"
requests.delete(
    f"{API}/folders/{FID}",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
).raise_for_status()`,curl:`curl -sS -X DELETE "$API/folders/$FOLDER_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json"`}),(0,s.jsx)(J,{children:"Upload files into a library"}),(0,s.jsxs)(F,{children:["Uploads do not use ",(0,s.jsx)(M,{children:"libraryId"})," in the first step — they use ",(0,s.jsx)(M,{children:"librarySlug"})," (e.g. ",(0,s.jsx)(M,{children:"videos"}),", ",(0,s.jsx)(M,{children:"inbox"}),"). Optional ",(0,s.jsx)(M,{children:"folderId"})," targets a folder inside that library. See the full three-step flow (initiate → PUT bytes → complete) under"," ",(0,s.jsx)("a",{href:"#uploads",className:"font-medium text-primary underline-offset-4 hover:underline",onClick:e=>{e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||0!==e.button||(e.preventDefault(),p("uploads"))},children:"File uploads"}),"."]}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["Typical ",(0,s.jsxs)(M,{children:["POST ",O,"/uploads"]})," body fields: ",(0,s.jsx)(M,{children:"filename"}),", ",(0,s.jsx)(M,{children:"size"}),", ",(0,s.jsx)(M,{children:"librarySlug"})," (",(0,s.jsx)(M,{children:"videos"})," | ",(0,s.jsx)(M,{children:"images"})," | ",(0,s.jsx)(M,{children:"music"})," | ",(0,s.jsx)(M,{children:"documents"})," | ",(0,s.jsx)(M,{children:"inbox"}),"), optional ",(0,s.jsx)(M,{children:"folderId"}),"."]})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"assets",children:"Assets"}),(0,s.jsx)(F,{children:"An asset is any stored file. Assets belong to a library and optionally to a folder. Use query parameters to filter and paginate."}),(0,s.jsxs)("div",{className:"space-y-2",children:[(0,s.jsx)(X,{method:"GET",path:"/assets",desc:"List — ?libraryId= ?folderId= ?page= ?limit="}),(0,s.jsx)(X,{method:"GET",path:"/assets/:id",desc:"Get a single asset with full metadata"}),(0,s.jsx)(X,{method:"PATCH",path:"/assets/:id",desc:"Update title, description, tags"}),(0,s.jsx)(X,{method:"POST",path:"/assets/:id/move",desc:"Move to a different library or folder"}),(0,s.jsx)(X,{method:"GET",path:"/assets/:id/thumbnail",desc:"Redirect to thumbnail image"}),(0,s.jsx)(X,{method:"GET",path:"/assets/:id/download",desc:"Redirect to raw file"}),(0,s.jsx)(X,{method:"DELETE",path:"/assets/:id",desc:"Soft-delete an asset"})]}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["All asset routes are ",(0,s.jsxs)(M,{children:[O,"/assets"]})," and ",(0,s.jsxs)(M,{children:[O,"/assets/<id>/…"]}),". Filtering uses query strings on the list URL."]}),(0,s.jsx)(V,{label:"Copy full URLs — common asset calls",requests:[{method:"GET",fullPath:"/assets?libraryId={libraryId}&page=1&limit=20",hint:"List — substitute libraryId"},{method:"GET",fullPath:"/assets/{assetId}/download",hint:"Download file (redirect)"},{method:"PATCH",fullPath:"/assets/{assetId}",hint:"Update title / description"},{method:"POST",fullPath:"/assets/{assetId}/move",hint:"Move to another library or folder"}]}),(0,s.jsx)(H,{title:"List assets (paginated)",postman:`GET {{base}}/assets?libraryId={{library_id}}&page=1&limit=20
Authorization: Bearer {{key}} (needs assets:read)`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const videoLibId = "REPLACE_WITH_LIBRARY_UUID";
const auth = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
} as const;

const q = new URLSearchParams({
  libraryId: videoLibId,
  page: "1",
  limit: "20",
});
// GET full URL: \`\${BASE}/assets?\${q}\`
const res = await fetch(\`\${BASE}/assets?\${q}\`, { headers: auth });
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body));
const { data, meta } = body;
data.forEach((a) => console.log(a.title, a.mimeType, a.size));
console.log(\`Page \${meta.page} of \${meta.pageCount}\`);`,python:`import os, requests
from urllib.parse import urlencode

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
video_lib_id = "REPLACE_WITH_LIBRARY_UUID"

params = urlencode({"libraryId": video_lib_id, "page": 1, "limit": 20})
# GET request URL = f"{API}/assets?{params}"
r = requests.get(
    f"{API}/assets?{params}",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
    timeout=60,
)
r.raise_for_status()
result = r.json()
for a in result["data"]:
    print(a["title"], a["mimeType"], a["size"])
meta = result["meta"]
print(f"Page {meta['page']} of {meta['pageCount']}")`,curl:`export ARCIIN_KEY="arc_live_your_key_here"
export API="${O}"
VID_ID="REPLACE_WITH_LIBRARY_UUID"

# GET full URL: $API/assets?libraryId=…&page=1&limit=20
curl -sS \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  "$API/assets?libraryId=$VID_ID&page=1&limit=20" \\
  | jq '.data[] | {title,mimeType,size}'`}),(0,s.jsx)(H,{title:"Download a file",postman:`GET {{base}}/assets/{{asset_id}}/download
Authorization: Bearer {{key}}
(Send and follow redirects — save response to file.)`,node:`import fs from "node:fs";

const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const assetId = "REPLACE_WITH_ASSET_ID";

// GET full URL: \`\${BASE}/assets/\${assetId}/download\`
const res = await fetch(\`\${BASE}/assets/\${assetId}/download\`, {
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "*/*",
  },
  redirect: "follow",
});
if (!res.ok) throw new Error(await res.text());
const buffer = Buffer.from(await res.arrayBuffer());
fs.writeFileSync("file.mp4", buffer);`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
asset_id = "REPLACE_WITH_ASSET_ID"

# GET URL: f"{API}/assets/{asset_id}/download"
with requests.get(
    f"{API}/assets/{asset_id}/download",
    headers={"Authorization": f"Bearer {API_KEY}"},
    stream=True,
    timeout=300,
) as r:
    r.raise_for_status()
    with open("file.mp4", "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)`,curl:`export ARCIIN_KEY="arc_live_your_key_here"
export API="${O}"
ASSET_ID="REPLACE_WITH_ASSET_ID"

# GET full URL: $API/assets/$ASSET_ID/download
curl -sS -L \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  "$API/assets/$ASSET_ID/download" -o file.mp4`}),(0,s.jsx)(H,{title:"Update metadata + move",postman:`PATCH {{base}}/assets/{{asset_id}}
Body: { "title": "…", "description": "…" }

POST {{base}}/assets/{{asset_id}}/move
Body: { "targetLibraryId": "…", "targetFolderId": null }`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const auth = (ct?: boolean) => ({
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
  ...(ct ? { "Content-Type": "application/json" } : {}),
});

const assetId = "…";
const imagesLibId = "…";

// PATCH — full URL: \`\${BASE}/assets/\${assetId}\`
let res = await fetch(\`\${BASE}/assets/\${assetId}\`, {
  method: "PATCH",
  headers: auth(true),
  body: JSON.stringify({
    title: "Summer Road Trip 2024",
    description: "Coastal drive from Lisbon to Porto.",
  }),
});
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));

// POST — full URL: \`\${BASE}/assets/\${assetId}/move\`
res = await fetch(\`\${BASE}/assets/\${assetId}/move\`, {
  method: "POST",
  headers: auth(true),
  body: JSON.stringify({
    targetLibraryId: imagesLibId,
    targetFolderId: null,
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

asset_id = "…"
images_lib_id = "…"

# PATCH — URL f"{API}/assets/{asset_id}"
s.patch(
    f"{API}/assets/{asset_id}",
    json={"title": "Summer Road Trip 2024"},
    timeout=60,
).raise_for_status()

# POST — URL f"{API}/assets/{asset_id}/move"
s.post(
    f"{API}/assets/{asset_id}/move",
    json={"targetLibraryId": images_lib_id, "targetFolderId": None},
    timeout=60,
).raise_for_status()`,curl:`export ARCIIN_KEY="arc_live_your_key_here"
export API="${O}"
ASSET_ID="…"
IMG_LIB_ID="…"

# PATCH full URL: $API/assets/$ASSET_ID
curl -sS -X PATCH "$API/assets/$ASSET_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"title":"Summer Road Trip 2024"}' | jq .data.title

# POST full URL: $API/assets/$ASSET_ID/move
curl -sS -X POST "$API/assets/$ASSET_ID/move" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"targetLibraryId":"'"$IMG_LIB_ID"'","targetFolderId":null}'`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"uploads",children:"File uploads"}),(0,s.jsxs)(F,{children:["Send the file in ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"one multipart POST"})," to"," ",(0,s.jsxs)(M,{children:[O,"/uploads"]}),". Arciin classifies by MIME, runs workers when needed, and emits Socket.IO events."]}),(0,s.jsxs)(q,{variant:"tip",title:"Scopes & ids",children:["API keys need ",(0,s.jsx)(M,{children:"uploads:create"}),". Resolve slug→id with ",(0,s.jsxs)(M,{children:["GET ",O,"/libraries"]})," (",(0,s.jsx)(M,{children:"libraries:read"}),"), then query ",(0,s.jsx)(M,{children:"targetLibraryId"})," (cuid). Omit it for auto-routing."]}),(0,s.jsxs)(q,{variant:"tip",title:"Example scripts",children:["Full list and auth notes: ",(0,s.jsx)(t.default,{href:"/docs#example-scripts",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Example scripts (this manual)"}),". On the server repo: ",(0,s.jsx)(M,{children:"scripts/examples/"})," (not a browser URL)."]}),(0,s.jsxs)("div",{className:"space-y-2",children:[(0,s.jsx)(X,{method:"POST",path:"/uploads",desc:"Multipart upload — query targetLibraryId, targetFolderId"}),(0,s.jsx)(X,{method:"GET",path:"/uploads",desc:"List recent upload sessions"}),(0,s.jsx)(X,{method:"GET",path:"/uploads/:id",desc:"Get session status"}),(0,s.jsx)(X,{method:"POST",path:"/uploads/:id/cancel",desc:"Abandon and remove temp file"})]}),(0,s.jsx)(V,{label:"Copy full URLs — upload",requests:[{method:"POST",fullPath:"/uploads?targetLibraryId={libraryCuid}",hint:"multipart field file"},{method:"GET",fullPath:"/libraries",hint:"Resolve slug → id"}]}),(0,s.jsx)(H,{title:"Upload one file (multipart)",postman:`POST ${O}/uploads?targetLibraryId={{library_cuid}}

Authorization: Bearer Token → arc_… (uploads:create)

Body: form-data → file = (select file)

Optional: targetFolderId={{folder_cuid}}

GET ${O}/libraries → match slug "images" → use id as targetLibraryId`,node:(0,o.buildNodeMultipartUploadSnippet)({apiBase:O,librarySlug:"images"}),python:(0,o.buildPythonMultipartUploadSnippet)({apiBase:O,librarySlug:"images"}),curl:(0,o.buildCurlMultipartUploadSnippet)({apiBase:O,librarySlug:"images"})})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"example-scripts",children:"Example scripts (Python)"}),(0,s.jsxs)(F,{children:["Runnable automation lives in the Arciin install under"," ",(0,s.jsx)(M,{children:"scripts/examples/"})," on the server — there is no"," ",(0,s.jsx)(M,{children:"/scripts/examples/README.md"})," page in the web UI. Use this section and"," ",(0,s.jsx)(t.default,{href:"/docs#uploads",className:"font-medium text-primary underline-offset-4 hover:underline",children:"File uploads"})," ","for copy-paste API examples."]}),(0,s.jsxs)(q,{variant:"tip",title:"Setup",children:[(0,s.jsx)(M,{children:"pip install requests"})," — Socket.IO examples also need"," ",(0,s.jsx)(M,{children:"python-socketio[client]"})," and ",(0,s.jsx)(M,{children:"websocket-client"}),". Edit shared config once in"," ",(0,s.jsx)(M,{children:"lib/arciin_client.py"})," (API base, API key or email/password)."]}),(0,s.jsx)("div",{className:"overflow-hidden rounded-xl border border-zinc-200",children:(0,s.jsxs)("table",{className:"w-full text-left text-sm",children:[(0,s.jsx)("thead",{className:"border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500",children:(0,s.jsxs)("tr",{children:[(0,s.jsx)("th",{className:"px-4 py-2.5",children:"Script"}),(0,s.jsx)("th",{className:"px-4 py-2.5",children:"Purpose"})]})}),(0,s.jsx)("tbody",{className:"divide-y divide-zinc-100",children:[["api/01_health_check.py","Ping API, database, Redis, worker"],["api/02_list_libraries.py","List libraries with ids (slug → targetLibraryId)"],["api/03_list_folders.py","List folders in a library"],["api/04_create_folder.py","Create a folder"],["api/06_upload_to_library.py","Multipart upload to a chosen library"],["api/07_upload_auto_classify.py","Upload without library — MIME auto-route"],["api/05_list_assets.py","List recent assets"],["api/08_list_app_databases.py","Logical App data databases"],["events/01_monitor_api_key.py","Socket.IO live events (API key)"]].map(([e,r])=>(0,s.jsxs)("tr",{children:[(0,s.jsx)("td",{className:"px-4 py-2 font-mono text-xs text-zinc-800",children:e}),(0,s.jsx)("td",{className:"px-4 py-2 text-zinc-600",children:r})]},e))})]})}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["Create keys under"," ",(0,s.jsx)(t.default,{href:"/developer/api-keys",className:"font-medium text-primary underline-offset-4 hover:underline",children:"Developer → API keys"}),". Typical scopes: ",(0,s.jsx)(M,{children:"uploads:create"}),", ",(0,s.jsx)(M,{children:"libraries:read"}),","," ",(0,s.jsx)(M,{children:"events:subscribe"})," (Socket.IO). WSL: run ",(0,s.jsx)(M,{children:"lib/wsl_hosts.sh"})," in the repo and point"," ",(0,s.jsx)(M,{children:"API_BASE"})," at ",(0,s.jsx)(M,{children:"http://<WSL-IP>:4000/api"}),"."]})]}),(0,s.jsx)(W,{}),(0,s.jsx)(T,{}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"databases",children:"App databases"}),(0,s.jsxs)(F,{children:["Lightweight JSON stores backed by PostgreSQL. Each database has ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"tables"})," (folders) containing ",(0,s.jsx)("strong",{className:"text-zinc-900",children:"records"})," (JSON documents). Every new database includes a ",(0,s.jsx)(M,{children:"Default"})," table automatically."]}),(0,s.jsxs)(q,{variant:"tip",title:"Required scopes",children:["Scripts need ",(0,s.jsx)(M,{children:"appdata:databases:read"}),", ",(0,s.jsx)(M,{children:"appdata:records:read"}),", and ",(0,s.jsx)(M,{children:"appdata:records:write"})," at minimum."]}),(0,s.jsx)("div",{className:"space-y-1.5",children:[["GET","/app-databases","List all databases"],["POST","/app-databases","Create database (auto-creates Default table)"],["DELETE","/app-databases/:id","Delete database + all tables + records"],["GET","/app-databases/:id/folders","List tables"],["POST","/app-databases/:id/folders","Create table"],["DELETE","/app-database-folders/:folderId","Delete table + records"],["GET","/app-database-folders/:folderId/records","List records"],["POST","/app-database-folders/:folderId/records","Create record"],["PATCH","/app-database-records/:recordId","Update record payload"],["DELETE","/app-database-records/:recordId","Delete record"]].map(([e,r,t])=>(0,s.jsx)(X,{method:e,path:r,desc:t},`${e}-${r}`))}),(0,s.jsxs)(F,{className:"text-zinc-600",children:["Base path for this feature is ",(0,s.jsxs)(M,{children:[O,"/app-databases"]})," — same ",(0,s.jsx)(M,{children:O})," as everywhere else in this manual."]}),(0,s.jsx)(V,{label:"Copy full URLs — app databases",requests:[{method:"POST",fullPath:"/app-databases",hint:"Create DB"},{method:"GET",fullPath:"/app-databases/{dbId}/folders",hint:"List tables"},{method:"POST",fullPath:"/app-database-folders/{tableId}/records",hint:"Create record"}]}),(0,s.jsx)(H,{title:"Create a database and write records",postman:`POST ${O}/app-databases
POST ${O}/app-databases/{{db_id}}/folders
POST ${O}/app-database-folders/{{table_id}}/records`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const auth = (body?: object) => ({
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "application/json",
    ...(body
      ? { "Content-Type": "application/json" }
      : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
} as RequestInit);

// 1 \xb7 POST — full URL: \`\${BASE}/app-databases\`
let res = await fetch(\`\${BASE}/app-databases\`, {
  method: "POST",
  ...auth({
    name: "ecommerce",
    description: "Orders and products for my storefront",
  }),
});
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const db = json.data;

// 2 \xb7 GET — full URL: \`\${BASE}/app-databases/\${db.id}/folders\`
res = await fetch(\`\${BASE}/app-databases/\${db.id}/folders\`, {
  method: "GET",
  ...auth(),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const tables = json.data as { id: string; name: string }[];
console.log("Tables:", tables.map((t) => t.name));

// 3 \xb7 POST — full URL: \`\${BASE}/app-databases/\${db.id}/folders\`
res = await fetch(\`\${BASE}/app-databases/\${db.id}/folders\`, {
  method: "POST",
  ...auth({ name: "orders" }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const ordersTable = json.data;

// 4 \xb7 POST — full URL: \`\${BASE}/app-database-folders/\${ordersTable.id}/records\`
res = await fetch(\`\${BASE}/app-database-folders/\${ordersTable.id}/records\`, {
  method: "POST",
  ...auth({
    name: "order-1042",
    payload: { customerId: "usr_abc", total: 99.98, status: "pending" },
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const record = json.data;
console.log("Created:", record.id);`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

# 1 \xb7 POST — URL f"{API}/app-databases"
r = s.post(
    f"{API}/app-databases",
    json={
        "name": "ecommerce",
        "description": "Orders and products",
    },
    timeout=60,
)
r.raise_for_status()
db = r.json()["data"]

# 2 \xb7 GET — URL f"{API}/app-databases/{id}/folders"
tables = s.get(f"{API}/app-databases/{db['id']}/folders", timeout=60).json()["data"]

# 3 \xb7 POST table — URL f"{API}/app-databases/{id}/folders"
orders_table = s.post(
    f"{API}/app-databases/{db['id']}/folders",
    json={"name": "orders"},
    timeout=60,
).json()["data"]

# 4 \xb7 POST record — URL f"{API}/app-database-folders/{id}/records"
record = s.post(
    f"{API}/app-database-folders/{orders_table['id']}/records",
    json={
        "name": "order-1042",
        "payload": {"customerId": "usr_abc", "total": 99.98, "status": "pending"},
    },
    timeout=60,
).json()["data"]
print("Created:", record["id"])`,curl:`export ARCIIN_KEY="arc_live_your_key_here"
export API="${O}"

# 1 \xb7 POST full URL: $API/app-databases
DB_ID=$(curl -sS -X POST "$API/app-databases" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"ecommerce","description":"Orders and products"}' \\
  | jq -r '.data.id')

# 2 \xb7 POST full URL: $API/app-databases/$DB_ID/folders
TBL_ID=$(curl -sS -X POST "$API/app-databases/$DB_ID/folders" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"orders"}' | jq -r '.data.id')

# 3 \xb7 POST full URL: $API/app-database-folders/$TBL_ID/records
curl -sS -X POST "$API/app-database-folders/$TBL_ID/records" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"order-1042","payload":{"customerId":"usr_abc","total":99.98,"status":"pending"}}' \\
  | jq .data.id`}),(0,s.jsx)(H,{title:"Read, update, delete records",postman:`GET {{base}}/app-database-folders/{{table_id}}/records
PATCH {{base}}/app-database-records/{{record_id}}
DELETE {{base}}/app-database-records/{{record_id}}`,node:`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${O}";
const h = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
};
const tableId = "…";
const recordId = "…";

// GET — full URL: \`\${BASE}/app-database-folders/\${tableId}/records\`
let res = await fetch(
  \`\${BASE}/app-database-folders/\${tableId}/records\`,
  { headers: h },
);
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const { data: records } = json;

// PATCH — full URL: \`\${BASE}/app-database-records/\${recordId}\`
res = await fetch(\`\${BASE}/app-database-records/\${recordId}\`, {
  method: "PATCH",
  headers: { ...h, "Content-Type": "application/json" },
  body: JSON.stringify({
    payload: { status: "shipped" },
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));

// DELETE — full URL: \`\${BASE}/app-database-records/\${recordId}\`
res = await fetch(\`\${BASE}/app-database-records/\${recordId}\`, {
  method: "DELETE",
  headers: h,
});
if (!res.ok) {
  json = await res.json();
  throw new Error(JSON.stringify(json));
}`,python:`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${O}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

table_id = "…"
record_id = "…"

# GET — f"{API}/app-database-folders/{table_id}/records"
records = s.get(f"{API}/app-database-folders/{table_id}/records", timeout=60).json()["data"]

# PATCH — f"{API}/app-database-records/{record_id}"
s.patch(
    f"{API}/app-database-records/{record_id}",
    json={"payload": {"status": "shipped"}},
    timeout=60,
).raise_for_status()

# DELETE — f"{API}/app-database-records/{record_id}"
s.delete(f"{API}/app-database-records/{record_id}", timeout=60).raise_for_status()`,curl:`export ARCIIN_KEY="arc_live_your_key_here"
export API="${O}"
TBL_ID="…"
REC_ID="…"

# GET full URL: $API/app-database-folders/$TBL_ID/records
curl -sS "$API/app-database-folders/$TBL_ID/records" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" | jq '.data[] | {name,payload}'

# PATCH full URL: $API/app-database-records/$REC_ID
curl -sS -X PATCH "$API/app-database-records/$REC_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"payload":{"status":"shipped"}}'

# DELETE full URL: $API/app-database-records/$REC_ID
curl -sS -X DELETE "$API/app-database-records/$REC_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY"`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"responses",children:"JSON response shapes"}),(0,s.jsxs)(F,{children:["Every route returns the same envelope — check HTTP status first, then ",(0,s.jsx)(M,{children:"error.code"}),"."]}),(0,s.jsxs)("div",{className:"grid gap-4 sm:grid-cols-2",children:[(0,s.jsxs)("div",{children:[(0,s.jsx)("p",{className:"mb-2 text-[13px] font-semibold text-zinc-700",children:"Success (2xx)"}),(0,s.jsx)(K,{title:"Success",children:`{
  "data": {
    "id": "clx1abc",
    "name": "Videos",
    "assetCount": 142
  }
}`})]}),(0,s.jsxs)("div",{children:[(0,s.jsx)("p",{className:"mb-2 text-[13px] font-semibold text-zinc-700",children:"Error (4xx / 5xx)"}),(0,s.jsx)(K,{title:"Error",children:`{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required.",
    "details": {}
  }
}`})]})]}),(0,s.jsx)(K,{title:"Paginated list",children:`{
  "data": [ /* array of items */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "pageCount": 8
  }
}`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"realtime",children:"Realtime — Socket.IO"}),(0,s.jsx)(F,{children:"The dashboard uses Socket.IO for live updates. Your scripts can subscribe to the same events."}),(0,s.jsx)(H,{title:"Install",node:"npm install socket.io-client",python:"pip install python-socketio[asyncio] aiohttp",curl:"# curl does not support Socket.IO — use Node.js or Python for realtime."}),(0,s.jsx)(H,{title:"Connect + listen to events",node:`import { io } from "socket.io-client";

const socket = io("${R}", {
  withCredentials: true,                         // browser: send session cookie
  // extraHeaders: { Authorization: "Bearer …" } // Node.js: API key
});

socket.on("connect",             ()  => console.log("connected:", socket.id));
socket.on("connect_error",       err => console.error("auth error:", err.message));

socket.on("upload.progress",  ({ uploadId, progress }) =>
  console.log(\`Upload \${uploadId}: \${progress}%\`));

socket.on("upload.completed", ({ uploadId, assetId }) =>
  console.log(\`Done — asset: \${assetId}\`));

socket.on("asset.created",    ({ assetId, libraryId, title }) =>
  console.log(\`New asset in \${libraryId}: \${title}\`));

// Catch all events at once (v4+)
socket.onAny((event, payload) => console.log(\`[\${event}]\`, payload));`,python:(0,o.buildPythonSocketSnippet)({apiBase:O,socketUrl:R}),curl:`# curl does not support Socket.IO — use Node.js or Python.

# Full script: scripts/examples/events/01_monitor_api_key.py
# Shared config: scripts/examples/lib/arciin_client.py`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"webhooks",children:"Webhooks"}),(0,s.jsxs)(F,{children:["Webhooks POST events to your server over HTTPS. Configure endpoints under ",(0,s.jsx)(t.default,{className:"font-medium text-primary underline-offset-4 hover:underline",href:"/developer/webhooks",children:"Webhooks"}),". Always verify the signature before trusting the payload."]}),(0,s.jsx)(K,{title:"Payload shape",children:`// POST https://your-server.com/hooks/arciin
// Content-Type: application/json
// x-arciin-signature: sha256=<hex>
{
  "id":        "evt_abc123",
  "type":      "upload.completed",
  "uploadId":  "upl_xyz",
  "assetId":   "ast_def",
  "libraryId": "lib_ghi",
  "userId":    "usr_jkl",
  "progress":  100,
  "message":   "Upload complete.",
  "createdAt": "2024-06-01T12:34:56.000Z"
}`}),(0,s.jsx)(H,{title:"Verify signature + handle events",node:`import express from "express";
import crypto from "node:crypto";

const app = express();

app.post("/hooks/arciin",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig    = req.headers["x-arciin-signature"];
    const secret = process.env.ARCIIN_WEBHOOK_SECRET;

    const expected = "sha256=" + crypto
      .createHmac("sha256", secret).update(req.body).digest("hex");
    const valid = (() => {
      try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) }
      catch { return false }
    })();

    if (!valid) return res.status(401).json({ error: "Bad signature" });

    const event = JSON.parse(req.body.toString());
    switch (event.type) {
      case "upload.completed": processAsset(event.assetId); break;
      case "asset.deleted":    removeRef(event.assetId);    break;
    }
    res.json({ ok: true });
  }
);`,python:`import hashlib, hmac, os
from fastapi import FastAPI, Request, HTTPException

app  = FastAPI()
SECRET = os.environ["ARCIIN_WEBHOOK_SECRET"]

@app.post("/hooks/arciin")
async def webhook(request: Request):
    body = await request.body()
    sig  = request.headers.get("x-arciin-signature", "")
    expected = "sha256=" + hmac.new(
        SECRET.encode(), body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "Invalid signature")

    event = await request.json()
    print(f"Event: {event['type']}, asset: {event.get('assetId')}")
    return {"ok": True}`,curl:`# Webhooks are received by your server, not sent via curl.
# Test with a manual POST to simulate a delivery:
curl -X POST https://your-server.com/hooks/arciin \\
  -H "Content-Type: application/json" \\
  -H "x-arciin-signature: sha256=test" \\
  -d '{"type":"upload.completed","assetId":"ast_test"}'`})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"remote",children:"Remote access"}),(0,s.jsxs)(F,{children:["By default Arciin binds to ",(0,s.jsx)(M,{children:"localhost"}),". Set ",(0,s.jsx)(M,{children:"NEXT_PUBLIC_ARCIIN_PUBLIC_URL"})," to a stable HTTPS origin so cookies, CORS, and WebSocket upgrades resolve correctly."]}),(0,s.jsx)(K,{title:"Cloudflare quick tunnel",lang:"sh",children:`# Install cloudflared (Debian / Ubuntu)
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | \\
  sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
sudo apt-get update && sudo apt-get install -y cloudflared

# Start tunnel — prints an HTTPS URL, paste it into Settings → Domain
cloudflared tunnel --url http://localhost:3000`}),(0,s.jsx)(K,{title:"nginx reverse proxy",lang:"nginx",children:`server {
    listen 443 ssl;
    server_name cloud.example.com;

    ssl_certificate     /etc/letsencrypt/live/cloud.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloud.example.com/privkey.pem;

    # Web app (Next.js :3000)
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Fastify API + Socket.IO (:4000)
    location /api/ {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}`}),(0,s.jsxs)(q,{variant:"warning",title:"Cookies are host-scoped",children:["Changing hostname or scheme invalidates existing sessions. Update ",(0,s.jsx)(M,{children:"NEXT_PUBLIC_ARCIIN_PUBLIC_URL"})," before restarting."]})]}),(0,s.jsx)(W,{}),(0,s.jsxs)("section",{className:"space-y-5",children:[(0,s.jsx)(G,{id:"events",children:"Event catalogue"}),(0,s.jsxs)(F,{children:["These event names are emitted on Socket.IO and selectable for webhook subscriptions. All payloads follow the ",(0,s.jsx)(M,{children:"RealtimeEvent"})," shape."]}),(0,s.jsx)(K,{title:"RealtimeEvent type",children:`type RealtimeEvent = {
  id:         string;
  type:       string;        // e.g. "upload.completed"
  userId?:    string;
  libraryId?: string;
  uploadId?:  string;
  assetId?:   string;
  jobId?:     string;
  progress?:  number;        // 0–100
  message?:   string;
  data?:      Record<string, unknown>;
  createdAt:  string;        // ISO-8601
}`}),(0,s.jsx)("div",{className:"space-y-3",children:Object.entries(Z).map(([e,{events:r,desc:t}])=>(0,s.jsxs)("div",{className:"rounded-xl border border-primary/20 bg-primary/[0.04] p-4",children:[(0,s.jsxs)("div",{className:"mb-2.5 flex flex-wrap items-baseline justify-between gap-2",children:[(0,s.jsx)("p",{className:"text-[13px] font-semibold text-zinc-900",children:e}),(0,s.jsx)("p",{className:"text-[11px] text-zinc-500",children:t})]}),(0,s.jsx)("div",{className:"flex flex-wrap gap-2",children:r.map(e=>(0,s.jsx)("code",{className:"rounded-lg border border-primary/15 bg-white px-2.5 py-1 font-mono text-[12px] text-zinc-700",children:e},e))})]},e))})]}),(0,s.jsxs)("footer",{className:"rounded-2xl border border-zinc-200 bg-primary/[0.04] p-6 text-sm ring-1 ring-primary/10",children:[(0,s.jsx)("p",{className:"font-semibold text-zinc-900",children:"Need more?"}),(0,s.jsxs)("p",{className:"mt-2 leading-relaxed text-zinc-600",children:["This manual tracks the current API surface. New routes follow the same ",(0,s.jsx)(M,{children:"data"})," / ",(0,s.jsx)(M,{children:"error"})," envelope. Import ",(0,s.jsx)(M,{children:"@arciin/shared"})," types in TypeScript workers for ",(0,s.jsx)(M,{children:"SocketEventType"})," and ",(0,s.jsx)(M,{children:"API_KEY_SCOPES"}),"."]}),(0,s.jsxs)("div",{className:"mt-4 flex flex-wrap gap-2",children:[(0,s.jsx)(t.default,{href:"/developer/api-keys",className:"rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15",children:"API keys →"}),(0,s.jsx)(t.default,{href:"/developer/webhooks",className:"rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary",children:"Webhooks →"}),(0,s.jsx)(t.default,{href:"/events",className:"rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary",children:"Live events →"}),(0,s.jsx)(t.default,{href:"/database",className:"rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary",children:"Database browser →"})]})]})]})]})]})})}],230684)}]);