import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Boxes,
  Brain,
  Code2,
  Database,
  Files,
  GalleryVerticalEnd,
  FingerprintPattern,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  User,
  Users,
  Webhook,
} from "lucide-react"

export type NavigationItem = {
  title: string
  href: string
  icon: LucideIcon
  description?: string
  children?: NavigationItem[]
}

/** Navigation arrays used by the command palette */
export const primaryNavigation: NavigationItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "AI Chat", href: "/chat", icon: MessageSquare },
  { title: "All Files", href: "/files", icon: Files },
  { title: "Integrations", href: "/integrations", icon: Plug },
]

export const operationsNavigation: NavigationItem[] = [
  { title: "Logs", href: "/logs", icon: Terminal },
  { title: "Jobs", href: "/jobs", icon: Boxes },
  { title: "Events", href: "/events", icon: GalleryVerticalEnd },
  { title: "Models", href: "/models", icon: Brain },
  { title: "Activity", href: "/activity", icon: Activity },
  { title: "Security", href: "/security", icon: ShieldCheck },
  { title: "Database", href: "/database", icon: Database },
  { title: "Passwords", href: "/passwords", icon: FingerprintPattern },
]

export const developerNavigation: NavigationItem[] = [
  { title: "Developer hub", href: "/developer", icon: Code2 },
  { title: "API Keys", href: "/developer/api-keys", icon: KeyRound },
  { title: "Events", href: "/events", icon: GalleryVerticalEnd },
  { title: "Webhooks", href: "/developer/webhooks", icon: Webhook },
  { title: "WebSockets", href: "/developer/web-sockets", icon: Server },
]

export const systemNavigation: NavigationItem[] = [
  { title: "Account",       href: "/account",               icon: User       },
  { title: "Storage",       href: "/settings/storage",      icon: Database   },
  { title: "Users",         href: "/settings/users",        icon: Users      },
  { title: "Security",      href: "/security",              icon: ShieldCheck},
  { title: "Settings",      href: "/settings",              icon: Settings   },
]

const pageTitles = new Map<string, string>([
  ["/dashboard",              "Overview"],
  ["/chat",                   "AI Chat"],
  ["/models",                 "Models"],
  ["/files",                  "All Files"],
  ["/inbox",                  "Inbox"],
  ["/videos",                 "Videos"],
  ["/images",                 "Images"],
  ["/music",                  "Music"],
  ["/documents",              "Documents"],
  ["/activity",               "Activity"],
  ["/jobs", "Jobs"],
  ["/developer", "Developer"],
  ["/developer/api-keys", "API keys"],
  ["/developer/webhooks", "Webhooks"],
  ["/developer/web-sockets", "WebSockets"],
  ["/api-keys", "API keys"],
  ["/events", "Events"],
  ["/webhooks", "Webhooks"],
  ["/database", "Database"],
  ["/passwords", "Passwords"],
  ["/integrations", "Integrations"],
  ["/settings", "Settings"],
  ["/settings/storage", "Storage"],
  ["/settings/domain", "Domain"],
  ["/settings/remote-access", "WebSockets"],
  ["/security",               "Security"],
  ["/settings/security",      "Security"],
  ["/settings/users",         "Users"],
  ["/docs",                   "Docs"],
  ["/account",                "Account"],
  ["/setup",                  "Setup"],
  ["/login",                  "Login"],
])

export function getPageTitle(pathname: string) {
  const exact = pageTitles.get(pathname)
  if (exact) return exact
  if (pathname.startsWith("/security")) return "Security"
  if (pathname.startsWith("/chat")) return "AI Chat"
  if (pathname.startsWith("/models")) return "Models"
  if (pathname.startsWith("/database/")) return "Database"
  if (pathname.startsWith("/developer/api-keys")) return "API keys"
  if (pathname.startsWith("/developer/webhooks")) return "Webhooks"
  if (pathname.startsWith("/developer/web-sockets")) return "WebSockets"
  if (pathname.startsWith("/developer")) return "Developer"
  return "Arciin"
}

