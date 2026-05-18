"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { maskVaultPassword, vaultEntryHasPassword } from "@arciin/shared"
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FingerprintPattern,
  Lock,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { PasswordVaultPageIntro } from "@/components/passwords/password-vault-page-intro"
import {
  VaultEntryEditDialog,
  type VaultEntryDraft,
} from "@/components/passwords/vault-entry-edit-dialog"
import { VaultUnlockDialog } from "@/components/passwords/vault-unlock-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  deletePasswordVaultEntry,
  getPasswordVault,
  lockPasswordVault,
  unlockPasswordVault,
  updatePasswordVaultEntry,
  verifyPasswordVault,
  type VaultUnlockInput,
} from "@/lib/api/password-vault"
import { queryKeys } from "@/lib/api/query-keys"
import { copyToClipboard } from "@/lib/utils/clipboard"
import type { PasswordVaultDisplaySettings, PasswordVaultEntry } from "@/lib/types/models"
import { cn } from "@/lib/utils"

const DEFAULT_DISPLAY: PasswordVaultDisplaySettings = {
  showUsername: true,
  showUrl: true,
  showNotes: false,
  showCategory: false,
  showPasswordColumn: true,
  maskStyle: "dots",
  revealByDefault: false,
  lockSidebarVault: true,
}

function openUrl(url: string) {
  const href = url.startsWith("http") ? url : `https://${url}`
  window.open(href, "_blank", "noopener,noreferrer")
}

