<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Claude Instructions for Arciin

This file gives Claude-specific working instructions for building Arciin.

Read this file together with:

```txt
AGENTS.md
README.md
package.json
components.json
```

`AGENTS.md` is the broader source of truth for all coding agents. This file adds Claude-specific workflow guidance.

---

## Product Summary

Arciin is a self-hosted private file, library, and media management platform.

Primary message:

```txt
Your server, your control.
```

Arciin should feel like a private command center for a user’s own server.

It is not a generic cloud drive, not a streaming clone, and not a marketing-first SaaS app.

The current priority is building the real application first.

Do not build the public landing page yet.

---

## Claude Working Principles

When working in this repository:

```txt
inspect before editing
preserve existing structure
avoid destructive changes
make small coherent changes
keep the app runnable
use TypeScript carefully
prefer reusable components
avoid fake final data
run checks after meaningful changes
document limitations honestly
```

Do not reinitialize the project.

Do not replace the project with a fresh template.

Do not remove existing shadcn/ui components.

Do not create logo or branding assets.

Do not create a marketing landing page yet.

---

## Required Project Inspection

Before making changes, inspect:

```txt
README.md
AGENTS.md
CLAUDE.md
package.json
components.json
next.config.ts
tsconfig.json
eslint.config.mjs
postcss.config.mjs
app/layout.tsx
app/page.tsx
app/globals.css
components/ui/sidebar.tsx
```

Also inspect nearby files before modifying a directory.

Do not assume the project uses the same conventions as older Next.js versions.

Read relevant docs from:

```txt
node_modules/next/dist/docs/
```

before using Next.js APIs that may have changed.

---

## Package Manager

Use:

```bash
pnpm
```

Do not use `npm`, `yarn`, or `bun` unless explicitly requested.

---

## shadcn/ui Requirement

shadcn/ui is already configured.

Use existing components from:

```txt
components/ui/
```

Do not recreate primitives such as buttons, cards, sheets, tables, sidebars, badges, alerts, or inputs.

The dashboard sidebar must use the structural pattern from:

```bash
npx shadcn@latest add sidebar-07
```

Use `sidebar-07` for:

```txt
SidebarProvider
SidebarInset
collapsible sidebar behavior
grouped navigation
top workspace/user section
mobile sidebar behavior
spacing
active item interaction
header/sidebar trigger pattern
```

Customize colors to match Arciin.

Do not use the default shadcn example palette.

---

## Design System

Use the Arciin dark interface.

Core colors:

```txt
Background: #09090B
Surface:    #18181B
Muted:      #27272A
Accent:     #FF4F12
Hover:      #FF6A33
Text:       #FFFFFF
Muted Text: #A1A1AA
Border:     #3F3F46
```

Semantic colors:

```txt
Success: #22C55E
Warning: #F59E0B
Danger:  #EF4444
Info:    #38BDF8
Purple:  #8B5CF6
```

Use orange sparingly.

The interface should feel:

```txt
dark
minimal
cinematic
technical
premium
self-hosted
quietly powerful
```

Avoid making the UI overly bright, playful, or marketing-heavy.

---

## Current Build Priority

Build in this order:

```txt
1. App shell
2. Sidebar dashboard layout
3. Setup flow
4. Login/auth flow
5. Dashboard
6. Libraries
7. Folders
8. Global drag-and-drop uploads
9. File classification
10. Activity feed
11. Realtime updates
12. Storage handling
13. Settings
14. API keys
15. Integrations placeholder
16. Docker deployment
```

The landing page comes later.

---

## Routing Rules

The root route `/` must redirect based on instance state.

Expected behavior:

```txt
if instance is not initialized:
  /setup

if instance is initialized but user is not authenticated:
  /login

if authenticated:
  /dashboard
```

Do not make `/` a marketing page.

Recommended route groups:

