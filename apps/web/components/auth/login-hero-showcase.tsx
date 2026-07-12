import {
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Database,
  FileText,
  Files,
  FileVideo,
  FingerprintPattern,
  GalleryVerticalEnd,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  MessageSquare,
  MonitorDot,
  Music4,
  PackagePlus,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DASHBOARD_ACTIVITY_LIMIT,
  DASHBOARD_UPLOADS_LIMIT,
} from "@/lib/dashboard-card-styles"

/**
 * Hero panel for the sign-in screens: a dashboard preview blended into the
 * orange at the top (bleeds off the right edge, fades toward the bottom)
 * with the headline at the bottom. Mirrors the current post-login dashboard.
 * Purely decorative — illustrative data only.
 */

const SIDEBAR_PRIMARY = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "AI Chat", icon: MessageSquare },
  { label: "All Files", icon: Files },
  { label: "Integrations", icon: PackagePlus },
] as const

const SIDEBAR_LIBRARIES = [
  { label: "Inbox", count: 12 },
  { label: "Videos", count: 342 },
  { label: "Images", count: 1246 },
  { label: "Music", count: 320 },
  { label: "Documents", count: 186 },
] as const

const SIDEBAR_SECONDARY = [
  { label: "Logs", icon: Terminal },
  { label: "Jobs", icon: BriefcaseBusiness },
  { label: "Events", icon: GalleryVerticalEnd },
  { label: "Models", icon: Boxes },
  { label: "Activity", icon: MonitorDot },
  { label: "Security", icon: ShieldCheck },
  { label: "Database", icon: Database },
  { label: "Passwords", icon: FingerprintPattern },
] as const

const SIDEBAR_BOTTOM = [
  { label: "Docs", icon: BookOpen },
  { label: "Settings", icon: Settings },
  { label: "Notifications", icon: Bell },
] as const

const LIBRARY_SHORTCUTS = [
  { label: "Inbox", count: 0 },
  { label: "Videos", count: 25 },
  { label: "Images", count: 357 },
  { label: "Music", count: 1 },
  { label: "Documents", count: 10 },
] as const

const RECENT_ACTIVITY = [
  {
    title: "Link imported",
    badge: "Upload · Completed",
    message: "TikTok clip saved to Videos.",
    meta: "1m ago",
    icon: Upload,
  },
  {
    title: "Asset deleted",
    badge: "Asset · Deleted",
    message: "Vacation 2024.mp4 was moved to deleted state.",
    meta: "12m ago",
    icon: Trash2,
  },
  {
    title: "Upload stored",
    badge: "Upload · Completed",
    message: "IMG_7823.jpg finished processing in Images.",
    meta: "28m ago",
    icon: Upload,
  },
  {
    title: "Import failed",
    badge: "Upload · Failed",
    message: "Invalid IP address: undefined",
    meta: "45m ago",
    icon: MonitorDot,
  },
  {
    title: "Folder created",
    badge: "Folder · Created",
    message: "Summer trip folder added to Videos.",
    meta: "1h ago",
    icon: FileText,
  },
  {
    title: "Upload stored",
    badge: "Upload · Completed",
    message: "Family Dinner.mp4 finished processing in Videos.",
    meta: "2h ago",
    icon: Upload,
  },
  {
    title: "Public URL changed",
    badge: "Remote · Changed",
    message: "Instance public URL updated for remote access.",
    meta: "4h ago",
    icon: MonitorDot,
  },
  {
    title: "System backup completed",
    badge: "Instance · Completed",
    message: "Nightly backup finished without errors.",
    meta: "6h ago",
    icon: Database,
  },
] as const

const UPLOADS_PLACEHOLDER_ICONS = [
  FileVideo,
  ImageIcon,
  Music4,
  FileText,
  FileVideo,
  ImageIcon,
  Music4,
  FileText,
] as const

const SYSTEM_TILES = [
  "API",
  "Database",
  "Redis",
  "Worker",
  "Storage",
  "App data",
] as const

function MiniPanel({
  title,
  description,
  children,
  className,
  fill = false,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  /** Stretch body to fill a matched-height overview column. */
  fill?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/12 bg-white/[0.08] p-2",
        fill && "flex h-full flex-col",
        className,
      )}
    >
      <div className="shrink-0 border-l-2 border-white/45 pl-1.5">
        <p className="text-[8.5px] font-semibold text-white/88">{title}</p>
        {description ? <p className="text-[7px] text-white/45">{description}</p> : null}
      </div>
      <div className={cn("mt-1.5", fill && "flex min-h-0 flex-1 flex-col")}>{children}</div>
    </div>
  )
}

