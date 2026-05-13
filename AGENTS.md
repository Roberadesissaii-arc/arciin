<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Arciin Agent Instructions

This file defines the rules, architecture, conventions, and implementation expectations for AI coding agents working on Arciin.

Arciin is a self-hosted private file, library, and media management platform.

Primary product message:

```txt
Your server, your control.
```

Arciin is not a generic cloud drive, streaming clone, or marketing-first SaaS template. It is a private control center for organizing files, managing libraries, handling uploads, tracking activity, and connecting future self-hosted infrastructure integrations.

---

## Current Development Priority

Build the actual self-hosted application first.

Do not build the public landing page yet.

The correct roadmap is:

```txt
1. Core application shell
2. First-run setup flow
3. Local authentication
4. Dashboard experience
5. Sidebar navigation
6. Libraries and folders
7. Global drag-and-drop uploads
8. File classification
9. Activity feed
10. Storage handling
11. Realtime updates
12. Worker jobs
13. Settings and developer tools
14. Docker/self-hosted deployment
15. Landing page later
```

The landing page will be created after the real product exists so it can use real screenshots, real workflows, and actual UI interactions.

---

## Do Not Work On

Do not spend time on:

- logo creation
- branding exploration
- marketing asset generation
- public landing page
- pricing page
- fake SaaS marketing sections
- public signup flows
- cloud account requirements

Branding has already been completed.

Focus on the application.

---

## Project Identity

Product name:

```txt
Arciin
```

Preferred tone:

```txt
modern
premium
technical but approachable
self-hosted
private
minimal
cinematic
developer-focused
```

Avoid overused generic language such as:

```txt
Own your media cloud.
```

Use language closer to:

```txt
Your server, your control.
Built for the system you own.
Keep it where you control it.
A private command center for your server.
Your files. Your rules. Your machine.
The archive that runs on your terms.
```

---

## Existing Project Context

This project already exists as a Next.js application.

Do not reinitialize the project.

Do not delete existing configuration unless there is a clear technical reason.

Known existing structure:

```txt
app/
components/
components/ui/
hooks/
lib/
public/
components.json
next.config.ts
tsconfig.json
eslint.config.mjs
postcss.config.mjs
pnpm-workspace.yaml
package.json
pnpm-lock.yaml
README.md
AGENTS.md
CLAUDE.md
```

Known shadcn/ui components already present:

```txt
alert-dialog.tsx
alert.tsx
avatar.tsx
badge.tsx
breadcrumb.tsx
button-group.tsx
button.tsx
card.tsx
checkbox.tsx
context-menu.tsx
empty.tsx
field.tsx
hover-card.tsx
input-otp.tsx
input.tsx
item.tsx
kbd.tsx
label.tsx
pagination.tsx
progress.tsx
radio-group.tsx
select.tsx
separator.tsx
sheet.tsx
sidebar.tsx
skeleton.tsx
sonner.tsx
table.tsx
toggle.tsx
tooltip.tsx
```

Use the existing components instead of recreating primitives.

---

## Package Manager

Use:

```bash
pnpm
```

Do not use:

```bash
npm
yarn
bun
```

unless the user explicitly requests it.

---

## Required First Step Before Coding

Before modifying code, inspect the project.

Read:

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

Also inspect existing conventions in:

```txt
components/
hooks/
lib/
```

Do not assume standard Next.js behavior from memory. This project’s Next.js version may have breaking changes.

Read relevant documentation from:

```txt
node_modules/next/dist/docs/
```

before using APIs or conventions that may have changed.

---

## shadcn/ui and MCP

shadcn/ui is already configured.

Use the shadcn MCP server when useful to browse, search, inspect, or install components.

The dashboard sidebar must be based on:

```bash
npx shadcn@latest add sidebar-07
```

Use the `sidebar-07` implementation as the structural foundation for:

```txt
layout hierarchy
spacing
grouped navigation
collapsible behavior
mobile behavior
SidebarProvider structure
SidebarInset structure
top workspace/user area
active navigation behavior
sidebar trigger/header pattern
```

Do not copy the default color palette from the shadcn example.

Use Arciin’s dark black/orange visual system.

---

## Visual System

Arciin uses a dark, minimal, cinematic interface.

Color system:

| Role | Tailwind | Hex |
|---|---|---|
| Main Background | `bg-zinc-950` / `bg-black` | `#09090B` |
| Surface / Cards | `bg-zinc-900` | `#18181B` |
| Muted / Inputs | `bg-zinc-800` | `#27272A` |
| Primary Accent | `bg-[#FF4F12]` | `#FF4F12` |
| Accent Hover | custom | `#FF6A33` |
| Main Text | `text-white` | `#FFFFFF` |
| Muted Text | `text-zinc-400` | `#A1A1AA` |
| Borders | `border-zinc-700` | `#3F3F46` |

