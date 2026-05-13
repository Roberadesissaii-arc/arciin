import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  Brain,
  Database,
  Files,
  Plug,
  Puzzle,
  RadioTower,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  Users,
  Webhook,
  LayoutDashboard,
  KeyRound,
} from "lucide-react"

export type NavigationItem = {
  title: string
  href: string
  icon: LucideIcon
  description?: string
  children?: NavigationItem[]
}

export type SidebarNavEntry = {
  title: string
  href: string
  icon: LucideIcon
  items?: { title: string; href: string; count?: number }[]
}

/**
 * Band 1 — 4 top flat items.
 * Uploads removed (already on dashboard); Activity promoted here.
 */
export const sidebarNavPrimary: SidebarNavEntry[] = [
  { title: "Overview",     href: "/dashboard",    icon: LayoutDashboard },
  { title: "All Files",    href: "/files",        icon: Files           },
  { title: "Activity",     href: "/activity",     icon: Activity        },
  { title: "Integrations", href: "/integrations", icon: Plug            },
]

/**
 * Band 2 — 8 lower flat items.
 * Order: Jobs → API Keys → Events → Users → Security → Storage → Webhooks → Remote Access
 * (Remote Access at the end — longest label; Webhooks before it)
 */
export const sidebarNavLower: SidebarNavEntry[] = [
  { title: "Jobs",          href: "/jobs",                  icon: Boxes        },
  { title: "API Keys",      href: "/api-keys",              icon: Puzzle       },
  { title: "Events",        href: "/events",                icon: RadioTower   },
  { title: "Users",         href: "/settings/users",        icon: Brain        },
  { title: "Security",      href: "/settings/security",     icon: ShieldCheck  },
  { title: "Storage",       href: "/settings/storage",      icon: Database     },
  { title: "Webhooks",      href: "/webhooks",              icon: Webhook      },
  { title: "Remote Access", href: "/settings/remote-access",icon: Server       },
]

/** Footer bottom strip — Docs / Settings / Notifications (mirrors Arceclaw) */
export const sidebarNavBottom: SidebarNavEntry[] = [
  { title: "Docs",          href: "/docs",          icon: BookOpen },
  { title: "Settings",      href: "/settings",      icon: Settings },
  { title: "Notifications", href: "/notifications", icon: Bell     },
]

/** Legacy arrays kept for command palette and other non-sidebar code */
export const primaryNavigation: NavigationItem[] = [
  { title: "Overview",   href: "/dashboard",  icon: LayoutDashboard },
  { title: "All Files",  href: "/files",      icon: Files           },
  { title: "Activity",   href: "/activity",   icon: Activity        },
  { title: "Integrations",href: "/integrations",icon: Plug          },
]

export const operationsNavigation: NavigationItem[] = [
  { title: "Activity", href: "/activity",  icon: Terminal },
  { title: "Jobs",     href: "/jobs",      icon: Boxes    },
]

export const developerNavigation: NavigationItem[] = [
  { title: "API Keys", href: "/api-keys", icon: KeyRound  },
  { title: "Events",   href: "/events",   icon: RadioTower},
  { title: "Webhooks", href: "/webhooks", icon: Webhook   },
]

export const systemNavigation: NavigationItem[] = [
  { title: "Storage",       href: "/settings/storage",      icon: Database   },
  { title: "Users",         href: "/settings/users",        icon: Users      },
  { title: "Security",      href: "/settings/security",     icon: ShieldCheck},
  { title: "Remote Access", href: "/settings/remote-access",icon: Server     },
  { title: "Settings",      href: "/settings",              icon: Settings   },
]

const pageTitles = new Map<string, string>([
  ["/dashboard",              "Overview"],
  ["/files",                  "All Files"],
  ["/videos",                 "Videos"],
  ["/images",                 "Images"],
  ["/music",                  "Music"],
  ["/documents",              "Documents"],
  ["/uploads",                "Uploads"],
  ["/activity",               "Activity"],
  ["/jobs",                   "Jobs"],
  ["/api-keys",               "API Keys"],
  ["/events",                 "Events"],
  ["/webhooks",               "Webhooks"],
  ["/integrations",           "Integrations"],
  ["/settings",               "Settings"],
  ["/settings/storage",       "Storage"],
  ["/settings/remote-access", "Remote Access"],
  ["/settings/security",      "Security"],
  ["/settings/users",         "Users"],
  ["/notifications",          "Notifications"],
  ["/docs",                   "Docs"],
  ["/setup",                  "Setup"],
  ["/login",                  "Login"],
])

export function getPageTitle(pathname: string) {
  return pageTitles.get(pathname) ?? "Arciin"
}

export type SidebarProjectItem = {
  name: string
  href: string
  icon: LucideIcon
}

// Kept for compatibility — unused by sidebar since NavLibraries fetches live
export const sidebarNavMiddle: SidebarNavEntry[] = []
export const sidebarMainNav: SidebarNavEntry[] = [
  ...sidebarNavPrimary,
  ...sidebarNavLower,
]

// Kept for nav-projects.tsx compatibility
export const sidebarProjectNav: SidebarProjectItem[] = []