```txt
app/(setup)/setup/page.tsx
app/(auth)/login/page.tsx
app/(dashboard)/layout.tsx
app/(dashboard)/dashboard/page.tsx
app/(dashboard)/files/page.tsx
app/(dashboard)/videos/page.tsx
app/(dashboard)/images/page.tsx
app/(dashboard)/music/page.tsx
app/(dashboard)/documents/page.tsx
app/(dashboard)/uploads/page.tsx
app/(dashboard)/activity/page.tsx
app/(dashboard)/jobs/page.tsx
app/(dashboard)/api-keys/page.tsx
app/(dashboard)/integrations/page.tsx
app/(dashboard)/settings/page.tsx
```

---

## Setup Flow

First local setup screen:

```txt
Claim your Arciin instance.
```

Supporting text:

```txt
This server is private and has not been configured yet. Create the first administrator account to begin.
```

Fields:

```txt
setup token
instance name
admin name
admin email
admin password
confirm password
storage root path
default libraries
```

Rules:

```txt
setup requires ARCIIN_SETUP_TOKEN
first user becomes OWNER
setup locks permanently after first claim
no public signup
no required cloud account
```

---

## Auth Rules

Use local instance authentication.

MVP auth:

```txt
email/password
httpOnly session cookie
hashed password
session table
logout
current user endpoint
route protection
```

Roles:

```txt
OWNER
ADMIN
MEMBER
VIEWER
```

Security:

```txt
hash passwords with Argon2id or equivalent
store hashed session tokens
never store raw API keys
never store raw session tokens
never log secrets
```

---

## Frontend State Rules

Use:

```txt
TanStack Query for server state
Zustand for local UI state
```

Good Zustand use cases:

```txt
upload queue UI
drag overlay state
activity drawer state
socket connection state
command palette state
```

Do not mirror normal API data into Zustand.

---

## API Client Rules

Create typed API modules under:

```txt
lib/api/
```

Recommended files:

```txt
client.ts
errors.ts
query-keys.ts
instance.ts
auth.ts
libraries.ts
assets.ts
uploads.ts
activity.ts
settings.ts
```

Frontend components should not contain raw fetch logic.

Use the API layer plus TanStack Query.

---

## Backend Direction

The backend should be separate from Next.js.

Target stack:

```txt
Node.js
Fastify
TypeScript
PostgreSQL
Prisma
Redis
BullMQ
Socket.IO
```

Target structure:

```txt
apps/api/
apps/worker/
packages/database/
packages/shared/
```

Do not run heavy upload or media processing in Next.js components or frontend routes.

---

## Database Direction

Use PostgreSQL with Prisma.

Core models:

```txt
InstanceConfig
User
Session
ApiKey
StorageLocation
Library
Folder
Asset
StorageObject
UploadSession
Job
ActivityEvent
Integration
Tag
AssetTag
```

Do not store file binaries in PostgreSQL.

Store files on disk.

Store metadata in PostgreSQL.

---

## Storage Direction

Default local path:

```txt
./data/arciin
```

Default Docker path:

```txt
/data/arciin
```

Recommended structure:

```txt
/data/arciin
  /objects
  /libraries
  /thumbnails
  /temp
  /logs
```

Rules:

```txt
sanitize filenames
prevent path traversal
never trust client paths
do not expose absolute server paths
store original filename as metadata
use safe internal object keys
soft-delete before physical deletion
```

---

## Upload Feature

Global drag-and-drop is a signature feature.

User should be able to drag files anywhere inside the authenticated app.

Expected behavior:

```txt
drag files over app
show full-screen upload overlay
drop files
classify file types
route to correct library
show upload queue
show progress
store file
create metadata
create activity event
update UI in realtime
```

Default routing:

```txt
video/*         -> Videos
image/*         -> Images
audio/*         -> Music
pdf/documents   -> Documents
unknown         -> Inbox
```

Overlay copy:

```txt
Drop files anywhere.
Arciin will detect the type and place them in the right library.
```

Upload states:

```txt
queued
uploading
uploaded
analyzing
classified
processing
ready
failed
```

---

## Realtime Direction

Use Socket.IO.

Realtime updates should cover:

