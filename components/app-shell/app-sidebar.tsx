"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Bell, BookOpen, Boxes, ChevronLeft, ChevronRight,
  ChevronsUpDown, Code2, Database, Files, HelpCircle, LayoutDashboard,
  LogOut, Minus, MonitorDot, PackagePlus, Puzzle, RadioTower, Server,
  Settings, ShieldCheck, Sparkles, UserCog, Webhook,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  { id: "overview",     label: "Overview",     icon: LayoutDashboard, href: "/dashboard"    },
  { id: "files",        label: "All Files",    icon: Files,           href: "/files"        },
  { id: "activity",     label: "Activity",     icon: MonitorDot,  href: "/activity"     },
  { id: "integrations", label: "Integrations", icon: PackagePlus, href: "/integrations" },
]

const LOWER: NavItem[] = [
  { id: "jobs",          label: "Jobs",          icon: Boxes,       href: "/jobs"                   },
  { id: "api-keys",      label: "API Keys",      icon: Puzzle,      href: "/api-keys"               },
  { id: "events",        label: "Events",        icon: RadioTower,  href: "/events"                 },
  { id: "security",      label: "Security",      icon: ShieldCheck, href: "/settings/security"      },
  { id: "storage",       label: "Storage",       icon: Database,    href: "/settings/storage"       },
  { id: "webhooks",      label: "Webhooks",      icon: Webhook,     href: "/webhooks"               },
  { id: "remote-access", label: "Remote Access", icon: Server,      href: "/settings/remote-access" },
]

const BOTTOM: NavItem[] = [
  { id: "docs",          label: "Docs",          icon: BookOpen, href: "/docs"          },
  { id: "settings",      label: "Settings",      icon: Settings, href: "/settings"      },
  { id: "notifications", label: "Notifications", icon: Bell,     href: "/notifications" },
]

const LIBRARY_ROUTES: Record<string, string> = {
  videos:    "/videos",
  images:    "/images",
  music:     "/music",
  documents: "/documents",
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard" || href === "/settings") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("")
}

// ── flat link ──────────────────────────────────────────────────────────────
function FlatLink({
  label, icon: Icon, href, collapsed, pathname,
}: NavItem & { collapsed: boolean; pathname: string }) {
  const active = isActive(pathname, href)
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors select-none",
        collapsed && "justify-center px-0",
      )}
      style={{ background: active ? ACTIVE : "transparent", color: active ? TEXT_ON : TEXT_OFF }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = TEXT_ON } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_OFF } }}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" />
      {!collapsed && <span className="flex-1 leading-none">{label}</span>}
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
    .map((lib) => ({ id: lib.id, label: lib.name, href: LIBRARY_ROUTES[lib.slug]!, count: lib.assetCount }))

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
          <span className="font-heading text-base font-bold leading-none text-[#FF4F12]">A</span>
        ) : (
          <p className="font-heading text-[17px] font-bold leading-none tracking-tight" style={{ color: TEXT_ON }}>
            Arciin<span className="text-[#FF4F12]">.</span>
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
            <Sparkles className="h-[15px] w-[15px] shrink-0" />
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
          {LOWER.map((item) => (
            <FlatLink key={item.id} {...item} collapsed={collapsed} pathname={pathname} />
          ))}
        </div>
      </nav>

      {/* Bottom strip */}
      <div className="shrink-0 px-2 pb-1 pt-2" style={{ borderTop: `1px solid ${DIVIDER}` }}>
        <div className="space-y-[1px]">
          {BOTTOM.map((item) => (
            <FlatLink key={item.id} {...item} collapsed={collapsed} pathname={pathname} />
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
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-zinc-800 text-[13px] font-bold text-white">
                    {initials(auth.user.name)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-[2px] border-sidebar"
                  style={{ background: "#4ade80" }}
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
            className="w-56 rounded-xl p-1"
            style={{ background: "#111118", border: `1px solid ${BORDER}`, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
          >
            <DropdownMenuLabel className="px-2 pb-2 pt-1.5">
              <p className="text-[13px] font-semibold text-white">{auth.user.name}</p>
              <p className="mt-0.5 text-[11px] font-normal" style={{ color: "rgba(255,255,255,0.35)" }}>
                {auth.user.email}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator style={{ background: BORDER }} />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px]"
                style={{ color: TEXT_OFF }}
                onClick={() => router.push("/support")}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Support
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px]"
                style={{ color: TEXT_OFF }}
                onClick={() => router.push("/settings/developer")}
              >
                <Code2 className="h-3.5 w-3.5" />
                Developer
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px]"
                style={{ color: TEXT_OFF }}
                onClick={() => router.push("/account")}
              >
                <UserCog className="h-3.5 w-3.5" />
                Edit Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator style={{ background: BORDER }} />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-[13px]"
              style={{ color: "#f87171" }}
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
