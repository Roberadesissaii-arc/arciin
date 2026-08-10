"use client"

import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"

type PasswordVaultCredentialsSectionProps = {
  pinConfigured: boolean
  lockRequired: boolean
  secretsVisible: boolean
  actions?: React.ReactNode
  search: string
  onSearchChange: (value: string) => void
  resultCount: number
  totalCount: number
}

export function PasswordVaultCredentialsSection({
  pinConfigured,
  lockRequired,
  secretsVisible,
  actions,
  search,
  onSearchChange,
  resultCount,
  totalCount,
}: PasswordVaultCredentialsSectionProps) {
  const description =
    lockRequired && !secretsVisible
      ? "Passwords stay hidden until you unlock the vault or use the eye icon on a row. After you reveal a password, copy works without asking again."
      : pinConfigured
        ? "Your vault is encrypted on disk. Use the eye icon on each row to show or hide that password."
        : "Select a row to preview the credential on the right. Copy, edit, or open the site from the detail panel."

  return (
    <section>
      <h3 className="font-heading text-base font-semibold tracking-tight text-foreground">
        Saved credentials
      </h3>
      {/* The explanation belongs with the heading, not squeezed onto the
          toolbar row where it was truncated mid-sentence. */}
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>

      {/* One full-width toolbar: search grows, actions sit at the end. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            // Not type="search": Chrome adds its own clear ✕ on top of ours.
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by site, username, or category"
            aria-label="Search saved credentials"
            className="h-10 border-border bg-muted/30 pl-9 pr-9 text-sm"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <p
          className="shrink-0 text-[12px] tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {search
            ? resultCount === 0
              ? "No matches"
              : `${resultCount} of ${totalCount} ${totalCount === 1 ? "entry" : "entries"}`
            : `${totalCount} ${totalCount === 1 ? "entry" : "entries"}`}
        </p>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  )
}
