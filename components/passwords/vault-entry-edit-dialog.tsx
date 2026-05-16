"use client"

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
  password: string
  url: string
  notes: string
  category: string
}

export function VaultEntryEditDialog({
  entry,
  open,
  onOpenChange,
  busy,
  onSave,
}: {
  entry: PasswordVaultEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onSave: (id: string, draft: VaultEntryDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<VaultEntryDraft>({
    name: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    category: "",
  })

  useEffect(() => {
    if (!entry || !open) return
    setDraft({
      name: entry.name,
      username: entry.username ?? "",
      password: entry.password ?? "",
      url: entry.url ?? "",
      notes: entry.notes ?? "",
      category: entry.category ?? "",
    })
  }, [entry, open])

  const submit = async () => {
    if (!entry || !draft.name.trim()) return
    await onSave(entry.id, draft)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit credential</AlertDialogTitle>
          <AlertDialogDescription>Update fields for this vault entry.</AlertDialogDescription>
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
            <Input
              id="vault-edit-password"
              type="password"
              autoComplete="off"
              value={draft.password}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
            />
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
