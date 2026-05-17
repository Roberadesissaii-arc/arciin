"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Bell, BookOpen, Boxes, ChevronLeft, ChevronRight,
  ChevronsUpDown, Code2, Database, Files, FingerprintPattern, GalleryVerticalEnd, HelpCircle, LayoutDashboard,
  Library,
  ListTree, LogOut, MessageSquare, Minus, MonitorDot, PackagePlus,
  Settings, ShieldCheck, Terminal, UserCog,
} from "lucide-react"
import { toast } from "sonner"

import { UserIdentityAvatar } from "@/components/app-shell/user-identity-avatar"
import { NotificationUnreadBadge } from "@/components/notifications/notification-unread-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sidebar, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useLibraries } from "@/hooks/use-libraries"
import { useLogout } from "@/hooks/use-auth"
import type { AuthSession } from "@/lib/types/models"

// ── colour tokens ──────────────────────────────────────────────────────────
const DIVIDER  = "rgba(255,255,255,0.06)"
const TEXT_OFF = "rgba(255,255,255,0.5)"
const TEXT_ON  = "rgba(255,255,255,0.95)"
const SECT     = "rgba(255,255,255,0.3)"
const ACTIVE   = "rgba(255,255,255,0.08)"
const HOVER    = "rgba(255,255,255,0.04)"
const CNT_BG   = "rgba(255,255,255,0.07)"
const CNT_TX   = "rgba(255,255,255,0.45)"
const BORDER   = "rgba(255,255,255,0.07)"

// ── nav data ───────────────────────────────────────────────────────────────
type NavItem = { id: string; label: string; icon: React.ElementType; href: string }

const PRIMARY: NavItem[] = [
  { id: "overview",      label: "Overview",      icon: LayoutDashboard, href: "/dashboard"     },
  { id: "chat",          label: "AI Chat",       icon: MessageSquare,   href: "/chat"          },
  { id: "files",         label: "All Files",     icon: Files,           href: "/files"         },
  { id: "integrations",  label: "Integrations",  icon: PackagePlus,     href: "/integrations"  },
]

/** Flat sidebar links (same row style as Overview / AI Chat) — no section parent. */
const SIDEBAR_SECONDARY_NAV: NavItem[] = [
  { id: "logs",     label: "Logs",     icon: Terminal,   href: "/logs" },
  { id: "jobs",     label: "Jobs",     icon: ListTree,   href: "/jobs" },
  { id: "events",   label: "Events",   icon: GalleryVerticalEnd, href: "/events" },
  { id: "models",   label: "Models",   icon: Boxes,      href: "/models" },
  { id: "activity", label: "Activity", icon: MonitorDot, href: "/activity" },
  { id: "security", label: "Security", icon: ShieldCheck, href: "/security" },
  { id: "database", label: "Database", icon: Database,    href: "/database" },
  { id: "passwords", label: "Passwords", icon: FingerprintPattern, href: "/passwords" },
]

const BOTTOM: NavItem[] = [
  { id: "docs",          label: "Docs",          icon: BookOpen, href: "/docs"          },
  { id: "settings",      label: "Settings",      icon: Settings, href: "/settings"      },
  { id: "notifications", label: "Notifications", icon: Bell,     href: "/notifications" },
]

const LIBRARY_ROUTES: Record<string, string> = {
  inbox:     "/inbox",
  videos:    "/videos",
  images:    "/images",
  music:     "/music",
  documents: "/documents",
}

const LIBRARY_ORDER = ["inbox", "videos", "images", "music", "documents"]

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

// ── flat link ──────────────────────────────────────────────────────────────
function FlatLink({
  label, icon: Icon, href, collapsed, pathname, showUnreadBadge,
}: NavItem & { collapsed: boolean; pathname: string; showUnreadBadge?: boolean }) {
  const active = isActive(pathname, href)
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors select-none",
        collapsed && "justify-center px-0",
        showUnreadBadge && collapsed && "relative",
      )}
      style={{ background: active ? ACTIVE : "transparent", color: active ? TEXT_ON : TEXT_OFF }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = TEXT_ON } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_OFF } }}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" />
      {!collapsed && <span className="flex-1 leading-none">{label}</span>}
      {showUnreadBadge ? <NotificationUnreadBadge collapsed={collapsed} /> : null}
      {collapsed && (
        <span
          className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "#111118", border: `1px solid ${BORDER}`, color: TEXT_ON }}
        >
          {label}
        </span>
      )}
    </Link>
  )
}

// ── divider ────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: "1px", background: DIVIDER, margin: "8px 4px" }} />
}

