"use client"

import { vaultEntryHasPassword } from "@arciin/shared"
import { Eye, EyeOff } from "lucide-react"
import { useEffect, useState } from "react"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PasswordVaultEntry } from "@/lib/types/models"
export type VaultEntryDraft = {
  name: string
  username: string
  url: string
  notes: string
  category: string
  /** Set only when the user changed the password field. */
  password?: string
}

type DraftFields = Omit<VaultEntryDraft, "password"> & { password: string }

export function VaultEntryEditDialog({
  entry,
  open,
  revealedPassword,
  onOpenChange,
  onRequestPasswordReveal,
  onClearRevealedPassword,
  busy,
  onSave,
}: {
  entry: PasswordVaultEntry | null
  open: boolean
  /** Plaintext after vault PIN/password verification — never prefilled on open. */
  revealedPassword: string | null
  onOpenChange: (open: boolean) => void
  onRequestPasswordReveal: () => void
  onClearRevealedPassword: () => void
  busy?: boolean
  onSave: (id: string, draft: VaultEntryDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<DraftFields>({
    name: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    category: "",
  })
  const [passwordEdited, setPasswordEdited] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const hasStoredPassword = entry ? vaultEntryHasPassword(entry) : false
  const canViewSavedPassword = Boolean(revealedPassword) && !passwordEdited

  useEffect(() => {
    if (!open || !entry) return

    setDraft({
      name: entry.name,
      username: entry.username ?? "",
      password: "",
      url: entry.url ?? "",
      notes: entry.notes ?? "",
      category: entry.category ?? "",
    })
    setPasswordEdited(false)
    setShowPassword(false)
  }, [open, entry])

  useEffect(() => {
    if (!open) return
    setShowPassword(Boolean(revealedPassword))
  }, [open, revealedPassword])

  const passwordInputValue = passwordEdited
    ? draft.password
    : showPassword && revealedPassword
      ? revealedPassword
      : ""

  const handleEyeClick = () => {
    if (passwordEdited) {
      setShowPassword((v) => !v)
      return
    }

    if (revealedPassword) {
      if (showPassword) {
        setShowPassword(false)
        onClearRevealedPassword()
      } else {
        setShowPassword(true)
      }
      return
    }

    if (hasStoredPassword) {
      onRequestPasswordReveal()
      return
    }

    setShowPassword((v) => !v)
  }

  const submit = async () => {
    if (!entry || !draft.name.trim()) return

    const payload: VaultEntryDraft = {
      name: draft.name,
      username: draft.username,
      url: draft.url,
      notes: draft.notes,
      category: draft.category,
    }

    if (passwordEdited) {
      payload.password = draft.password
    }

    await onSave(entry.id, payload)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit credential</AlertDialogTitle>
          <AlertDialogDescription>
            Name, username, URL, notes, and category are pre-filled. The saved password stays hidden
            until you verify with the eye icon.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-name">Name</Label>
            <Input
              id="vault-edit-name"
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-username">Username</Label>
            <Input
              id="vault-edit-username"
              value={draft.username}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-password">Password</Label>
            <div className="relative">
              <Input
                id="vault-edit-password"
                type={showPassword || passwordEdited ? "text" : "password"}
                autoComplete="off"
                value={passwordInputValue}
                disabled={busy}
                placeholder={
                  hasStoredPassword
                    ? canViewSavedPassword
                      ? "Tap the eye to show the saved password"
                      : `Saved password — use the eye to verify (${entry?.passwordLength ?? "?"} chars)`
                    : "Optional"
                }
                className="pr-10"
                onChange={(e) => {
                  setPasswordEdited(true)
                  setShowPassword(true)
                  setDraft((d) => ({ ...d, password: e.target.value }))
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 size-9 shrink-0 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                disabled={busy}
                aria-label={
                  showPassword && (passwordEdited || revealedPassword)
                    ? "Hide password"
                    : "Verify and show password"
                }
                onClick={handleEyeClick}
              >
                {showPassword && (passwordEdited || revealedPassword) ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {hasStoredPassword
                ? "Saved password is never shown automatically. Use the eye icon and enter your vault PIN or account password to view it."
                : "Leave empty if this entry has no password."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-url">URL</Label>
            <Input
              id="vault-edit-url"
              value={draft.url}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-notes">Notes</Label>
            <Input
              id="vault-edit-notes"
              value={draft.notes}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-edit-category">Category</Label>
            <Input
              id="vault-edit-category"
              value={draft.category}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !draft.name.trim()} onClick={() => void submit()}>
            Save
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
