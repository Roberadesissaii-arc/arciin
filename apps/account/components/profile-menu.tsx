"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import {
  ChevronDown,
  Download,
  KeyRound,
  Server,
  Shield,
  CircleDot,
} from "lucide-react"

import { cn } from "@/components/ui"

export type ProfileSummary = {
  name: string
  email: string
  plan: string
  licenseCount: number
  activeLicenses: number
  activatedServers: number
  nextRenewalAt: string | null
  serverOk: boolean
}

function planLabel(plan: string) {
  if (!plan || plan === "none") return "No plan"
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function formatDateShort(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return "—"
  }
}

/**
 * Solid light profile dropdown (no glass). Opens/closes reliably with click outside.
 */
export function ProfileMenu({ summary }: { summary: ProfileSummary }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const initial = summary.name.trim().charAt(0).toUpperCase() || "A"

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }

    // Defer attach so the opening click doesn't immediately close the menu
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true)
      document.addEventListener("keydown", onKey)
    }, 0)

    return () => {
      window.clearTimeout(t)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/30 bg-white/10 pl-1 pr-2.5 text-sm font-semibold text-white transition-colors hover:border-white/45 hover:bg-white/15"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span
          className="relative flex size-7 items-center justify-center rounded-full text-[12px] font-bold text-white"
          style={{ background: "#ff4f12" }}
        >
          {initial}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[rgba(9,9,11,0.95)]",
              summary.serverOk ? "bg-emerald-400" : "bg-amber-400",
            )}
            aria-hidden
          />
        </span>
        <span className="hidden max-w-[7rem] truncate sm:inline">
          {summary.name.split(" ")[0]}
        </span>
        <ChevronDown
          className={cn("size-3.5 text-white/80 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-[100] mt-2 w-[min(calc(100vw-2rem),18rem)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_-12px_rgba(17,17,17,0.28)]"
        >
          {/* Identity */}
          <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: "#ff4f12" }}
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-[var(--text)]">
                  {summary.name}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                  {summary.email}
                </p>
                <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                  Demo account · billing not connected
                </p>
              </div>
            </div>
          </div>

          {/* License snapshot */}
          <div className="space-y-2.5 border-b border-[var(--border)] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              License snapshot
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  Plan
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-[var(--text)]">
                  {planLabel(summary.plan)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  Licenses
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-[var(--text)]">
                  {summary.activeLicenses}
                  <span className="font-normal text-[var(--text-muted)]">
                    {" "}
                    / {summary.licenseCount}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  Servers
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-[var(--text)]">
                  {summary.activatedServers}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  Renewal
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-[var(--text)]">
                  {formatDateShort(summary.nextRenewalAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2">
              <CircleDot
                className={cn(
                  "size-3.5 shrink-0",
                  summary.serverOk ? "text-emerald-600" : "text-amber-600",
                )}
              />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--text)]">
                  License API {summary.serverOk ? "online" : "offline"}
                </p>
                {!summary.serverOk ? (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Start with <code className="font-mono">pnpm license-server</code>
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Keys and activations sync from the license server
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-1.5">
            <Link
              href="/account"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <Shield className="size-3.5 text-[var(--accent)]" />
              Account overview
            </Link>
            <Link
              href="/account/licenses"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <KeyRound className="size-3.5 text-[var(--accent)]" />
              My licenses
            </Link>
            <Link
              href="/account/servers"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <Server className="size-3.5 text-[var(--accent)]" />
              Activated servers
            </Link>
            <Link
              href="/account/downloads"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <Download className="size-3.5 text-[var(--accent)]" />
              Downloads & install
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