function truncateUrl(url: string, max = 40) {
  const stripped = url.replace(/^https?:\/\//i, "")
  if (stripped.length <= max) return stripped
  return `${stripped.slice(0, max)}…`
}

function maskLengthForEntry(entry: PasswordVaultEntry) {
  return entry.password?.length ?? entry.passwordLength ?? 8
}

function unlockPayload(value: string, pinConfigured: boolean): VaultUnlockInput {
  return pinConfigured ? { pin: value } : { password: value }
}

export function PasswordVaultPage() {
  const queryClient = useQueryClient()
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [pendingRevealId, setPendingRevealId] = useState<string | null>(null)
  const [pendingCopy, setPendingCopy] = useState<{ label: string; entryId: string } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [editEntry, setEditEntry] = useState<PasswordVaultEntry | null>(null)
  const [deleteEntry, setDeleteEntry] = useState<PasswordVaultEntry | null>(null)
  const [autoPrompted, setAutoPrompted] = useState(false)

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
  })

  const display = vaultQuery.data?.display ?? DEFAULT_DISPLAY
  const secretsVisible = vaultQuery.data?.secretsVisible ?? !display.lockSidebarVault
  const lockRequired = vaultQuery.data?.lockRequired ?? display.lockSidebarVault
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false
  const entries = vaultQuery.data?.entries ?? []

  const unlockMutation = useMutation({
    mutationFn: unlockPasswordVault,
    onError: (err: Error) => {
      toast.error(err.message || "Could not unlock vault")
    },
  })

  const lockMutation = useMutation({
    mutationFn: lockPasswordVault,
    onSuccess: () => {
      toast.success("Vault locked")
      setRevealed({})
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => toast.error("Could not lock vault"),
  })

  const deleteMutation = useMutation({
    mutationFn: deletePasswordVaultEntry,
    onSuccess: () => {
      toast.success("Credential removed")
      setDeleteEntry(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => toast.error("Could not delete credential"),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: VaultEntryDraft }) =>
      updatePasswordVaultEntry(id, {
        name: draft.name.trim(),
        username: draft.username.trim() || undefined,
        password: draft.password || undefined,
        url: draft.url.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        category: draft.category.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Credential updated")
      setEditEntry(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: (err: Error) => toast.error(err.message || "Could not update credential"),
  })

  useEffect(() => {
    if (vaultQuery.isLoading || autoPrompted) return
    if (entries.length === 0) return
    if (!lockRequired || secretsVisible) return
    queueMicrotask(() => {
      setAutoPrompted(true)
      setUnlockOpen(true)
    })
  }, [vaultQuery.isLoading, entries.length, lockRequired, secretsVisible, autoPrompted])

  const requestUnlockForReveal = (entryId: string) => {
    setPendingCopy(null)
    setPendingRevealId(entryId)
    setUnlockOpen(true)
  }

  const requestUnlockForCopy = (entryId: string, label: string) => {
    setPendingRevealId(entryId)
    setPendingCopy({ label, entryId })
    setUnlockOpen(true)
  }

  const isPasswordVisible = (entry: PasswordVaultEntry) =>
    Boolean(secretsVisible && entry.password && revealed[entry.id])

  const formatPassword = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return "—"
    if (isPasswordVisible(entry) && entry.password) return entry.password
    return maskVaultPassword(maskLengthForEntry(entry), display.maskStyle)
  }

  const onEyeClick = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return

    if (isPasswordVisible(entry)) {
      setRevealed((p) => ({ ...p, [entry.id]: false }))
      return
    }

    if (display.revealByDefault && secretsVisible) {
      setRevealed((p) => ({ ...p, [entry.id]: true }))
      return
    }

    requestUnlockForReveal(entry.id)
  }

  const onCopyPassword = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return
    const canCopyPlain =
      secretsVisible &&
      entry.password &&
      (display.revealByDefault || revealed[entry.id])

    if (canCopyPlain) {
      void copyToClipboard(entry.password!, "Password")
      return
    }
    requestUnlockForCopy(entry.id, "Password")
  }

  const handleVaultUnlock = async (value: string) => {
    try {
      const payload = unlockPayload(value, pinConfigured)
      const wasLocked = !secretsVisible

      if (wasLocked) {
        await unlockMutation.mutateAsync(payload)
        await queryClient.refetchQueries({ queryKey: queryKeys.passwordVault })
      } else {
        await verifyPasswordVault(payload)
      }

      const fresh = queryClient.getQueryData<Awaited<ReturnType<typeof getPasswordVault>>>(
        queryKeys.passwordVault,
      )
      const revealId = pendingRevealId ?? pendingCopy?.entryId ?? null

      if (revealId) {
        setRevealed((p) => ({ ...p, [revealId]: true }))
      }

      if (pendingCopy) {
        const entry = fresh?.entries.find((e) => e.id === pendingCopy.entryId)
        if (entry?.password) {
          await copyToClipboard(entry.password, pendingCopy.label)
        }
      } else if (wasLocked) {
        toast.success(pinConfigured ? "Vault unlocked with PIN" : "Vault unlocked")
      } else if (revealId) {
        toast.success("Password revealed")
      }

      setUnlockOpen(false)
      setPendingRevealId(null)
      setPendingCopy(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Incorrect credentials")
    }
  }

  const statusLabel =
    entries.length === 0
      ? "Empty"
      : !lockRequired
        ? "Open"
        : secretsVisible
          ? pinConfigured
            ? "PIN unlocked"
            : "Unlocked"
          : "Protected"

  const busyUnlock = unlockMutation.isPending

  return (
    <div className="dashboard-main space-y-6 pb-8 p-4 md:p-6">
      <PasswordVaultPageIntro
        entryCount={entries.length}
        statusLabel={statusLabel}
        loading={vaultQuery.isLoading}
        pinConfigured={pinConfigured}
        lockRequired={lockRequired}
        secretsVisible={secretsVisible}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {lockRequired && secretsVisible ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={lockMutation.isPending}
                onClick={() => lockMutation.mutate()}
              >
                <Lock className="mr-1.5 size-4" />
                Lock vault
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/settings?tab=passwords">
                <Settings className="mr-1.5 size-4" />
                Import & settings
              </Link>
            </Button>
          </div>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/[0.03]">
        {vaultQuery.isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <FingerprintPattern className="size-10 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No credentials yet. Import from{" "}
              <Link href="/settings?tab=passwords" className="font-medium text-primary hover:underline">
                Settings → Passwords
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-zinc-50/95">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Name
                  </th>
                  {display.showUsername ? (
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Username
                    </th>
                  ) : null}
                  {display.showPasswordColumn ? (
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Password
                    </th>
                  ) : null}
                  {display.showUrl ? (
                    <th className="min-w-[160px] px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Link
                    </th>
                  ) : null}
                  {display.showNotes ? (
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Notes
                    </th>
                  ) : null}
                  {display.showCategory ? (
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Category
                    </th>
                  ) : null}
                  <th className="w-[120px] px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const pwdVisible = isPasswordVisible(entry)
                  const hasPwd = vaultEntryHasPassword(entry)
                  return (
                    <tr
                      key={entry.id}
                      className={cn(
                        "border-b border-border transition-colors last:border-b-0 hover:bg-muted/50",
                      )}
                    >
                      <td className="px-4 py-2.5 align-middle font-medium text-zinc-900">
                        {entry.name}
                      </td>
                      {display.showUsername ? (
                        <td className="px-4 py-2.5 align-middle">
                          <div className="flex items-center gap-1">
                            <span className="text-zinc-700">{entry.username ?? "—"}</span>
                            {entry.username ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0"
                                aria-label="Copy username"
                                onClick={() => void copyToClipboard(entry.username!, "Username")}
                              >
                                <Copy className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      {display.showPasswordColumn ? (
                        <td className="px-4 py-2.5 align-middle">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[11px] text-zinc-800">
                              {formatPassword(entry)}
                            </span>
                            {hasPwd ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 shrink-0"
                                  aria-label={pwdVisible ? "Hide password" : "Show password"}
                                  onClick={() => onEyeClick(entry)}
                                >
                                  {pwdVisible ? (
                                    <EyeOff className="size-3.5" />
                                  ) : (
                                    <Eye className="size-3.5" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 shrink-0"
                                  aria-label="Copy password"
                                  onClick={() => onCopyPassword(entry)}
                                >
                                  <Copy className="size-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      {display.showUrl ? (
                        <td className="max-w-xs px-4 py-2.5 align-middle">
                          {entry.url ? (
                            <span
                              className="block truncate font-mono text-[11px] text-zinc-600"
                              title={entry.url}
                            >
                              {truncateUrl(entry.url)}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                      ) : null}
                      {display.showNotes ? (
                        <td className="max-w-[180px] truncate px-4 py-2.5 align-middle text-zinc-600">
                          {entry.notes ?? "—"}
                        </td>
                      ) : null}
                      {display.showCategory ? (
                        <td className="px-4 py-2.5 align-middle text-zinc-600">
                          {entry.category ?? "—"}
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5 align-middle">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            aria-label="Edit credential"
                            onClick={() => setEditEntry(entry)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            aria-label="Open URL"
                            disabled={!entry.url}
                            onClick={() => entry.url && openUrl(entry.url)}
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-destructive hover:text-destructive"
                            aria-label="Delete credential"
                            onClick={() => setDeleteEntry(entry)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VaultUnlockDialog
        open={unlockOpen}
        busy={busyUnlock}
        mode={pinConfigured ? "pin" : "password"}
        onOpenChange={(open) => {
          setUnlockOpen(open)
          if (!open) {
            setPendingRevealId(null)
            setPendingCopy(null)
          }
        }}
        onUnlock={handleVaultUnlock}
      />

      <VaultEntryEditDialog
        entry={editEntry}
        open={Boolean(editEntry)}
        busy={editMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setEditEntry(null)
        }}
        onSave={async (id, draft) => {
          await editMutation.mutateAsync({ id, draft })
        }}
      />

      <AlertDialog open={Boolean(deleteEntry)} onOpenChange={(open) => !open && setDeleteEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete credential?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-medium text-foreground">{deleteEntry?.name}</span> from the
              vault. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteEntry && deleteMutation.mutate(deleteEntry.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
