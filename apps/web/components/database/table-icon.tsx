import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Boxes,
  Database,
  Film,
  Folder,
  FolderTree,
  HardDrive,
  Home,
  Key,
  KeyRound,
  Layers2,
  Library,
  Puzzle,
  User,
} from "lucide-react"

const TABLE_ICONS: Record<string, LucideIcon> = {
  users: User,
  sessions: KeyRound,
  "api-keys": Key,
  libraries: Library,
  folders: Folder,
  assets: Film,
  "storage-objects": HardDrive,
  "activity-events": Activity,
  jobs: Boxes,
  integrations: Puzzle,
  "app-databases": Layers2,
  "app-database-folders": FolderTree,
  "app-database-records": Database,
  "instance-config": Home,
}

export function TableIcon({ name }: { name: string }) {
  const Icon = TABLE_ICONS[name] ?? Database
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary shadow-inner shadow-black/[0.03]">
      <Icon className="size-4" aria-hidden />
    </div>
  )
}