function MiniSidebar() {
  return (
    <div className="flex w-[148px] shrink-0 flex-col bg-black/15 px-2 py-3">
      <p className="font-heading mb-2.5 px-1.5 text-[13px] font-bold tracking-tight text-white/90">
        Arciin<span className="text-white/45">.</span>
      </p>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-hidden">
        {SIDEBAR_PRIMARY.map((item) => (
          <div
            key={item.label}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1 text-[9px] font-medium",
              "active" in item && item.active ? "bg-white/20 text-white" : "text-white/55",
            )}
          >
            <item.icon className="size-[11px] shrink-0" />
            {item.label}
          </div>
        ))}

        <div className="my-1.5 h-px bg-white/12" />

        <div className="flex items-center gap-2 px-2 py-1 text-[7px] font-semibold uppercase tracking-wider text-white/35">
          <Library className="size-[10px] shrink-0" />
          Libraries
        </div>
        {SIDEBAR_LIBRARIES.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between rounded-lg py-[3px] pl-[26px] pr-2 text-[8.5px] font-medium text-white/55"
          >
            {item.label}
            <span className="rounded bg-white/12 px-1 py-px text-[6.5px] tabular-nums text-white/50">
              {item.count}
            </span>
          </div>
        ))}

        <div className="my-1.5 h-px bg-white/12" />

        {SIDEBAR_SECONDARY.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 rounded-lg px-2 py-[3.5px] text-[8.5px] font-medium text-white/55"
          >
            <item.icon className="size-[10px] shrink-0" />
            {item.label}
          </div>
        ))}
      </div>

      <div className="mt-1 border-t border-white/12 pt-1.5">
        {SIDEBAR_BOTTOM.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 rounded-lg px-2 py-[3.5px] text-[8.5px] font-medium text-white/55"
          >
            <item.icon className="size-[10px] shrink-0" />
            {item.label}
          </div>
        ))}

        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
          <span className="relative size-5 shrink-0 rounded-full bg-white/20">
            <span
              className="absolute -bottom-px -right-px size-1.5 rounded-full border border-black/30 bg-emerald-400"
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[7.5px] font-semibold text-white/82">Admin</p>
            <p className="truncate text-[6px] text-white/40">owner@local</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniStorageCard() {
  const r = 15.5
  const circumference = 2 * Math.PI * r
  const percent = 62

  return (
    <MiniPanel title="Storage" description="Local object storage on this server.">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 40 40" className="size-[52px] shrink-0">
          <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
            transform="rotate(-90 20 20)"
          />
          <text
            x="20"
            y="19"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.95)"
            fontSize="7"
            fontWeight="700"
          >
            {percent}%
          </text>
          <text x="20" y="26" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="3.2">
            of 4 TB used
          </text>
        </svg>

        <div className="min-w-0 flex-1">
          <ul className="space-y-0.5">
            {LIBRARY_SHORTCUTS.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-1 rounded-md px-0.5 py-[3px] text-[7px] font-medium text-white/75"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[#ff6a30]/95" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 tabular-nums text-white/50">{item.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MiniPanel>
  )
}

function MiniMediaSpotlight() {
  return (
    <MiniPanel title="Media library" description="Browse your default libraries on this server.">
      <div className="relative flex h-[4.5rem] overflow-hidden rounded-lg border border-white/10 bg-white/[0.08]">
        <div className="flex min-w-0 flex-1 flex-col justify-between p-1.5">
          <div className="max-w-full">
            <p className="text-[8.5px] font-semibold text-white/88">Videos</p>
            <p className="mt-0.5 line-clamp-2 text-[6.5px] leading-snug text-white/55">
              Video files route to Videos — ready for Plex folders.
            </p>
          </div>
          <div className="flex justify-start gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1 rounded-full",
                  i === 0 ? "w-2.5 bg-white/85" : "bg-white/30",
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex w-[38%] shrink-0 items-center justify-center border-l border-white/10 bg-white/[0.05]">
          <FileVideo className="size-5 text-white/35" strokeWidth={1.75} />
        </div>
      </div>
    </MiniPanel>
  )
}

