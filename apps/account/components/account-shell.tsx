"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"

import { BrandLockupNav } from "@/components/brand"
import { ProfileMenu, type ProfileSummary } from "@/components/profile-menu"
import { cn } from "@/components/ui"

/**
 * arciin-web style floating dark bar.
 * Profile is a solid light dropdown (no glass) with customer + license snapshot.
 */
const NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/account", label: "Overview", exact: true },
  { href: "/account/licenses", label: "Licenses" },
  { href: "/account/servers", label: "Servers" },
  { href: "/account/downloads", label: "Downloads" },
]

export function AccountShell({
  children,
  profile,
}: {
  children: ReactNode
  profile: ProfileSummary
}) {
  const pathname = usePathname() || "/account"
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuOpenForPathname, setMenuOpenForPathname] = useState(pathname)
  if (pathname !== menuOpenForPathname) {
    setMenuOpenForPathname(pathname)
    setMenuOpen(false)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      <header className="sticky top-0 z-50 overflow-visible px-4 pt-3 sm:px-6 lg:px-8">
        <div className="account-top-nav relative z-50 mx-auto flex min-h-[52px] max-w-[1120px] items-center gap-3 rounded-2xl border border-white/15 bg-[rgba(9,9,11,0.92)] px-3.5 py-2 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-4">
          <Link href="/account" className="flex min-w-0 shrink-0 items-center">
            <BrandLockupNav markHeight={20} />
          </Link>

          <nav
            className="hidden flex-1 items-center justify-center gap-1 md:flex"
            aria-label="Account"
          >
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-active={active ? "true" : "false"}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-white/20 font-semibold" : "hover:bg-white/10",
                  )}
                  style={{ color: "#ffffff" }}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ProfileMenu summary={profile} />

            <button
              type="button"
              className="-m-1 p-2 transition-colors md:hidden"
              style={{ color: "#f4f4f5" }}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="account-top-nav relative z-40 mx-auto mt-2 max-w-[1120px] overflow-hidden rounded-2xl border border-white/15 bg-[rgba(9,9,11,0.97)] p-2 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {NAV.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={active ? "true" : "false"}
                    className={cn(
                      "rounded-xl px-3.5 py-3 text-[15px] font-medium transition-colors hover:bg-white/10",
                      active && "bg-white/15 font-semibold",
                    )}
                    style={{ color: "#ffffff" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        ) : null}
      </header>

      <main className="page-shell flex-1 space-y-6 py-8 sm:py-10">{children}</main>

      <footer className="mt-auto border-t border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="page-shell flex flex-col items-center justify-between gap-2 py-6 text-center sm:flex-row sm:text-left">
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-display font-semibold text-[var(--text)]">
              Arciin<span className="text-[var(--accent)]">.</span>
            </span>{" "}
            Your server. Your control.
          </p>
          <p className="text-[12px] text-[var(--text-faint)]">
            Account portal prototype · no billing · separate from self-hosted app
          </p>
        </div>
      </footer>
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 5h16M4 12h16M4 19h16" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  )
}
