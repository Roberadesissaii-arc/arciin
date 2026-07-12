"use client"

import { VaultUnlockDialog, type VaultUnlockMode } from "@/components/passwords/vault-unlock-dialog"

export function FolderAccessDialog({
  open,
  onOpenChange,
  mode,
  busy,
  title,
  description,
  submitLabel,
  onUnlock,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: VaultUnlockMode
  busy?: boolean
  title: string
  description: string
  submitLabel: string
  onUnlock: (value: string) => Promise<void>
}) {
  return (
    <VaultUnlockDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      busy={busy}
      title={title}
      description={description}
      submitLabel={submitLabel}
      passwordId="folder-access-password"
      onUnlock={onUnlock}
    />
  )
}
