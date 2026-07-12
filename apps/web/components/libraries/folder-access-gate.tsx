"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { FolderLock } from "lucide-react"

import { notifyFolderActionError, notifyFolderUnlocked } from "@/lib/notifications/toast-actions"

import { FolderAccessDialog } from "@/components/libraries/folder-access-dialog"
import { Button } from "@/components/ui/button"
import { useUnlockFolder } from "@/hooks/use-libraries"
import { getPasswordVault } from "@/lib/api/password-vault"
import { queryKeys } from "@/lib/api/query-keys"
import type { FolderSummary } from "@/lib/types/models"

export function FolderAccessGate({
  folder,
  librarySlug,
  children,
}: {
  folder: FolderSummary
  librarySlug: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const needsUnlock = Boolean(folder.isLocked && !folder.accessGranted)

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
  })
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false
  const unlockMutation = useUnlockFolder()

  if (!needsUnlock) {
    return <>{children}</>
  }

  return (
    <>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50 text-primary">
          <FolderLock className="size-7" aria-hidden />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="font-heading text-xl font-semibold text-foreground">{folder.name}</h2>
          <p className="text-[13px] text-muted-foreground">
            This folder is locked. Enter your account password or vault PIN to view its files. The lock
            stays in place on desktop and mobile until you remove it.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            Unlock folder
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/${librarySlug}`)}>
            Back to library
          </Button>
        </div>
      </div>

      <FolderAccessDialog
        open={open}
        onOpenChange={setOpen}
        mode={pinConfigured ? "pin" : "password"}
        busy={unlockMutation.isPending}
        title="Unlock folder"
        description="Enter your credentials to open this folder for the next 15 minutes on this device."
        submitLabel="Unlock"
        onUnlock={async (value) => {
          try {
            await unlockMutation.mutateAsync({
              folderId: folder.id,
              libraryId: folder.libraryId,
              input: pinConfigured ? { pin: value } : { password: value },
            })
            notifyFolderUnlocked(folder.name)
            setOpen(false)
          } catch (err) {
            notifyFolderActionError(err, "Could not unlock folder")
            throw err
          }
        }}
      />
    </>
  )
}
