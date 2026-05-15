"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Save,
  ShieldCheck,
  Smartphone,
  Tablet,
  User,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { SectionHeader } from "@/components/settings/settings-panel-primitives"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { changePassword, getSessions, logout, revokeSession, updateProfile } from "@/lib/api/auth"
import { useAuth } from "@/hooks/use-auth"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { formatRelativeDate, formatDateTime } from "@/lib/utils/format-date"
import type { SessionDetail, UserRole } from "@/lib/types/models"

type Tab = "identity" | "password" | "sessions" | "danger"

const NAV_GROUPS: {
  label: string
  items: { id: Tab; label: string; Icon: typeof User; danger?: boolean }[]
}[] = [
  {
    label: "Account",
    items: [
      { id: "identity", label: "Identity", Icon: User },
      { id: "password", label: "Password", Icon: KeyRound },
    ],
  },
  {
    label: "Access",
    items: [{ id: "sessions", label: "Sessions", Icon: Monitor }],
  },
  {
    label: "Danger zone",
    items: [{ id: "danger", label: "Sign out", Icon: AlertTriangle, danger: true }],
  },
]

function parseUA(ua: string | null) {
  if (!ua) return { label: "Unknown device", DeviceIcon: Laptop as typeof Laptop }
  const l = ua.toLowerCase()
  const isTablet = /ipad|tablet/.test(l)
  const isMobile = /mobile|android|iphone/.test(l) && !isTablet
  const DeviceIcon = isTablet ? Tablet : isMobile ? Smartphone : Laptop

  let browser = "Unknown"
  if (/edg\/|edghtml/.test(l)) browser = "Edge"
  else if (/opr\/|opera/.test(l)) browser = "Opera"
  else if (/firefox|fxios/.test(l)) browser = "Firefox"
  else if (/chrome|crios/.test(l)) browser = "Chrome"
  else if (/safari/.test(l)) browser = "Safari"

  let os = "Unknown"
  if (/iphone/.test(l)) os = "iOS"
  else if (/ipad/.test(l)) os = "iPadOS"
  else if (/android/.test(l)) os = "Android"
  else if (/mac os x|macos/.test(l)) os = "macOS"
  else if (/windows/.test(l)) os = "Windows"
  else if (/linux/.test(l)) os = "Linux"

  return { label: `${browser} on ${os}`, DeviceIcon }
}

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    OWNER:
      "border-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_35%,transparent)] bg-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_12%,white)] text-zinc-900",
    ADMIN: "border-amber-200 bg-amber-50 text-amber-900",
    MEMBER: "border-sky-200 bg-sky-50 text-sky-900",
    VIEWER: "border-zinc-200 bg-zinc-50 text-zinc-600",
  }
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold uppercase tracking-wide", styles[role])}>
      {role}
    </Badge>
  )
}

