import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  Key,
  Library,
  Lock,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  Webhook,
  Zap,
} from "lucide-react"

import type { ActivitySummary } from "@/lib/types/models"

/** Explicit icon per activity event type. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  "asset.deleted": Trash2,
  "folder.deleted": Trash2,
  "webhook.deleted": Trash2,
  "appdata.database.deleted": Trash2,
  "api-key.revoked": Trash2,
  "instance.content_cleared": Trash2,
  "upload.completed": Upload,
  "upload.failed": AlertTriangle,
  "asset.moved": ArrowRightLeft,
  "folder.created": FolderPlus,
  "appdata.folder.created": FolderPlus,
  "appdata.database.created": FilePlus,
  "folder.locked": Lock,
  "share.created": Share2,
  "share.feedback": Share2,
  "api-key.created": Key,
  "api-key.rotated": RefreshCw,
  "webhook.created": Webhook,
  "webhook.test": Webhook,
  "auth.login": LogIn,
  "auth.register": UserPlus,
  "auth.login_failed": AlertTriangle,
  "auth.sessions_revoked": Shield,
  "profile.updated": UserPlus,
  "remote.public_url_changed": Globe,
  "instance.claimed": CheckCircle2,
  "instance.urls.updated": Globe,
  "settings.cloudflare_tunnel_started": Settings,
  "storage.migrated": ArrowRightLeft,
  "security.password_changed": Shield,
  "security.password_recovered": Shield,
  "security.recovery_failed": AlertTriangle,
  "security.rate_limited": Shield,
  "security.ip_denied": Shield,
  "security.ip_blocklist_added": Shield,
  "security.ip_blocklist_removed": Shield,
  "security.ip_allowlist_added": Shield,
  "security.ip_allowlist_removed": Shield,
  "security.allowlist_enforcement_changed": Shield,
}

const ENTITY_ICONS: Record<string, LucideIcon> = {
  asset: FileText,
  upload: Upload,
  folder: Folder,
  library: Library,
  "api-key": Key,
  webhook: Webhook,
  share: Share2,
  auth: LogIn,
  security: Shield,
  settings: Settings,
  instance: Settings,
  remote: Globe,
  profile: UserPlus,
  appdata: FileText,
}

function iconForAction(entity: string, action: string): LucideIcon | null {
  if (
    action.includes("delet") ||
    action === "revoked" ||
    action.includes("clear")
  ) {
    return Trash2
  }

  if (action.includes("fail") || action.includes("denied")) {
    return AlertTriangle
  }

  if (action === "completed") return Upload
  if (action === "moved" || action === "migrated") return ArrowRightLeft
  if (action === "locked") return Lock

  if (action === "created" || action === "claimed") {
    if (entity === "folder" || entity === "appdata") return FolderPlus
    if (entity === "asset") return FilePlus
    if (entity === "share") return Share2
    if (entity === "api-key") return Key
    if (entity === "webhook") return Webhook
    if (entity === "instance") return CheckCircle2
    return Plus
  }

  if (action.includes("login")) return LogIn
  if (action.includes("register")) return UserPlus

  if (action.includes("rotated")) return RefreshCw
  if (action.includes("updated") || action.includes("changed") || action.includes("started")) {
    if (entity === "remote" || entity === "instance") return Globe
    if (entity === "settings") return Settings
    return Pencil
  }

  return null
}

/** Pick an icon that matches the activity action, not just the entity. */
export function resolveActivityIcon(event: ActivitySummary): LucideIcon {
  const type = event.type.toLowerCase()

  if (TYPE_ICONS[type]) return TYPE_ICONS[type]

  const [entity = "", action = ""] = type.split(".")
  const actionIcon = action ? iconForAction(entity, action) : null
  if (actionIcon) return actionIcon

  const entityKey = event.entityType ?? entity
  if (entityKey && ENTITY_ICONS[entityKey]) return ENTITY_ICONS[entityKey]!

  return Zap
}
