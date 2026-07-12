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

  return (
    <div
      className={cn(
        "relative flex min-h-[min(420px,70vh)] flex-col overflow-hidden rounded-2xl",
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
              <h3 className="font-heading text-xl font-semibold tracking-tight text-foreground">
                {entry.name}
              </h3>
              {brand ? (
                <p className="mt-1 text-xs font-medium text-muted-foreground">{brand.label}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {display.showUsername ? (
              <FieldRow label="Username">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.username ?? "—"}</span>
                  {entry.username && secretsVisible ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-[11px]"
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
                    <code className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-[12px] text-foreground">
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
                {entry.url ? (
                  <button
                    type="button"
                    className="break-all text-left font-mono text-[12px] text-primary hover:underline"
                    onClick={onOpenUrl}
                  >
                    {entry.url}
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </FieldRow>
            ) : null}

            {display.showNotes && entry.notes ? (
              <FieldRow label="Notes">
                <p className="whitespace-pre-wrap text-muted-foreground">{entry.notes}</p>
              </FieldRow>
            ) : null}

            {display.showCategory && entry.category ? (
              <FieldRow label="Category">
                <span>{entry.category}</span>
              </FieldRow>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            {entry.url ? (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onOpenUrl}>
                <ExternalLink className="size-3.5" />
                Open site
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <p className="border-t border-border px-5 py-2.5 text-center text-[11px] tabular-nums text-muted-foreground">
        {entry.name}
        {entry.username ? ` · ${entry.username}` : ""}
      </p>
    </div>
  )
}