function IdentityPanel() {
  const queryClient = useQueryClient()
  const meQuery = useAuth()
  const user = meQuery.data?.user

  // React "adjusting state during render" pattern — avoids setState-in-effect.
  // We store the last seeded userId in state; when it differs from the current user,
  // we update all three pieces of state in the same render pass.
  const [seededForId, setSeededForId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  if (user && seededForId !== user.id) {
    setSeededForId(user.id)
    setName(user.name)
    setEmail(user.email)
  }

  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.authMe, data)
      toast.success("Profile updated.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not update profile."),
  })

  const dirty =
    user && (name.trim() !== user.name || email.trim().toLowerCase() !== user.email.toLowerCase())
  const letter = (user?.name || "?")[0]?.toUpperCase() ?? "?"

  if (meQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={User}
        title="Identity"
        description="Your display name and email on this Arciin instance."
      />

      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground shadow-sm"
          aria-hidden
        >
          {letter}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-foreground">{user?.name}</p>
            {user?.role && <RoleBadge role={user.role as UserRole} />}
            {user?.status === "ACTIVE" ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                <ShieldCheck className="size-3" />
                Active
              </Badge>
            ) : (
              <Badge variant="destructive">Disabled</Badge>
            )}
          </div>
          <p className="text-[13px] text-zinc-600">{user?.email}</p>
          {user?.createdAt && (
            <p className="text-[12px] text-zinc-500">
              Member since{" "}
              {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <Card className="border-border bg-zinc-50/50 shadow-none">
        <CardHeader className="pb-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">Edit profile</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-name" className="text-zinc-700">
              Display name
            </Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your name"
              className="border-border bg-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-email" className="text-zinc-700">
              Email address
            </Label>
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="border-border bg-white"
            />
          </div>
          {dirty && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                disabled={mutation.isPending || !name.trim() || !email.trim()}
                onClick={() => mutation.mutateAsync({ name: name.trim(), email: email.trim().toLowerCase() })}
              >
                <Save className="size-4" />
                {mutation.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-border"
                onClick={() => {
                  if (user) {
                    setName(user.name)
                    setEmail(user.email)
                  }
                }}
              >
                Discard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) return null
  const score =
    (password.length >= 8 ? 1 : 0) +
    (password.length >= 12 ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0)

  const { label, color } =
    score <= 1
      ? { label: "Weak", color: "bg-red-500" }
      : score <= 3
        ? { label: "Fair", color: "bg-amber-500" }
        : score <= 4
          ? { label: "Good", color: "bg-sky-500" }
          : { label: "Strong", color: "bg-emerald-500" }

  return (
    <div className="mt-2 space-y-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <p className="text-[11px] font-medium text-zinc-600">{label}</p>
    </div>
  )
}

function PasswordPanel() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showNext, setShowNext] = useState(false)

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success("Password updated.")
      setCurrent("")
      setNext("")
      setConfirm("")
    },
    onError: (e: Error) => toast.error(e.message || "Could not change password."),
  })

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < 8
  const matches = next.length >= 8 && next === confirm && confirm.length > 0
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !mutation.isPending

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={KeyRound}
        title="Password"
        description="Use a strong password you do not reuse elsewhere. Minimum 8 characters."
      />

      <Card className="border-border shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              className="border-border bg-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNext ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                className="border-border bg-white pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Hide password" : "Show password"}
              >
                {showNext ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {tooShort && <p className="text-[11px] text-amber-700">Minimum 8 characters.</p>}
            <PasswordStrengthBar password={next} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Repeat new password"
              className="border-border bg-white"
            />
            {mismatch && <p className="text-[11px] text-red-600">Passwords do not match.</p>}
            {matches && (
              <p className="flex items-center gap-1 text-[11px] text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                Passwords match
              </p>
            )}
          </div>
          <Button disabled={!canSubmit} onClick={() => mutation.mutateAsync({ currentPassword: current, newPassword: next })}>
            <KeyRound className="size-4" />
            {mutation.isPending ? "Updating…" : "Update password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function SessionItem({
  session,
  onRevoke,
  revoking,
}: {
  session: SessionDetail
  onRevoke: (id: string) => void
  revoking: boolean
}) {
  const { label, DeviceIcon } = parseUA(session.userAgent)
  const oneDayMs = 24 * 60 * 60 * 1000
  const expiringSoon = new Date(session.expiresAt) < new Date(new Date().getTime() + oneDayMs)

  return (
    <div className="flex items-center gap-3 border-b border-border py-3.5 last:border-0">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl border",
          session.isCurrent
            ? "border-primary/25 bg-primary/10 text-primary"
            : "border-zinc-200 bg-zinc-50 text-zinc-500",
        )}
      >
        <DeviceIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          {session.isCurrent && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <ShieldCheck className="size-3" />
              This device
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
          {session.ipAddress && <span className="font-mono">{session.ipAddress}</span>}
          <span title={formatDateTime(session.createdAt)}>Started {formatRelativeDate(session.createdAt)}</span>
          <span
            className={cn(expiringSoon && "font-medium text-amber-700")}
            title={formatDateTime(session.expiresAt)}
          >
            Expires {formatRelativeDate(session.expiresAt)}
          </span>
        </div>
      </div>
      {!session.isCurrent && (
        <Button
          variant="outline"
          size="sm"
          disabled={revoking}
          className="shrink-0 border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => onRevoke(session.id)}
        >
          {revoking ? "…" : "Revoke"}
        </Button>
      )}
    </div>
  )
}

