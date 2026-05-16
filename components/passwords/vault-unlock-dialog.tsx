"use client"

import { useEffect, useState } from "react"
import { Lock } from "lucide-react"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { VaultPinInput } from "@/components/passwords/vault-pin-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type VaultUnlockMode = "password" | "pin"

export function VaultUnlockDialog({
  open,
  onOpenChange,
  mode = "password",
  onUnlock,
  busy,
  title,
  description,
  submitLabel,
  passwordLabel = "Account password",
  passwordId = "vault-unlock-password",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: VaultUnlockMode
  onUnlock: (value: string) => Promise<void>
  busy?: boolean
  title?: string
  description?: string
  submitLabel?: string
  passwordLabel?: string
  passwordId?: string
}) {
  const [password, setPassword] = useState("")
  const [pin, setPin] = useState("")

  useEffect(() => {
    if (!open) {
      setPassword("")
      setPin("")
    }
  }, [open])

  const isPin = mode === "pin"
  const resolvedTitle = title ?? (isPin ? "Enter vault PIN" : "Unlock password vault")
  const resolvedDescription =
    description ??
    (isPin
      ? "Enter your 6-digit vault PIN to view saved credentials. Access stays unlocked for 15 minutes."
      : "Enter your Arciin account password to view saved credentials. Access stays unlocked for 15 minutes, or until you lock the vault again.")
  const resolvedSubmit = submitLabel ?? (isPin ? "Unlock" : "Unlock")

  const submit = async () => {
    const value = isPin ? pin : password
    if (!value.trim() || (isPin && pin.length !== 6)) return
    await onUnlock(value)
    setPassword("")
    setPin("")
  }

  const canSubmit = isPin ? pin.length === 6 : password.trim().length > 0

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
            {resolvedTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-1">
          {isPin ? (
            <VaultPinInput
              id="vault-unlock-pin"
              label="Vault PIN"
              value={pin}
              disabled={busy}
              onChange={setPin}
              onComplete={() => void submit()}
            />
          ) : (
            <>
              <Label htmlFor={passwordId}>{passwordLabel}</Label>
              <Input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit()
                }}
              />
            </>
          )}
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !canSubmit} onClick={() => void submit()}>
            {resolvedSubmit}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