Semantic colors:

```txt
Success: #22C55E
Warning: #F59E0B
Danger:  #EF4444
Info:    #38BDF8
Purple:  #8B5CF6
```

Use orange sparingly.

The UI should feel mostly black, zinc, white, and subtle borders, with orange used as an ember-like accent.

---

## UI Style Rules

Use:

```txt
dark app shell
zinc surfaces
thin borders
rounded cards
subtle orange active states
minimal shadows
soft hover states
clean spacing
cinematic empty states
skeleton loading states
accessible focus states
```

Avoid:

```txt
bright neon UI
overuse of orange
generic SaaS gradients everywhere
playful cartoon styling
large fake marketing sections
unnecessary animations
```

Recommended interaction style:

```txt
fast
smooth
subtle
responsive
quietly premium
```

---

## Typography

Use the project’s existing font setup where possible.

Preferred:

```txt
Headings: Geist, Space Grotesk, or similar
Body/UI: Geist or Inter
Mono/API/logs: Geist Mono or JetBrains Mono
```

Do not introduce unnecessary font dependencies if the existing setup already uses Geist.

---

## Application Routes

Use Next.js App Router route groups.

Target routes:

```txt
/
  smart redirect

/setup
  first-run instance claim

/login
  local instance login

/dashboard
  main overview

/files
  all files

/videos
/images
/music
/documents
  default libraries

/uploads
  upload queue and upload history

/activity
  activity feed

/jobs
  worker/background job status

/api-keys
  developer API keys

/integrations
  integrations overview

/settings
/settings/storage
/settings/remote-access
/settings/security
  system settings
```

The root route must not be a marketing page.

Root behavior:

```txt
if instance is not initialized:
  redirect to /setup

if instance is initialized but user is not authenticated:
  redirect to /login

if user is authenticated:
  redirect to /dashboard
```

---

## First-Run Setup

Arciin is self-hosted.

The first page after installation should be the setup flow.

Setup headline:

```txt
Claim your Arciin instance.
```

Supporting copy:

```txt
This server is private and has not been configured yet. Create the first administrator account to begin.
```

Setup fields:

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

Default libraries:

```txt
Videos
Images
Music
Documents
Inbox
```

Rules:

```txt
The first user becomes OWNER.
Setup requires ARCIIN_SETUP_TOKEN.
Setup is locked forever after first successful claim.
Do not allow public signup.
Do not require an online Arciin account.
```

---

## Authentication

Use local authentication for the self-hosted instance.

MVP authentication:

```txt
email/password login
local users
httpOnly session cookies
secure password hashing
logout
current user endpoint
role-based access helpers
```

Roles:

```txt
OWNER
ADMIN
MEMBER
VIEWER
```

The first setup user is always:

```txt
OWNER
```

Use secure password hashing.

Prefer:

```txt
Argon2id
```

Sessions:

```txt
store hashed session token in database
set raw token only in httpOnly cookie
expire sessions
support logout/revocation
```

Do not store raw passwords, raw API keys, or raw session tokens.

---

## Frontend Architecture

Use:

```txt
Next.js App Router
React
TypeScript
Tailwind CSS
shadcn/ui
TanStack Query
Zustand
Framer Motion
Sonner
Lucide React
React Hook Form
Zod
```

Server state belongs in:

```txt
TanStack Query
```

Local UI state belongs in:

```txt
Zustand
```

Examples of local UI state:

```txt
upload overlay visibility
upload queue drawer state
current drag state
socket connection status
activity drawer state
command palette state
```

Do not store normal API query data in Zustand unless there is a strong reason.

---

## Suggested Frontend Structure

```txt
components/
  app-shell/
    app-sidebar.tsx
    dashboard-shell.tsx
    dashboard-header.tsx
    nav-main.tsx
    nav-user.tsx
    nav-system.tsx
    nav-developer.tsx

  dashboard/
    storage-overview-card.tsx
    recent-uploads-card.tsx
    activity-card.tsx
    library-summary-card.tsx
    system-health-card.tsx

  libraries/
    library-card.tsx
    library-grid.tsx
    folder-card.tsx
    folder-grid.tsx
    asset-card.tsx
    asset-grid.tsx
    asset-table.tsx
    create-folder-dialog.tsx
    move-asset-dialog.tsx

  uploads/
    global-dropzone-provider.tsx
    upload-overlay.tsx
    upload-queue.tsx
    upload-queue-item.tsx

  activity/
    activity-feed.tsx
    activity-item.tsx

  auth/
    setup-form.tsx
    login-form.tsx

  settings/
    api-keys-table.tsx
    create-api-key-dialog.tsx
    storage-settings-form.tsx
    remote-access-panel.tsx
    integration-card.tsx

  providers/
    app-providers.tsx
    query-provider.tsx
    socket-provider.tsx
```