// ── inner component ────────────────────────────────────────────────────────
function AppSidebarInner({ auth }: { auth: AuthSession }) {
  const pathname = usePathname()
  const router = useRouter()
  const { state, toggleSidebar, isMobile } = useSidebar()
  const collapsed = state === "collapsed"

  const logoutMutation = useLogout()
  const { data: libraries } = useLibraries()

  const libraryItems = (libraries ?? [])
    .filter((lib) => LIBRARY_ROUTES[lib.slug] !== undefined)
    .map((lib) => ({ id: lib.id, label: lib.name, href: LIBRARY_ROUTES[lib.slug]!, count: lib.assetCount, slug: lib.slug }))
    .sort((a, b) => LIBRARY_ORDER.indexOf(a.slug) - LIBRARY_ORDER.indexOf(b.slug))

  async function handleLogout() {
    try {
      await logoutMutation.mutateAsync()
      toast.success("Signed out.")
      router.push("/login")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign out.")
    }
  }

  return (
    <>
      {/* Brand */}
      <div
        className={cn("flex h-14 shrink-0 items-center px-4", collapsed && "justify-center px-0")}
        style={{ borderBottom: `1px solid ${DIVIDER}` }}
      >
        {collapsed ? (
          <span className="font-heading text-base font-bold leading-none text-[var(--arciin-accent)]">A</span>
        ) : (
          <p className="font-heading text-[17px] font-bold leading-none tracking-tight" style={{ color: TEXT_ON }}>
            Arciin<span className="text-[var(--arciin-accent)]">.</span>
          </p>
        )}
      </div>

      {/* Nav */}
      <nav className="scrollbar-hide flex-1 overflow-y-auto px-2 py-2.5">
        <div className="space-y-[1px]">
          {PRIMARY.map((item) => (
            <FlatLink key={item.id} {...item} collapsed={collapsed} pathname={pathname} />
          ))}
        </div>

        <Divider />

        {/* Libraries section */}
        <div>
          <div
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider select-none",
              collapsed && "justify-center px-0",
            )}
            style={{ color: SECT }}
          >
            <Library className="h-[15px] w-[15px] shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Libraries</span>
                <Minus className="h-3 w-3 shrink-0 opacity-40" />
              </>
            )}
          </div>
          {!collapsed && (
            <div className="mt-0.5 pb-1">
              {libraryItems.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center rounded-lg pl-9 pr-3 py-[7px] text-[13px] font-medium transition-colors select-none"
                    style={{ background: active ? ACTIVE : "transparent", color: active ? TEXT_ON : TEXT_OFF }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = TEXT_ON } }}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_OFF } }}
                  >
                    <span className="flex-1 leading-none">{item.label}</span>
                    {item.count > 0 && (
                      <span
                        className="ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums leading-none"
                        style={{ background: CNT_BG, color: CNT_TX }}
                      >
                        {item.count}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <Divider />

        <div className="space-y-[1px]">
          {SIDEBAR_SECONDARY_NAV.map((item) => (
            <FlatLink key={item.id} {...item} collapsed={collapsed} pathname={pathname} />
          ))}
        </div>
      </nav>

      {/* Bottom strip */}
      <div className="shrink-0 px-2 pb-1 pt-2" style={{ borderTop: `1px solid ${DIVIDER}` }}>
        <div className="space-y-[1px]">
          {BOTTOM.map((item) => (
            <FlatLink
              key={item.id}
              {...item}
              collapsed={collapsed}
              pathname={pathname}
              showUnreadBadge={item.id === "notifications"}
            />
          ))}
        </div>

        {/* User card */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "mt-2 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 outline-none transition-colors",
                collapsed && "justify-center px-0",
              )}
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${DIVIDER}` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}
            >
              <div className="relative shrink-0">
                <UserIdentityAvatar name={auth.user.name} size="sm" />
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#18181B] bg-emerald-400"
                  aria-hidden
                />
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[12px] font-semibold leading-none" style={{ color: TEXT_ON }}>
                      {auth.user.name}
                    </p>
                    <p className="mt-[3px] truncate text-[10px]" style={{ color: "rgba(255,255,255,0.32)" }}>
                      {auth.user.email}
                    </p>
                  </div>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
                </>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className={cn(
              "w-56 rounded-xl border border-white/10 bg-[#18181B] p-1 text-zinc-300 shadow-xl ring-1 ring-black/40",
              "backdrop-blur-xl",
            )}
          >
            <DropdownMenuLabel className="flex items-center gap-2.5 px-2 pb-2 pt-1.5 font-normal">
              <UserIdentityAvatar name={auth.user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">{auth.user.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{auth.user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px] text-zinc-400 focus:bg-white/[0.06] focus:text-white data-highlighted:bg-white/[0.06] data-highlighted:text-white"
                onClick={() => router.push("/support")}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Support
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px] text-zinc-400 focus:bg-white/[0.06] focus:text-white data-highlighted:bg-white/[0.06] data-highlighted:text-white"
                onClick={() => router.push("/developer")}
              >
                <Code2 className="h-3.5 w-3.5" />
                Developer
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px] text-zinc-400 focus:bg-white/[0.06] focus:text-white data-highlighted:bg-white/[0.06] data-highlighted:text-white"
                onClick={() => router.push("/account")}
              >
                <UserCog className="h-3.5 w-3.5" />
                Edit Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer gap-2 rounded-lg text-[13px] text-red-400 focus:bg-red-500/10 focus:text-red-300 data-highlighted:bg-red-500/10 data-highlighted:text-red-300"
              disabled={logoutMutation.isPending}
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Collapse button */}
        {!isMobile && (
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "mt-1 flex h-8 w-full items-center rounded-lg px-2 text-[11px] transition-colors",
              collapsed ? "justify-center" : "justify-end gap-1",
            )}
            style={{ color: "rgba(255,255,255,0.18)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = "rgba(255,255,255,0.5)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.18)" }}
          >
            {collapsed
              ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              : <><span>Collapse</span><ChevronLeft className="h-3.5 w-3.5 shrink-0" /></>
            }
          </button>
        )}
      </div>
    </>
  )
}

export function AppSidebar({ auth }: { auth: AuthSession }) {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <AppSidebarInner auth={auth} />
    </Sidebar>
  )
}
