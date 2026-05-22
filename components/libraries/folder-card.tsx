"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Folder, FolderLock, PencilLine, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { FolderAccessDialog } from "@/components/libraries/folder-access-dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  useDeleteFolder,
  useLockFolder,
  useRemoveFolderLock,
  useUnlockFolder,
  useUpdateFolder,
} from "@/hooks/use-libraries"
import { getPasswordVault } from "@/lib/api/password-vault"
import type { FolderCredentialInput } from "@/lib/api/libraries"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { FolderSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

const glassInput =
  "h-10 border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"

function folderNeedsUnlock(folder: FolderSummary) {
  return Boolean(folder.isLocked && !folder.accessGranted)
}

export function FolderCard({ folder, librarySlug }: { folder: FolderSummary; librarySlug: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const href = `/${librarySlug}/${folder.slug}`

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState(folder.name)
  const [renameError, setRenameError] = useState<string | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessMode, setAccessMode] = useState<"open" | "lock" | "remove-lock">("open")

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
  })
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false

  const updateMutation = useUpdateFolder()
  const deleteMutation = useDeleteFolder()
  const lockMutation = useLockFolder()
  const unlockMutation = useUnlockFolder()
  const removeLockMutation = useRemoveFolderLock()

  const locked = Boolean(folder.isLocked)
  const needsUnlock = folderNeedsUnlock(folder)
  const accessBusy =
    lockMutation.isPending || unlockMutation.isPending || removeLockMutation.isPending

  const handleRenameOpenChange = (next: boolean) => {
    if (next) {
      setRenameName(folder.name)
      setRenameError(undefined)
    }
    setRenameOpen(next)
  }

  const navigateAfterRenameIfNeeded = (newSlug: string) => {
    if (pathname === `/${librarySlug}/${folder.slug}` && newSlug !== folder.slug) {
      router.replace(`/${librarySlug}/${newSlug}`)
    }
  }

  const navigateAfterDeleteIfNeeded = () => {
    if (pathname === `/${librarySlug}/${folder.slug}`) {
      router.push(`/${librarySlug}`)
    }
  }

  const unlockPayload = (value: string): FolderCredentialInput =>
    pinConfigured ? { pin: value } : { password: value }

  const openAccessDialog = (mode: typeof accessMode) => {
    setAccessMode(mode)
    setAccessOpen(true)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (!needsUnlock) return
    e.preventDefault()
    openAccessDialog("open")
  }

  const handleAccessUnlock = async (value: string) => {
    const input = unlockPayload(value)
    try {
      if (accessMode === "lock") {
        await lockMutation.mutateAsync({
          folderId: folder.id,
          libraryId: folder.libraryId,
          input,
        })
        toast.success("Folder locked")
        setAccessOpen(false)
        return
      }
      if (accessMode === "remove-lock") {
        await removeLockMutation.mutateAsync({
          folderId: folder.id,
          libraryId: folder.libraryId,
          input,
        })
        toast.success("Folder lock removed")
        setAccessOpen(false)
        return
      }
      await unlockMutation.mutateAsync({
        folderId: folder.id,
        libraryId: folder.libraryId,
        input,
      })
      toast.success("Folder unlocked for this session")
      setAccessOpen(false)
      router.push(href)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify credentials")
      throw err
    }
  }

  const accessCopy =
    accessMode === "lock"
      ? {
          title: "Lock folder",
          description:
            "Enter your account password or vault PIN. This folder will stay locked on all devices until you remove the lock.",
          submit: "Lock folder",
        }
      : accessMode === "remove-lock"
        ? {
            title: "Remove folder lock",
            description: "Enter your credentials to permanently unlock this folder for everyone.",
            submit: "Remove lock",
          }
        : {
            title: "Unlock folder",
            description:
              "This folder is locked. Enter your account password or vault PIN to open it. Access stays available for 15 minutes on this device.",
            submit: "Unlock",
          }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="outline-none">
            <Link
              href={needsUnlock ? "#" : href}
              onClick={handleCardClick}
              className="group block select-none"
            >
              <div className="ml-3 h-[10px] w-[40%] rounded-t-[6px] bg-gradient-to-b from-primary/45 to-primary/20 ring-1 ring-inset ring-primary/35 transition-[filter,box-shadow] group-hover:from-primary/55 group-hover:to-primary/28" />
              <div className="relative overflow-hidden rounded-b-2xl rounded-tr-2xl border border-zinc-200/95 bg-gradient-to-b from-[var(--arciin-accent-soft,#fff7ed)] via-zinc-100/90 to-zinc-50/95 px-4 py-5 shadow-sm ring-1 ring-inset ring-primary/20 transition-all group-hover:border-primary/35 group-hover:from-[var(--arciin-accent-soft,#fff7ed)] group-hover:via-zinc-50 group-hover:shadow-md">
                <div className="pointer-events-none absolute inset-0 opacity-90" aria-hidden>
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(180deg, var(--arciin-accent-wash, color-mix(in srgb, var(--arciin-accent, #ff4f12) 14%, transparent)) 0%, transparent 42%)",
                    }}
                  />
                  <div
                    className="absolute -top-16 left-1/2 w-[min(85%,280px)] -translate-x-1/2 blur-[44px]"
                    style={{
                      background:
                        "radial-gradient(ellipse at 50% 0%, var(--arciin-accent-glow, color-mix(in srgb, var(--arciin-accent, #ff4f12) 18%, transparent)) 0%, transparent 65%)",
                    }}
                  />
                </div>
                {folder.assetCount > 0 && (
                  <div className="absolute right-3 top-3 rounded-md border border-zinc-200/80 bg-white/90 px-2 py-1 text-[12px] font-semibold tabular-nums text-zinc-700 shadow-sm transition-colors group-hover:border-primary/25 group-hover:text-zinc-900">
                    {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
                  </div>
                )}
                {locked ? (
                  <div
                    className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-lg border border-zinc-200/90 bg-white/95 text-primary shadow-sm"
                    title={needsUnlock ? "Locked — password required" : "Locked — access granted"}
                  >
                    <FolderLock className="size-4" aria-hidden />
                  </div>
                ) : null}
                <div className="relative">
                  <Folder className="mb-3 h-7 w-7 text-primary/85 transition-colors group-hover:text-primary" />
                  <div className="truncate text-[13px] font-semibold text-zinc-900">{folder.name}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-zinc-600">
                    {locked ? "Locked folder" : "Folder"}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          <ContextMenuItem
            onSelect={() => {
              if (needsUnlock) {
                openAccessDialog("open")
                return
              }
            }}
            asChild={!needsUnlock}
          >
            {needsUnlock ? (
              <span>Open folder…</span>
            ) : (
              <Link href={href}>Open folder</Link>
            )}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              setRenameName(folder.name)
              setRenameError(undefined)
              setRenameOpen(true)
            }}
          >
            <PencilLine className="size-4" />
            Rename…
          </ContextMenuItem>
          {locked ? (
            <>
              <ContextMenuItem onSelect={() => openAccessDialog("open")}>
                <FolderLock className="size-4" />
                Enter password to open…
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => openAccessDialog("remove-lock")}>
                <FolderLock className="size-4" />
                Remove lock…
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem onSelect={() => openAccessDialog("lock")}>
              <FolderLock className="size-4" />
              Lock folder…
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
            Delete…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <FolderAccessDialog
        open={accessOpen}
        onOpenChange={setAccessOpen}
        mode={pinConfigured ? "pin" : "password"}
        busy={accessBusy}
        title={accessCopy.title}
        description={accessCopy.description}
        submitLabel={accessCopy.submit}
        onUnlock={handleAccessUnlock}
      />

      <Sheet open={renameOpen} onOpenChange={handleRenameOpenChange}>
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
              Rename folder
            </SheetTitle>
            <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
              Update the display name. The URL slug updates to match.
            </SheetDescription>
          </SheetHeader>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
            <Field>
              <FieldLabel
                htmlFor={`rename-${folder.id}`}
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Folder name
              </FieldLabel>
              <Input
                id={`rename-${folder.id}`}
                value={renameName}
                onChange={(e) => {
                  setRenameName(e.target.value)
                  setRenameError(undefined)
                }}
                className={glassInput}
              />
              <FieldError errors={[renameError ? { message: renameError } : undefined]} />
            </Field>
          </div>

          <SheetFooter className="shrink-0 border-t border-border p-2">
            <Button
              className="h-10 w-full bg-primary text-white hover:bg-primary/90"
              disabled={updateMutation.isPending}
              onClick={async () => {
                const trimmed = renameName.trim()
                if (!trimmed) {
                  setRenameError("Folder name is required.")
                  return
                }
                if (trimmed === folder.name) {
                  setRenameOpen(false)
                  return
                }
                try {
                  const updated = await updateMutation.mutateAsync({
                    folderId: folder.id,
                    name: trimmed,
                    libraryId: folder.libraryId,
                  })
                  toast.success("Folder renamed.")
                  setRenameOpen(false)
                  navigateAfterRenameIfNeeded(updated.slug)
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not rename folder.")
                }
              }}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              <span className="font-medium text-foreground">{folder.name}</span>
              {" "}and any subfolders will be removed from the library. Files stay in place until you delete them
              separately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={async () => {
                try {
                  await deleteMutation.mutateAsync({
                    folderId: folder.id,
                    libraryId: folder.libraryId,
                  })
                  toast.success("Folder deleted.")
                  setDeleteOpen(false)
                  navigateAfterDeleteIfNeeded()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not delete folder.")
                }
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