function SessionsPanel() {
  const queryClient = useQueryClient()
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: ({ signal }) => getSessions(signal),
  })
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const revokeMutation = useMutation({
    mutationFn: revokeSession,
    onMutate: (id) => setRevokingId(id),
    onSettled: () => setRevokingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    onError: (e: Error) => toast.error(e.message || "Could not revoke session."),
  })

  const rows = sessionsQuery.data ?? []
  const current = rows.find((s) => s.isCurrent)
  const others = rows.filter((s) => !s.isCurrent)

  const revokeAll = async () => {
    setRevokingAll(true)
    try {
      await Promise.all(others.map((s) => revokeMutation.mutateAsync(s.id)))
      toast.success(`${others.length} session${others.length === 1 ? "" : "s"} revoked.`)
    } catch {
      toast.error("Could not revoke all sessions.")
    } finally {
      setRevokingAll(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <SectionHeader
          icon={Monitor}
          title="Sessions"
          description="Every device signed in to your account. Revoke anything you do not recognise."
        />
        {rows.length > 0 && (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {rows.length}
          </Badge>
        )}
      </div>

      {sessionsQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-zinc-50/80 py-12">
          <Monitor className="size-8 text-zinc-300" />
          <p className="text-[13px] font-medium text-zinc-600">No active sessions</p>
        </div>
      ) : (
        <Card className="border-border px-4 shadow-none">
          <CardContent className="p-0 pt-2">
            {current && (
              <SessionItem
                key={current.id}
                session={current}
                onRevoke={(id) => revokeMutation.mutateAsync(id)}
                revoking={revokingId === current.id}
              />
            )}
            {others.length > 0 && (
              <>
                <p className="border-b border-border px-1 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Other sessions
                </p>
                {others.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    onRevoke={(id) => revokeMutation.mutateAsync(id)}
                    revoking={revokingId === s.id}
                  />
                ))}
                <Button
                  variant="outline"
                  disabled={revokingAll}
                  className="mt-4 w-full border-red-200 text-red-700 hover:bg-red-50"
                  onClick={revokeAll}
                >
                  <LogOut className="size-4" />
                  {revokingAll ? "Revoking…" : `Revoke all other sessions (${others.length})`}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DangerPanel() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: ({ signal }) => getSessions(signal),
  })
  const [confirmText, setConfirmText] = useState("")
  const [signingOut, setSigningOut] = useState(false)

  const sessionCount = sessionsQuery.data?.length ?? 0

  const revokeAll = async () => {
    if (confirmText !== "sign out all") return
    setSigningOut(true)
    try {
      await logout()
      queryClient.clear()
      router.push("/login")
    } catch {
      toast.error("Could not sign out all devices.")
      setSigningOut(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={AlertTriangle}
        title="Danger zone"
        description="Irreversible actions that sign you out everywhere."
      />

      <Card className="border-red-200/80 bg-red-50/40 shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-100 text-red-700">
              <LogOut className="size-4" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-foreground">Sign out everywhere</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-600">
                Immediately invalidates every active session including this one. You will be redirected to login.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-[12px] text-zinc-600">
            <Monitor className="size-4 shrink-0 text-zinc-400" />
            {sessionsQuery.isLoading
              ? "Loading session count…"
              : `${sessionCount} active session${sessionCount === 1 ? "" : "s"} will be revoked`}
          </div>

          <div className="space-y-2">
            <Label htmlFor="danger-confirm">
              Type <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px]">sign out all</code> to
              confirm
            </Label>
            <Input
              id="danger-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="sign out all"
              autoComplete="off"
              className="border-border bg-white"
            />
          </div>

          <Button
            variant="destructive"
            disabled={confirmText !== "sign out all" || signingOut}
            onClick={revokeAll}
          >
            <AlertTriangle className="size-4" />
            {signingOut ? "Signing out…" : "Sign out all devices"}
          </Button>
          <p className="text-[11px] text-zinc-500">You will need to sign back in with your email and password.</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function AccountPage() {
  const [tab, setTab] = useState<Tab>("identity")
  const meQuery = useAuth()
  const user = meQuery.data?.user
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: ({ signal }) => getSessions(signal),
    staleTime: 30_000,
  })

  const sessionCount = sessionsQuery.data?.length ?? 0

  const panels: Record<Tab, React.ReactNode> = {
    identity: <IdentityPanel />,
    password: <PasswordPanel />,
    sessions: <SessionsPanel />,
    danger: <DangerPanel />,
  }

  return (
    <div className="space-y-6 pb-8">
      <DashboardPageIntro
        title="Account"
        subtitle="Profile · security · sessions"
        description="Manage your identity on this instance, update your password, review signed-in devices, and sign out everywhere if needed."
        stats={[
          { label: "Signed in as", value: user?.name ?? "—" },
          { label: "Role", value: user?.role ?? "—" },
          { label: "Email", value: user?.email ?? "—" },
          { label: "Sessions", value: sessionsQuery.isLoading ? "…" : String(sessionCount) },
        ]}
      />

      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <div className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:sticky sm:top-4 sm:w-60 sm:self-start">
          <nav className="flex gap-1 overflow-x-auto px-2.5 py-2.5 scrollbar-hide sm:block sm:space-y-3 sm:overflow-visible sm:px-2.5 sm:py-3.5">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="sm:space-y-0.5">
                <p className="hidden px-3 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:block">
                  {group.label}
                </p>
                <div className="flex gap-1 sm:flex-col sm:gap-0.5">
                  {group.items.map(({ id, label, Icon, danger }) => {
                    const active = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={cn(
                          "shrink-0 whitespace-nowrap rounded-xl border px-3 py-2.5 text-left text-[12px] font-medium transition-colors sm:w-full",
                          active && !danger && "settings-nav-active",
                          active && danger &&
                            "border-red-200/80 bg-red-50 text-red-800",
                          !active &&
                            (danger
                              ? "border-transparent text-red-600/80 hover:bg-red-50 hover:text-red-800"
                              : "border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"),
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="size-4 shrink-0 opacity-90" />
                          {label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-border bg-card px-4 py-5 shadow-sm sm:px-7 sm:py-6">
          {panels[tab]}
        </div>
      </div>
    </div>
  )
}