```txt
upload progress
upload completion
failed uploads
asset creation
asset movement
thumbnail creation
metadata extraction
job progress
activity events
```

Socket rooms:

```txt
user:{userId}
instance:{instanceId}
library:{libraryId}
upload:{uploadId}
job:{jobId}
```

Authenticate socket connections using the user session.

---

## Worker Direction

Use BullMQ.

Workers should handle:

```txt
file analysis
metadata extraction
thumbnail generation
video/audio probing
temp cleanup
storage usage calculation
future integration sync
```

Do not block API requests with heavy processing.

---

## Dashboard Expectations

Dashboard should show real instance state.

Include:

```txt
storage overview
library counts
recent uploads
live activity
upload queue
system health
quick access folders
integration status
```

Empty state:

```txt
Drop anything. Arciin will sort it out.
```

Do not fill the final dashboard with fake marketing stats.

Temporary placeholders are acceptable only while scaffolding and should be clearly replaced with real API data later.

---

## Sidebar Navigation

Use this hierarchy:

```txt
Primary
  Dashboard
  All Files
  Videos
  Images
  Music
  Documents

Operations
  Uploads
  Activity
  Jobs

Developer
  API Keys
  Events
  Webhooks

System
  Storage
  Integrations
  Settings
```

Active state should use:

```txt
subtle orange background
white text
orange accent marker
```

Support desktop, tablet, and mobile behavior.

---

## Settings Pages

Implement settings gradually.

Target pages:

```txt
/settings
/settings/storage
/settings/remote-access
/settings/security
```

Remote access should explain:

```txt
Arciin runs from your server first. Add a domain or tunnel only when you want remote access.
```

Do not require Cloudflare or any hosted service.

---

## Integrations

Create an integrations page.

Initial integration:

```txt
Plex placeholder
```

MVP Plex behavior:

```txt
show Plex card
show not connected status
explain Plex-compatible folder organization
suggest or allow Videos/Plex folder
leave full API connection for later
```

Do not let Plex work block the core app.

---

## API Keys

API Keys page should support:

```txt
list keys
create key
show raw key once
store hash only
display prefix
revoke key
show scopes
```

Initial scopes:

```txt
assets:read
assets:write
libraries:read
libraries:write
uploads:create
activity:read
events:subscribe
admin
```

---

## Security Requirements

Always enforce:

```txt
input validation
auth checks
role checks where needed
safe file handling
path traversal protection
secret redaction
httpOnly cookies
hashed credentials
destructive action confirmation
```

Never expose:

```txt
raw filesystem paths
raw API keys
raw session tokens
password hashes
setup token
```

---

## Quality Checklist

Before considering a feature complete:

```txt
types are correct
loading state exists
empty state exists
error state exists
responsive layout works
keyboard interaction works
auth/permissions are respected
visual system is consistent
no obvious console errors
no fake final data remains
```

Run where applicable:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

If checks fail due to unfinished scaffolding or missing services, explain what failed and why.

---

## Claude Response Style for Code Work

When making code changes:

```txt
summarize what changed
list important files modified
state how to run it
state any remaining TODOs
mention any failed checks honestly
```

Do not end with branding or landing page suggestions.

The next step after app implementation is app refinement.

---

## Do Not Accidentally Build These

Avoid building these until requested:

```txt
public marketing homepage
pricing page
team page
blog
newsletter capture
logo generator
theme marketplace
cloud account login
billing system
public user registration
```

---

## Final Goal

The MVP is successful when:

```txt
User opens /
User is redirected to /setup
User claims the local instance
User creates the owner account
User logs in
User sees dashboard
Sidebar uses sidebar-07 structure
Default libraries exist
User creates folders
User drags files anywhere
Upload overlay appears
Files classify into libraries
Files store on disk
Metadata stores in PostgreSQL
Activity updates
Upload queue updates
Settings pages exist
API keys page exists
Integrations page exists
Docker Compose exists
```

Arciin should feel like a real self-hosted product from the beginning.