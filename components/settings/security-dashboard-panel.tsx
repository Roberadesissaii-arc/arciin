"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, ChevronLeft, ChevronRight, Globe, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { getSecuritySettings, updateSecuritySettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

const TABS = ["Security log", "Blocked IPs", "Allowed IPs"] as const
type TabId = (typeof TABS)[number]

export function SecurityDashboardPanel() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabId>("Security log")
  const [newBlocked, setNewBlocked] = useState("")
  const [newAllowed, setNewAllowed] = useState("")

  const query = useQuery({
    queryKey: queryKeys.securitySettings,
    queryFn: ({ signal }) => getSecuritySettings(signal),
  })

  const mutation = useMutation({
    mutationFn: updateSecuritySettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save.")
    },
  })

  const d = query.data
  const blocked = d?.ipBlocklist ?? []
  const allowed = d?.ipAllowlist ?? []
  const enforce = Boolean(d?.enforceIpAllowlist)
  const tabIdx = TABS.indexOf(tab)

  const patch = useCallback(
    async (body: Parameters<typeof updateSecuritySettings>[0], message?: string) => {
      try {
        await mutation.mutateAsync(body)
        if (message) toast.success(message)
      } catch {
        /* onError */
      }
    },
    [mutation],
  )

  const addBlocked = () => {
    const ip = newBlocked.trim()
    if (!ip || blocked.includes(ip)) return
    setNewBlocked("")
    void patch({ ipBlocklist: [...blocked, ip] }, `${ip} blocked`)
  }

  const removeBlocked = (ip: string) => {
    void patch({ ipBlocklist: blocked.filter((x) => x !== ip) }, `${ip} removed from blocklist`)
  }

  const addAllowed = () => {
    const ip = newAllowed.trim()
    if (!ip || allowed.includes(ip)) return
    setNewAllowed("")
    void patch({ ipAllowlist: [...allowed, ip] }, `${ip} allowlisted`)
  }

  const removeAllowed = (ip: string) => {
    void patch({ ipAllowlist: allowed.filter((x) => x !== ip) }, `${ip} removed from allowlist`)
  }

  const setEnforce = (next: boolean) => {
    void patch(
      { enforceIpAllowlist: next },
      next ? "Allowlist enforcement enabled" : "Allowlist enforcement disabled",
    )
  }

  return (
    <div className="space-y-5">
      {/* Header row — Arceclaw-style badges, Arciin colors */}
      <div className="flex flex-wrap items-center justify-between gap-3 pl-0.5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Perimeter</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Live IP lists and policy. Enforcement runs at your edge.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {blocked.length > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
              style={{
                background: "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.22)",
              }}
            >
              <Ban className="size-3.5 text-red-500" />
              <span className="text-[11px] font-semibold text-red-600">{blocked.length} blocked</span>
            </div>
          )}
          <div
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
            style={{
              background: "rgba(34,197,94,0.08)",
              borderColor: "rgba(34,197,94,0.22)",
            }}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="text-[11px] font-semibold text-emerald-700">Policy active</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const active = t === tab
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "border border-primary/30 bg-primary/[0.10] text-zinc-900"
                  : "border border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t}
              {t === "Blocked IPs" && blocked.length > 0 && (
                <span className="ml-1.5 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                  {blocked.length}
                </span>
              )}
              {t === "Allowed IPs" && allowed.length > 0 && (
                <span className="ml-1.5 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  {allowed.length}
                </span>
              )}
            </button>
          )
        })}
        <div className="hidden flex-1 sm:block" />
        <div className="ml-auto hidden gap-1 sm:flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 border-border"
            disabled={tabIdx <= 0}
            onClick={() => setTab(TABS[tabIdx - 1]!)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 border-border"
            disabled={tabIdx >= TABS.length - 1}
            onClick={() => setTab(TABS[tabIdx + 1]!)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Security log */}
      {tab === "Security log" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Security log</span>
            <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Coming soon
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] border-b border-border bg-muted/20 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 sm:grid-cols-[100px_120px_1fr_88px]">
            <span className="hidden sm:inline">Time</span>
            <span className="hidden sm:inline">IP</span>
            <span className="hidden sm:inline">Event</span>
            <span className="hidden sm:inline">Status</span>
          </div>
          <Empty className="rounded-none border-0 py-12">
            <EmptyMedia variant="icon">
              <ShieldCheck />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No security events yet</EmptyTitle>
              <EmptyDescription>
                Auth denials, IP policy hits, and API blocks will show here when the feed is wired. Until then, use{" "}
                <Link href="/activity" className="font-medium text-primary underline-offset-4 hover:underline">
                  Activity
                </Link>{" "}
                for recent instance actions.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}

      {/* Blocked IPs */}
      {tab === "Blocked IPs" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-red-500/15 bg-red-500/[0.06] px-5 py-4">
            <Ban className="size-4 text-red-500" />
            <span className="text-sm font-semibold text-foreground">Blocked IPs</span>
            <span className="ml-auto rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-600">
              {blocked.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {blocked.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No blocked IPs. Add addresses below; they sync to this instance immediately.
              </p>
            ) : (
              blocked.map((ip) => (
                <div
                  key={ip}
                  className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <Globe className="size-3.5 shrink-0 text-red-500/70" />
                  <span className="flex-1 font-mono text-[13px] text-foreground">{ip}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-red-500/70 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                    disabled={mutation.isPending}
                    onClick={() => removeBlocked(ip)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-3">
            <Input
              value={newBlocked}
              onChange={(e) => setNewBlocked(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addBlocked()}
              placeholder="Add IP or CIDR to block…"
              className="flex-1 font-mono text-[13px]"
              disabled={query.isLoading}
            />
            <Button
              type="button"
              size="icon"
              className="shrink-0 bg-red-500/15 text-red-600 hover:bg-red-500/25"
              disabled={mutation.isPending || query.isLoading}
              onClick={addBlocked}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Allowed IPs */}
      {tab === "Allowed IPs" && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/[0.06] px-5 py-4">
              <ShieldCheck className="size-4 text-emerald-600" />
              <span className="text-sm font-semibold text-foreground">Allowlisted IPs</span>
              <span className="ml-auto rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                {allowed.length}
              </span>
            </div>
            <div className="divide-y divide-border">
              {allowed.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Empty allowlist means “no explicit allow entries” — pair with your reverse proxy. Add IPs you trust
                  here.
                </p>
              ) : (
                allowed.map((ip) => (
                  <div
                    key={ip}
                    className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
                  >
                    <Globe className="size-3.5 shrink-0 text-emerald-600/70" />
                    <span className="flex-1 font-mono text-[13px] text-foreground">{ip}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-500/70 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                      disabled={mutation.isPending}
                      onClick={() => removeAllowed(ip)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-3">
              <Input
                value={newAllowed}
                onChange={(e) => setNewAllowed(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAllowed()}
                placeholder="Add IP or CIDR to allow…"
                className="flex-1 font-mono text-[13px]"
                disabled={query.isLoading}
              />
              <Button
                type="button"
                size="icon"
                className="shrink-0 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25"
                disabled={mutation.isPending || query.isLoading}
                onClick={addAllowed}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/25 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enforce allowlist for HTTP API</p>
              <p className="text-xs text-muted-foreground">Store intent here; honor at your gateway when ready.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enforce}
              disabled={mutation.isPending || query.isLoading}
              onClick={() => setEnforce(!enforce)}
              className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
              style={{ background: enforce ? "#FF4F12" : "#d4d4d8" }}
            >
              <span
                className="pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: enforce ? "translateX(22px)" : "translateX(4px)" }}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
