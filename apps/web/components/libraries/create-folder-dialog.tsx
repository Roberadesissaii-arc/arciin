"use client"
/* eslint-disable react-hooks/set-state-in-effect -- intentional prop-sync: reset the form state when the dialog opens. */

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FolderLock, FolderPlus, RefreshCw, X } from "lucide-react"

import {
  notifyFolderActionError,
  notifyFolderCreated,
} from "@/lib/notifications/toast-actions"

import { VaultPinInput } from "@/components/passwords/vault-pin-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useCreateFolder, useLockFolder } from "@/hooks/use-libraries"
import { getPasswordVault } from "@/lib/api/password-vault"
import type { FolderCredentialInput } from "@/lib/api/libraries"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { generateFolderName } from "@/lib/utils/generate-folder-name"
import { cn } from "@/lib/utils"

const glassInput =
  "h-10 border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"

function resetFormState() {
  return {
    name: generateFolderName(),
    lockEnabled: false,
    password: "",
    pin: "",
    error: undefined as string | undefined,
    lockError: undefined as string | undefined,
  }
}

export function CreateFolderDialog({
  libraryId,
  parentFolderId,
}: {
  libraryId: string
  parentFolderId?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => generateFolderName())
  const [lockEnabled, setLockEnabled] = useState(false)
  const [password, setPassword] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [lockError, setLockError] = useState<string | undefined>()

  const createFolderMutation = useCreateFolder()
  const lockFolderMutation = useLockFolder()

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
    enabled: open,
  })
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false

  useEffect(() => {
    if (!open) return
    const fresh = resetFormState()
    setName(fresh.name)
    setLockEnabled(fresh.lockEnabled)
    setPassword(fresh.password)
    setPin(fresh.pin)
    setError(fresh.error)
    setLockError(fresh.lockError)
  }, [open])

  const busy = createFolderMutation.isPending || lockFolderMutation.isPending

  function lockCredential(): FolderCredentialInput | null {
    if (!lockEnabled) return null
    if (pinConfigured) {
      if (pin.length !== 6) return null
      return { pin }
    }
    const trimmed = password.trim()
    if (!trimmed) return null
    return { password: trimmed }
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Folder name is required.")
      return
    }

    if (lockEnabled) {
      const credential = lockCredential()
      if (!credential) {
        setLockError(
          pinConfigured
            ? "Enter your 6-digit vault PIN to lock this folder."
            : "Enter your account password to lock this folder.",
        )
        return
      }
    }

    setError(undefined)
    setLockError(undefined)

    try {
      const folder = await createFolderMutation.mutateAsync({
        libraryId,
        parentFolderId,
        name: trimmed,
      })

      if (lockEnabled) {
        const credential = lockCredential()
        if (credential) {
          await lockFolderMutation.mutateAsync({
            folderId: folder.id,
            libraryId: folder.libraryId,
            input: credential,
          })
        }
      }

      notifyFolderCreated(trimmed, lockEnabled)
      setOpen(false)
    } catch (submitError) {
      notifyFolderActionError(submitError, "Could not create folder")
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="bg-primary text-white hover:bg-primary/90">
          <FolderPlus className="size-4" />
          Create folder
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        <SheetHeader className="relative shrink-0 space-y-1 border-b border-border p-2 pr-11">
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
          <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Create folder
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
            Add a nested folder inside this library to keep the archive organized.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
          <Field>
            <FieldLabel
              htmlFor="folderName"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Folder name
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="folderName"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(undefined)
                }}
                autoComplete="off"
                className={cn(glassInput, "flex-1")}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="h-10 w-10 shrink-0 border-border"
                title="Generate another name"
                aria-label="Generate another name"
                onClick={() => {
                  setName(generateFolderName())
                  setError(undefined)
                }}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Auto-generated by default — edit the name or tap refresh for another suggestion.
            </p>
            <FieldError errors={[error ? { message: error } : undefined]} />
          </Field>

          <div className="rounded-xl border border-border bg-muted/15 p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="lockFolderOnCreate"
                checked={lockEnabled}
                onCheckedChange={(checked) => {
                  setLockEnabled(checked === true)
                  setLockError(undefined)
                  setPassword("")
                  setPin("")
                }}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <Label
                  htmlFor="lockFolderOnCreate"
                  className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-foreground"
                >
                  <FolderLock className="size-3.5 text-muted-foreground" aria-hidden />
                  Lock this folder
                </Label>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Requires your account password or vault PIN to open. Same protection as locking a
                  folder from the right-click menu.
                </p>
              </div>
            </div>

            {lockEnabled ? (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                {pinConfigured ? (
                  <VaultPinInput
                    id="create-folder-lock-pin"
                    label="Vault PIN"
                    value={pin}
                    disabled={busy}
                    onChange={(value) => {
                      setPin(value)
                      setLockError(undefined)
                    }}
                  />
                ) : (
                  <Field>
                    <FieldLabel
                      htmlFor="createFolderLockPassword"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Account password
                    </FieldLabel>
                    <Input
                      id="createFolderLockPassword"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      disabled={busy}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setLockError(undefined)
                      }}
                      className={glassInput}
                    />
                  </Field>
                )}
                <FieldError errors={[lockError ? { message: lockError } : undefined]} />
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t border-border p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={busy}
            onClick={() => void handleCreate()}
          >
            {busy
              ? "Creating…"
              : lockEnabled
                ? "Create locked folder"
                : "Create folder"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
