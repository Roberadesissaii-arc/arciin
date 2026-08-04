"use client"

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  X,
} from "lucide-react"

import { VaultBrandMark } from "@/components/passwords/vault-brand-mark"
import { PANEL_TOP_BAR } from "@/components/passwords/password-vault-detail-placeholder"
import { Button } from "@/components/ui/button"
import { maskVaultPassword, vaultEntryHasPassword } from "@arciin/shared"
import type { PasswordVaultDisplaySettings, PasswordVaultEntry } from "@/lib/types/models"
import { resolveVaultBrand } from "@/lib/passwords/vault-brand"
import { cn } from "@/lib/utils"

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  )
}

export function PasswordVaultEntryDetail({
  entry,
  index,
  total,
  display,
  secretsVisible,
  passwordVisible,
  onClose,
  onPrevious,
  onNext,
  onRevealPassword,
  onCopyPassword,
  onCopyUsername,
  onEdit,
  onDelete,
  onOpenUrl,
}: {
  entry: PasswordVaultEntry
  index: number
  total: number
  display: PasswordVaultDisplaySettings
  secretsVisible: boolean
  passwordVisible: boolean
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onRevealPassword: () => void
  onCopyPassword: () => void
  onCopyUsername: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenUrl: () => void
}) {
  const hasPrev = index > 0
  const hasNext = index < total - 1
  const hasPwd = vaultEntryHasPassword(entry)
  const pwdShown = Boolean(secretsVisible && entry.password && passwordVisible)
  const brand = resolveVaultBrand(entry)

  const masked =
    hasPwd &&
    maskVaultPassword(
      entry.password?.length ?? entry.passwordLength ?? 8,
      display.maskStyle,
    )

  const urlDisplay = entry.url
    ? entry.url.replace(/^https?:\/\//i, "")
    : null

  return (
    <div
      className={cn(
        "relative flex min-h-[32rem] flex-col overflow-hidden rounded-2xl lg:min-h-full",
        "border border-border bg-card shadow-sm",
      )}
    >
      <div className={PANEL_TOP_BAR}>
        <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
          Entry {index + 1} of {total}
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg text-muted-foreground"
            disabled={!hasPrev}
            onClick={onPrevious}
            aria-label="Previous credential"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg text-muted-foreground"
            disabled={!hasNext}
            onClick={onNext}
            aria-label="Next credential"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg text-muted-foreground"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <div className="flex items-start gap-4">
            <VaultBrandMark entry={entry} size="lg" fallbackToVault />
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="truncate font-heading text-xl font-semibold tracking-tight text-foreground">
                {entry.name}
              </h3>
              {brand ? (
                <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{brand.label}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {display.showUsername ? (
              <FieldRow label="Username">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{entry.username ?? "—"}</span>
                  {entry.username && secretsVisible ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 text-[11px]"
                      onClick={onCopyUsername}
                    >
                      <Copy className="size-3" />
                      Copy
                    </Button>
                  ) : null}
                </div>
              </FieldRow>
            ) : null}

            {display.showPasswordColumn ? (
              <FieldRow label="Password">
                {hasPwd ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="max-w-full truncate rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-[12px] text-foreground">
                      {pwdShown && entry.password ? entry.password : masked}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="rounded-lg"
                      aria-label={pwdShown ? "Hide password" : "Show password"}
                      onClick={onRevealPassword}
                    >
                      {pwdShown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="rounded-lg"
                      aria-label="Copy password"
                      onClick={onCopyPassword}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </FieldRow>
            ) : null}

            {display.showUrl ? (
              <FieldRow label="Website">
                {entry.url && urlDisplay ? (
                  <button
                    type="button"
                    className="block w-full max-w-full truncate text-left font-mono text-[12px] text-primary hover:underline"
                    title={entry.url}
                    onClick={onOpenUrl}
                  >
                    {urlDisplay}
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </FieldRow>
            ) : null}

            {display.showNotes && entry.notes ? (
              <FieldRow label="Notes">
                <p className="line-clamp-2 text-muted-foreground" title={entry.notes}>
                  {entry.notes}
                </p>
              </FieldRow>
            ) : null}

            {display.showCategory && entry.category ? (
              <FieldRow label="Category">
                <span className="truncate">{entry.category}</span>
              </FieldRow>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-border px-5 py-4 sm:px-8">
          <Button
            type="button"
            variant="outline"
            className="h-10 gap-1.5 px-4 text-[13px] font-semibold"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          {entry.url ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-1.5 px-4 text-[13px] font-semibold"
              onClick={onOpenUrl}
            >
              <ExternalLink className="size-3.5" />
              Open website
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-10 gap-1.5 px-4 text-[13px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <p className="truncate border-t border-border px-5 py-2.5 text-center text-[11px] tabular-nums text-muted-foreground">
        {entry.name}
        {entry.username ? ` · ${entry.username}` : ""}
      </p>
    </div>
  )
}
