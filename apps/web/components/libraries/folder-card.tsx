"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Folder, FolderLock, Eye, EyeOff, Cloud, Inbox, PencilLine, Share2, Trash2, X } from "lucide-react"
import {
  notifyDeleted,
  notifyFolderActionError,
  notifyFolderHiddenFromAllFiles,
  notifyFolderLockRemoved,
  notifyFolderLocked,
  notifyFolderRenamed,
  notifyFolderShownInAllFiles,
  notifyFolderUnlocked,
} from "@/lib/notifications/toast-actions"

import { FolderAccessDialog } from "@/components/libraries/folder-access-dialog"
import { ShareDialog } from "@/components/shares/share-dialog"
import { FileRequestDialog } from "@/components/file-requests/file-request-dialog"
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
import {
  libraryContextMenuIcon,
  libraryGlassContextMenu,
  libraryGlassContextMenuItem,
  libraryGlassSheetPanel,
} from "@/lib/library-glass-sheet"
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
  const [shareOpen, setShareOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
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
  const isRemote = Boolean(folder.isRemote)
  const hideFromAllFiles = Boolean(folder.hideFromAllFiles)
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
        notifyFolderLocked(folder.name)
        setAccessOpen(false)
        return
      }
      if (accessMode === "remove-lock") {
        await removeLockMutation.mutateAsync({
          folderId: folder.id,
          libraryId: folder.libraryId,
          input,
        })
        notifyFolderLockRemoved(folder.name)
        setAccessOpen(false)
        return
      }
      await unlockMutation.mutateAsync({
        folderId: folder.id,
        libraryId: folder.libraryId,
        input,
      })
      notifyFolderUnlocked(folder.name)
      setAccessOpen(false)
      router.push(href)
    } catch (err) {
      notifyFolderActionError(err)
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
              <div className="ml-3 h-[10px] w-[40%] rounded-t-[6px] border border-b-0 border-zinc-200 bg-gradient-to-b from-zinc-100 to-zinc-50 transition-colors group-hover:border-zinc-300 group-hover:from-zinc-200/80 group-hover:to-zinc-100" />
              <div className="relative overflow-hidden rounded-b-2xl rounded-tr-2xl border border-zinc-200 bg-white px-4 py-5 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-all group-hover:-translate-y-px group-hover:border-zinc-300 group-hover:shadow-[0_10px_28px_-14px_rgba(24,24,27,0.22)]">
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-zinc-50 to-transparent"
                  aria-hidden
                />
                {folder.assetCount > 0 && (
                  <div className="absolute right-3 top-3 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 transition-colors group-hover:border-zinc-300 group-hover:text-zinc-900">
                    {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
                  </div>
                )}
                {isRemote || locked || hideFromAllFiles ? (
                  <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                    {isRemote ? (
                      <div
                        className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-primary shadow-sm"
                        title="Connected remotely — files arrive via API from another site or app"
                      >
                        <Cloud className="size-4" aria-hidden />
                      </div>
                    ) : null}
                    {hideFromAllFiles ? (
                      <div
                        className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm"
                        title="Hidden from All Files — open this folder to browse"
                      >
                        <EyeOff className="size-4" aria-hidden />
                      </div>
                    ) : null}
                    {locked ? (
                      <div
                        className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors group-hover:text-primary"
                        title={needsUnlock ? "Locked — password required" : "Locked — access granted"}
                      >
                        <FolderLock className="size-4" aria-hidden />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="relative">
                  <span className="mb-3 flex size-9 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 transition-colors group-hover:border-primary/25 group-hover:bg-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_8%,white)]">
                    <Folder className="size-[18px] fill-primary/15 text-primary transition-colors" />
                  </span>
                  <div className="truncate text-[13px] font-semibold text-zinc-900">{folder.name}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
                    {locked
                      ? "Locked folder"
                      : isRemote
                        ? "Remote folder"
                        : "Folder"}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className={libraryGlassContextMenu}>
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
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
          <ContextMenuSeparator className="mx-0.5 my-0.5" />
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            onSelect={() => {
              setRenameName(folder.name)
              setRenameError(undefined)
              setRenameOpen(true)
            }}
          >
            <span className={libraryContextMenuIcon}>
              <PencilLine className="size-3.5" />
            </span>
            Rename…
          </ContextMenuItem>
          {locked ? (
            <>
              <ContextMenuItem
                className={libraryGlassContextMenuItem}
                onSelect={() => openAccessDialog("open")}
              >
                <span className={libraryContextMenuIcon}>
                  <FolderLock className="size-3.5" />
                </span>
                Enter password to open…
              </ContextMenuItem>
              <ContextMenuItem
                className={libraryGlassContextMenuItem}
                onSelect={() => openAccessDialog("remove-lock")}
              >
                <span className={libraryContextMenuIcon}>
                  <FolderLock className="size-3.5" />
                </span>
                Remove lock…
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem
              className={libraryGlassContextMenuItem}
              onSelect={() => openAccessDialog("lock")}
            >
              <span className={libraryContextMenuIcon}>
                <FolderLock className="size-3.5" />
              </span>
              Lock folder…
            </ContextMenuItem>
          )}
          <ContextMenuSeparator className="mx-0.5 my-0.5" />
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            disabled={needsUnlock}
            onSelect={() => setShareOpen(true)}
          >
            <span className={libraryContextMenuIcon}>
              <Share2 className="size-3.5" />
            </span>
            Share…
          </ContextMenuItem>
          {/* Separate action, not a mode of Share: Share lets someone read this
              folder, Request files lets someone write into it without reading. */}
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            disabled={needsUnlock}
            onSelect={() => setRequestOpen(true)}
            data-testid="folder-request-files"
          >
            <span className={libraryContextMenuIcon}>
              <Inbox className="size-3.5" />
            </span>
            Request files…
          </ContextMenuItem>
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            disabled={updateMutation.isPending}
            onSelect={async () => {
              const next = !hideFromAllFiles
              try {
                await updateMutation.mutateAsync({
                  folderId: folder.id,
                  libraryId: folder.libraryId,
                  hideFromAllFiles: next,
                })
                if (next) {
                  notifyFolderHiddenFromAllFiles(folder.name)
                } else {
                  notifyFolderShownInAllFiles(folder.name)
                }
              } catch (e) {
                notifyFolderActionError(e, "Could not update folder")
              }
            }}
          >
            <span className={libraryContextMenuIcon}>
              {hideFromAllFiles ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </span>
            {hideFromAllFiles ? "Show in All Files" : "Hide from All Files"}
          </ContextMenuItem>
          <ContextMenuSeparator className="mx-0.5 my-0.5" />
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <span className={cn(libraryContextMenuIcon, "bg-red-500/15 text-red-400")}>
              <Trash2 className="size-3.5" />
            </span>
            Delete…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={{ resourceType: "FOLDER", folder }}
      />

      <FileRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        folder={folder}
      />

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
                  notifyFolderRenamed(trimmed)
                  setRenameOpen(false)
                  navigateAfterRenameIfNeeded(updated.slug)
                } catch (e) {
                  notifyFolderActionError(e, "Could not rename folder")
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
                  notifyDeleted({ kind: "folder" })
                  setDeleteOpen(false)
                  navigateAfterDeleteIfNeeded()
                } catch (e) {
                  notifyFolderActionError(e, "Could not delete folder")
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