---

## Frontend API Layer

Create a typed API layer.

Suggested structure:

```txt
lib/api/
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

API client rules:

```txt
use credentials: "include"
normalize errors
return typed responses
avoid fetch logic inside components
use TanStack Query hooks for server data
```

---

## Backend Architecture

Backend should be separate from the Next.js frontend.

Use:

```txt
Node.js
Fastify
TypeScript
PostgreSQL
Prisma
Redis
BullMQ
Socket.IO
local filesystem storage
```

Suggested backend location:

```txt
apps/api/
```

Suggested worker location:

```txt
apps/worker/
```

Suggested shared packages:

```txt
packages/database/
packages/shared/
```

Do not put heavy upload processing, media processing, or worker logic inside Next.js route handlers.

---

## Backend API Rules

Use consistent response shapes.

Success:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

Core route groups:

```txt
/api/health
/api/instance
/api/auth
/api/libraries
/api/folders
/api/assets
/api/uploads
/api/activity
/api/jobs
/api/api-keys
/api/integrations
/api/settings
```

Validate inputs with Zod or equivalent schema validation.

---

## Database

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

Do not store file binary data in PostgreSQL.

PostgreSQL stores:

```txt
users
sessions
roles
library metadata
folder metadata
asset metadata
upload sessions
activity events
job state
API keys
integration settings
storage locations
```

Filesystem stores:

```txt
original files
thumbnails
temporary uploads
generated previews
logs if needed
```

---

## Storage Rules

Default development storage:

```txt
./data/arciin
```

Default Docker storage:

```txt
/data/arciin
```

Recommended layout:

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
never trust user-provided filenames as paths
sanitize filenames
prevent path traversal
use safe internal object keys
store original filename as metadata
do not expose absolute filesystem paths to the frontend
soft-delete assets before physical deletion
clean temp files with background jobs
```

---

## Upload System

Global intelligent drag-and-drop is a signature Arciin feature.

Required behavior:

```txt
User can drag files anywhere over the authenticated app.
A full-app overlay appears.
Dropping files enqueues uploads.
Client performs quick classification.
Backend verifies classification.
Files route to the correct library.
Upload queue shows progress.
Activity feed updates.
Realtime events update the UI.
```

Default routing:

```txt
video/*          -> Videos
image/*          -> Images
audio/*          -> Music
application/pdf  -> Documents
unknown          -> Inbox
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

Do not make upload UI silently fail.

Always show clear progress, success, and error states.

---

## Realtime Events

Use Socket.IO for realtime updates.

Events should support:

```txt
upload.started
upload.progress
upload.completed
upload.failed

asset.created
asset.updated
asset.moved
asset.deleted
asset.classified

thumbnail.created
media.metadata.extracted
media.processing.completed
media.processing.failed

job.created
job.progress
job.completed
job.failed

activity.created
```

Suggested socket rooms:

```txt
user:{userId}
instance:{instanceId}
library:{libraryId}
upload:{uploadId}
job:{jobId}
```

Authenticate socket connections using the local session.

---

## Worker Jobs

Use BullMQ for background work.

Workers should handle:

```txt
file analysis
metadata extraction
thumbnail generation
video/audio probing
temporary file cleanup
storage usage calculation
future integration sync
```

Do not run heavy media processing inside API request handlers.

---

## Libraries and Files

Primary organization concept:

```txt
Libraries
```

Default libraries:

```txt
Videos
Images
Music
Documents
Inbox
```

Users can create folders inside libraries.

Assets belong to libraries and optionally folders.

Support:

```txt
grid view
table view
folder creation
asset move
asset delete
asset download
asset preview where practical
```

---

## Dashboard

Dashboard should feel like a private control room.

Include:

```txt
storage usage
library summary cards
recent uploads
live activity
upload queue summary
system health
quick access
integration status
```

Empty state copy:

```txt
Drop anything. Arciin will sort it out.
```

Supporting copy:

```txt
Upload files from anywhere in the app. Arciin detects the content type, organizes it into the right library, and keeps the activity visible in real time.
```

---

## Sidebar Navigation

Use the shadcn `sidebar-07` structure.

Navigation groups:

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

Active item style:

```txt
subtle orange background
white text
orange accent marker
```

The sidebar must work on desktop, tablet, and mobile.

---

## Settings

Settings pages should include:

```txt
General
Storage
Remote Access
Security
Users
```

Remote access page should explain:

```txt
Arciin runs from your server first. Add a domain or tunnel only when you want remote access.
```

Do not require Cloudflare.

Cloudflare Tunnel and reverse proxy support should be documented as optional.

---

## Integrations

Initial integrations page should include a Plex placeholder.

Plex MVP behavior:

```txt
show Plex integration card
show status as not connected
explain Plex-compatible folders
allow or suggest creating Videos/Plex folder
store future config shape if needed
```

Do not prioritize full Plex API integration before core app workflows work.

---

## API Keys

API key page should support:

```txt
list keys
create key
show generated key once
revoke key
show key prefix
show scopes
show last used date
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