function MiniUploadsGrid() {
  return (
    <MiniPanel title="Recent uploads" description="Latest files saved on this server.">
      <div className="grid grid-cols-4 gap-1">
        {UPLOADS_PLACEHOLDER_ICONS.slice(0, DASHBOARD_UPLOADS_LIMIT).map((Icon, i) => (
          <div
            key={i}
            className="flex aspect-square items-center justify-center rounded-md border border-white/10 bg-white/[0.08]"
          >
            <Icon className="size-2.5 text-white/35" strokeWidth={1.75} />
          </div>
        ))}
      </div>
    </MiniPanel>
  )
}

function MiniActivityFeed() {
  return (
    <MiniPanel
      fill
      title="Recent activity"
      description={`Top ${DASHBOARD_ACTIVITY_LIMIT} events on this instance.`}
    >
      <div className="flex min-h-0 flex-1 flex-col divide-y divide-white/10">
        {RECENT_ACTIVITY.slice(0, DASHBOARD_ACTIVITY_LIMIT).map((row) => (
          <div
            key={`${row.title}-${row.meta}`}
            className="flex min-h-0 min-w-0 flex-1 items-center gap-1.5 px-0.5 py-1"
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-md bg-white/15 text-white/80">
              <row.icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="truncate text-[7.5px] font-semibold leading-tight text-white/88">
                {row.title}
              </p>
              <p className="truncate text-[6.5px] leading-snug text-white/55">{row.message}</p>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded bg-white/12 px-1 py-px text-[4.5px] font-semibold uppercase text-white/50">
              {row.badge.split(" · ")[0]}
            </span>
            <span className="shrink-0 text-[6px] tabular-nums text-white/45">{row.meta}</span>
          </div>
        ))}
      </div>
    </MiniPanel>
  )
}

function MiniSystemStrip() {
  return (
    <MiniPanel title="System" description="All services responding on this host.">
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
        {SYSTEM_TILES.map((label) => (
          <div
            key={label}
            className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-1.5"
          >
            <p className="flex items-center justify-between text-[7px] font-semibold text-white/80">
              {label}
              <span className="size-1 rounded-full bg-emerald-400/90 shadow-[0_0_0_2px_rgba(52,211,153,0.2)]" />
            </p>
            <p className="mt-1 text-[6px] text-white/45">Online</p>
          </div>
        ))}
      </div>
    </MiniPanel>
  )
}

function MiniMain() {
  return (
    <div className="min-w-0 flex-1 space-y-1.5 p-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1.5">
        <p className="font-heading text-[11px] font-semibold text-white/92">
          Arciin<span className="text-white/50">.</span>
        </p>
        <p className="mt-0.5 text-[7px] leading-relaxed text-white/55">
          Your private command center for files, libraries, and background work on this server.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <MiniStorageCard />
        <MiniMediaSpotlight />
      </div>

      <div className="h-px bg-white/10" />

      <div className="grid grid-cols-[1.2fr_0.8fr] items-stretch gap-1.5">
        <MiniUploadsGrid />
        <MiniActivityFeed />
      </div>

      <div className="h-px bg-white/10" />

      <MiniSystemStrip />
    </div>
  )
}

/** Glass preview blended into the orange — real sidebar structure, translucent skin. */
export function DashboardPreview({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none flex select-none overflow-hidden rounded-2xl bg-white/[0.07] backdrop-blur-[2px]",
        className,
      )}
    >
      <MiniSidebar />
      <MiniMain />
    </div>
  )
}

/** Orange panel content: blended preview on top, headline at the bottom. */
export function LoginHeroShowcase() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden px-9 pb-10 pt-9">
      <div
        aria-hidden
        className="absolute left-9 top-6 z-0 w-[118%] origin-top-left scale-[0.84] opacity-85"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
        }}
      >
        <DashboardPreview />
      </div>

      <div className="relative z-10 mt-auto max-w-lg space-y-5">
        <h2 className="font-heading text-[2.4rem] font-bold leading-[1.14] tracking-tight text-white xl:text-[2.7rem]">
          Your media.
          <span className="block">Your server.</span>
          <span className="block text-white/55">Your control.</span>
        </h2>
        <p className="max-w-[24rem] text-[14.5px] leading-7 text-white/80">
          Arciin is the self-hosted platform for managing, streaming, and sharing your media
          and files—securely, privately, and on your terms.
        </p>
      </div>
    </div>
  )
}
