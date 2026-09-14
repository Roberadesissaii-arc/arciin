"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Bell, BookOpen, Boxes, ChevronLeft, ChevronRight,
  ChevronsUpDown, Code2, Database, Files, FingerprintPattern, GalleryVerticalEnd, HelpCircle, LayoutDashboard,
  Library,
  BriefcaseBusiness,
  LogOut,
  MessageSquare,
  Minus,
  MonitorDot,
  PackagePlus,
  Settings, ShieldCheck, Terminal, UserCog,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import {
  AiTaskSpinner,
  aiTaskHref,
  useRunningAiTasks,
} from "@/components/app-shell/ai-task-activity"
import { UserIdentityAvatar } from "@/components/app-shell/user-identity-avatar"
import { clearPendingWelcomeToast } from "@/lib/auth/login-remember"
import { ArciinIcon, ArciinSidebarWordmarkText } from "@/components/ui/arciin-icon"
import { getMe } from "@/lib/api/auth"
import { getUpdateCheck } from "@/lib/api/instance"
import { queryKeys } from "@/lib/api/query-keys"
import { resolveUserAvatarUrl } from "@/lib/utils/user-avatar-url"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useLibraries } from "@/hooks/use-libraries"
import { useLogout } from "@/hooks/use-auth"
import { useLicense } from "@/lib/license/use-license"
import { NAV_ITEM_FEATURES } from "@/lib/license/nav-features"
import { describeBookRun } from "@/lib/api/book-runs"
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
  { id: "jobs",     label: "Jobs",     icon: BriefcaseBusiness, href: "/jobs" },
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
  inbox:          "/inbox",
  videos:         "/videos",
  images:         "/images",
  music:          "/music",
  documents:      "/documents",
}

const LIBRARY_ORDER = ["inbox", "videos", "images", "music", "documents"]

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