Store only hashed API keys.

Never store raw API keys.

---

## Security Rules

Required:

```txt
validate all input
hash passwords securely
hash API keys
hash session tokens in database
use httpOnly cookies
protect dashboard routes
protect file downloads
sanitize filenames
prevent path traversal
do not expose server paths
require setup token
lock setup after claim
restrict settings by role
confirm destructive actions
```

Never log:

```txt
passwords
raw API keys
session tokens
setup token
private filesystem paths unless needed for server logs
```

---

## Docker and Self-Hosting

Arciin should support Docker Compose.

Target services:

```txt
web
api
worker
postgres
redis
caddy
```

Target volumes:

```txt
postgres_data
redis_data
arciin_data
```

Expected user flow:

```txt
docker compose up -d
open localhost or server IP
enter setup token
create first admin
enter dashboard
```

The app should work locally without an online account.

---

## Environment Variables

Expected variables:

```env
NODE_ENV=development

DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin
REDIS_URL=redis://localhost:6379

ARCIIN_DATA_DIR=./data/arciin
ARCIIN_SETUP_TOKEN=dev-token
ARCIIN_PUBLIC_URL=http://localhost:3000
ARCIIN_API_URL=http://localhost:4000

NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000

SESSION_COOKIE_NAME=arciin_session
SESSION_SECRET=change-this-in-production

MAX_UPLOAD_SIZE_MB=10240
```

Do not commit real secrets.

---

## Code Quality Rules

Use TypeScript everywhere.

Avoid:

```txt
large untyped any usage
fake final data
duplicated UI primitives
business logic inside React components
filesystem paths in browser responses
unprotected routes
silent upload failures
console error spam
dead placeholder buttons
```

Every major page should include:

```txt
loading state
empty state
error state
responsive layout
accessible controls
consistent spacing
```

---

## Accessibility

Required:

```txt
keyboard-accessible dialogs
focus-visible states
aria labels for icon buttons
real buttons for actions
escape key closes overlays/dialogs
reduced motion support where appropriate
alt text for thumbnails
```

---

## Commands

Use existing scripts when present.

Expected scripts:

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:worker

pnpm build
pnpm lint
pnpm typecheck

pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

Before finishing major work, run appropriate checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

If a command fails because the project is still being scaffolded, document the reason clearly.

---

## Implementation Discipline

When working on Arciin:

```txt
preserve existing project setup
work incrementally
keep the app runnable
prefer reusable modules
avoid destructive file changes
do not reinitialize Next.js
do not overwrite user work unnecessarily
do not create a landing page yet
do not create branding assets
```

When adding code:

```txt
make components reusable
keep API logic out of components
keep storage logic on the server
keep media processing in workers
use typed shared contracts where practical
```

---

## Definition of Done

A feature is not complete until:

```txt
it is wired into navigation if user-facing
it has loading states
it has error states
it has empty states where needed
it works responsively
it respects auth/permissions
it uses the Arciin visual system
it avoids fake final data
it passes type/lint checks where possible
```

For the MVP app, the target completed behavior is:

```txt
User opens /
User is routed to /setup if uninitialized
User claims instance with setup token
User creates first admin
User logs in
User sees dashboard
User sees sidebar based on sidebar-07
Default libraries exist
User creates folders
User drags files anywhere into the app
Upload overlay appears
Files upload and classify
Files store on disk
Metadata stores in PostgreSQL
Activity updates
Upload queue updates
Settings pages exist
API keys page exists
Integrations page exists
Docker Compose exists
```