// ── flat link ──────────────────────────────────────────────────────────────
function FlatLink({
  label, icon: Icon, href, collapsed, pathname, showUnreadBadge,
  locked, planBadge, trailing, tooltipSuffix, matchHref,
}: NavItem & {
  collapsed: boolean
  pathname: string
  showUnreadBadge?: boolean
  locked?: boolean
  planBadge?: string | null
  /** Rendered at the end of the row — the running-work spinner lives here. */
  trailing?: React.ReactNode
  tooltipSuffix?: string
  /**
   * What decides the active highlight, when `href` carries a query string.
   *
   * A running task points AI Chat at `/chat?c=…`, and `isActive` compares
   * against a pathname that never has a query — so without this the row would
   * go dim exactly while it is the one doing something.
   */
  matchHref?: string
}) {
  const active = isActive(pathname, matchHref ?? href)
  // Keep the real route so FeatureGate can show an in-page upgrade state (not bounce to Settings).
  const link = (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors select-none",
        collapsed && "justify-center px-0",
        showUnreadBadge && collapsed && "relative",
        locked && "opacity-75",
      )}
      style={{ background: active ? ACTIVE : "transparent", color: active ? TEXT_ON : TEXT_OFF }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = TEXT_ON } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT_OFF } }}
      title={locked && planBadge ? `Available on ${planBadge}` : undefined}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" />
      {!collapsed && <span className="flex-1 leading-none">{label}</span>}
      {!collapsed && locked && planBadge ? (
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
          style={{
            color: "var(--arciin-accent, #ff4f12)",
            background: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--arciin-accent, #ff4f12) 28%, transparent)",
          }}
        >
          {planBadge}
        </span>
      ) : null}
      {trailing}
      {showUnreadBadge ? <NotificationUnreadBadge collapsed={collapsed} /> : null}
    </Link>
  )

  if (!collapsed) {
    return link
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        showArrow={false}
        className="border border-white/10 bg-[#111118] px-2.5 py-1.5 text-xs font-medium text-white shadow-md"
      >
        {locked && planBadge ? `${label} · ${planBadge}` : tooltipSuffix ? `${label} · ${tooltipSuffix}` : label}
      </TooltipContent>
    </Tooltip>
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

  const meQuery = useQuery({
    queryKey: queryKeys.authMe,
    queryFn: ({ signal }) => getMe(signal),
    initialData: auth,
    staleTime: 30_000,
  })
  const sessionUser = meQuery.data?.user ?? auth.user
  const avatarSrc = resolveUserAvatarUrl(sessionUser.avatarUrl, sessionUser.updatedAt)

  const logoutMutation = useLogout()
  const { data: libraries } = useLibraries()
  const license = useLicense()
  /**
   * Long-running AI work, shown on the row that owns it.
   *
   * While a book is being written the AI Chat row spins and points at that
   * conversation, so the one click a reader is likely to make lands them where
   * the work is rather than on a fresh, empty chat.
   */
  const runningTasks = useRunningAiTasks()

  const updateQuery = useQuery({
    queryKey: queryKeys.updateCheck,
    queryFn: ({ signal }) => getUpdateCheck({ signal }),
    staleTime: 5 * 60 * 1000,
  })

  /**
   * `shouldPaywall`, not `!hasFeature`.
   *
   * `hasFeature` is false while the licence is still unresolved, so the lock
   * badge rendered on every server render — including for Pro users. That was
   * also the cause of a hydration mismatch on every page after the first: the
   * server had no licence and drew the badge, while the client read its cached
   * Pro status and did not, so React discarded and re-rendered the tree.
   *
   * `shouldPaywall` is the rule use-license.ts documents — a paywall needs an
   * authoritative Free answer, and "not loaded yet" is not one. It stays false
   * until the licence resolves, which keeps both renders identical.
   */
  function navLock(itemId: string): { locked: boolean; planBadge: string | null } {
    const feature = NAV_ITEM_FEATURES[itemId]
    if (!feature) return { locked: false, planBadge: null }
    if (!license.shouldPaywall(feature)) return { locked: false, planBadge: null }
    const plan = license.requiredPlanFor(feature)
    return { locked: true, planBadge: plan ? license.planLabel(plan) : "Pro" }
  }

  const libraryItems = (libraries ?? [])
    .filter((lib) => LIBRARY_ROUTES[lib.slug] !== undefined)
    .map((lib) => ({ id: lib.id, label: lib.name, href: LIBRARY_ROUTES[lib.slug]!, count: lib.assetCount, slug: lib.slug }))
    .sort((a, b) => LIBRARY_ORDER.indexOf(a.slug) - LIBRARY_ORDER.indexOf(b.slug))

  async function handleLogout() {
    try {
      clearPendingWelcomeToast()
      await logoutMutation.mutateAsync()
      router.push("/login")
      router.refresh()
    } catch (err) {
      toast.error("Could not sign out", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
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
          <ArciinIcon size="sidebar" />
        ) : (
          <ArciinSidebarWordmarkText />
        )}
      </div>

      {/* Nav */}
      <nav className="scrollbar-hide flex-1 overflow-y-auto px-2 py-2.5">
        <div className="space-y-[1px]">
          {PRIMARY.map((item) => {
            const lock = navLock(item.id)
            const busy = item.id === "chat" && runningTasks.length > 0
            return (
              <FlatLink
                key={item.id}
                {...item}
                href={busy ? aiTaskHref(runningTasks, item.href) : item.href}
                matchHref={item.href}
                collapsed={collapsed}
                pathname={pathname}
                locked={lock.locked}
                planBadge={lock.planBadge}
                trailing={
                  busy ? <AiTaskSpinner runs={runningTasks} collapsed={collapsed} /> : undefined
                }
                tooltipSuffix={
                  busy
                    ? runningTasks.length > 1
                      ? `${runningTasks.length} AI tasks running`
                      : describeBookRun(runningTasks[0]!)
                    : undefined
                }
              />
            )
          })}
        </div>

        <Divider />

        {/* Libraries */}
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
          {SIDEBAR_SECONDARY_NAV.map((item) => {
            const lock = navLock(item.id)
            return (
              <FlatLink
                key={item.id}
                {...item}
                collapsed={collapsed}
                pathname={pathname}
                locked={lock.locked}
                planBadge={lock.planBadge}
              />
            )
          })}
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
                "focus-visible:ring-2 focus-visible:ring-zinc-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B]",
                collapsed && "justify-center px-0",
              )}
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${DIVIDER}` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}
            >
              <div className="relative shrink-0">
                <UserIdentityAvatar
                  key={sessionUser.id}
                  name={sessionUser.name}
                  imageUrl={avatarSrc}
                  userId={sessionUser.id}
                  size="sm"
                  shape="circle"
                  tone="dark"
                />
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-zinc-800 bg-emerald-400"
                  aria-hidden
                />
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[12px] font-semibold leading-none" style={{ color: TEXT_ON }}>
                      {sessionUser.name}
                    </p>
                    <p className="mt-[3px] truncate text-[10px]" style={{ color: "rgba(255,255,255,0.32)" }}>
                      {sessionUser.email}
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
            className="sidebar-profile-menu w-56 rounded-xl border border-white/10 p-1 shadow-xl ring-1 ring-black/40 backdrop-blur-xl"
          >
            <DropdownMenuLabel className="flex items-center gap-2.5 px-2 pb-2 pt-1.5 font-normal">
              <UserIdentityAvatar
                key={sessionUser.id}
                name={sessionUser.name}
                imageUrl={avatarSrc}
                userId={sessionUser.id}
                size="sm"
                shape="circle"
                tone="dark"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">{sessionUser.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{sessionUser.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px]"
                onClick={() => router.push("/support")}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Support
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px]"
                onClick={() => router.push("/developer")}
              >
                <Code2 className="h-3.5 w-3.5" />
                Developer
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 rounded-lg text-[13px]"
                onClick={() => router.push("/account")}
              >
                <UserCog className="h-3.5 w-3.5" />
                Edit Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer gap-2 rounded-lg text-[13px]"
              disabled={logoutMutation.isPending}
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Version/update indicator + Collapse — share one row so version doesn't stretch the layout */}
        <div className="mt-1 flex items-center gap-1">
          {!collapsed && updateQuery.data ? (
            <Link
              href="/settings?tab=updates"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition-colors"
              style={{ color: "rgba(255,255,255,0.25)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = HOVER; e.currentTarget.style.color = "rgba(255,255,255,0.5)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.25)" }}
            >
              <span className="shrink-0 font-mono">v{updateQuery.data.currentVersion}</span>
              {updateQuery.data.updateAvailable ? (
                <span
                  className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    color: "var(--arciin-accent, #ff4f12)",
                    background: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 14%, transparent)",
                  }}
                >
                  <span className="size-1.5 rounded-full" style={{ background: "var(--arciin-accent, #ff4f12)" }} />
                  Update
                </span>
              ) : null}
            </Link>
          ) : (
            <div className="flex-1" />
          )}

          {/* Collapse button */}
          {!isMobile && (
            <button
              type="button"
              onClick={toggleSidebar}
              className={cn(
                "flex h-8 shrink-0 items-center rounded-lg px-2 text-[11px] transition-colors",
                collapsed ? "w-full justify-center" : "justify-end gap-1",
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
      </div>
    </>
  )
}

export function AppSidebar({ auth }: { auth: AuthSession }) {
  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <AppSidebarInner auth={auth} />
    </Sidebar>
  )
}
