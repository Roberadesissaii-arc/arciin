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
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { PasswordVaultEntryDetail } from "@/components/passwords/password-vault-entry-detail"
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
  revealPasswordVaultEntry,
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

const vaultRowIconBtn =
  "size-7 shrink-0 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
const vaultRowIconBtnDanger =
  "size-7 shrink-0 text-zinc-500 transition-colors hover:bg-red-50 hover:text-destructive"

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

function entryPlainPassword(
  entry: PasswordVaultEntry,
  ephemeralPasswords: Record<string, string>,
): string | null {
  if (ephemeralPasswords[entry.id]) return ephemeralPasswords[entry.id]!
  return entry.password ?? null
}

export function PasswordVaultPage() {
  const queryClient = useQueryClient()
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [pendingVaultUnlock, setPendingVaultUnlock] = useState(false)
  const [pendingRevealId, setPendingRevealId] = useState<string | null>(null)
  const [pendingCopy, setPendingCopy] = useState<{ label: string; entryId: string } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [ephemeralPasswords, setEphemeralPasswords] = useState<Record<string, string>>({})
  const [editEntry, setEditEntry] = useState<PasswordVaultEntry | null>(null)
  const [editRevealedPassword, setEditRevealedPassword] = useState<string | null>(null)
  const [pendingEditPasswordReveal, setPendingEditPasswordReveal] = useState(false)
  const [deleteEntry, setDeleteEntry] = useState<PasswordVaultEntry | null>(null)
  const [autoPrompted, setAutoPrompted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailCollapsed, setDetailCollapsed] = useState(false)

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
  })

  const display = vaultQuery.data?.display ?? DEFAULT_DISPLAY
  const secretsVisible = vaultQuery.data?.secretsVisible ?? !display.lockSidebarVault
  const lockRequired = vaultQuery.data?.lockRequired ?? display.lockSidebarVault
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false
  const entries = useMemo(
    () => vaultQuery.data?.entries ?? [],
    [vaultQuery.data?.entries],
  )

  const effectiveSelectedId = useMemo(() => {
    if (entries.length === 0) return null
    if (selectedId && entries.some((e) => e.id === selectedId)) return selectedId
    return entries[0]!.id
  }, [entries, selectedId])

  const selectedIndex = useMemo(() => {
    if (!effectiveSelectedId || entries.length === 0) return -1
    return entries.findIndex((e) => e.id === effectiveSelectedId)
  }, [entries, effectiveSelectedId])

  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex]! : null

  const goToEntry = useCallback(
    (index: number) => {
      const next = entries[index]
      if (next) {
        setSelectedId(next.id)
        setDetailCollapsed(false)
      }
    },
    [entries],
  )

  const selectEntry = useCallback((id: string) => {
    setSelectedId(id)
    setDetailCollapsed(false)
  }, [])

  useEffect(() => {
    if (!selectedEntry || entries.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const target = e.target as HTMLElement | null
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      if (e.key === "ArrowLeft" && selectedIndex > 0) goToEntry(selectedIndex - 1)
      if (e.key === "ArrowRight" && selectedIndex < entries.length - 1) {
        goToEntry(selectedIndex + 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [entries.length, goToEntry, selectedEntry, selectedIndex])

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
      setEphemeralPasswords({})
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => toast.error("Could not lock vault"),
  })

  const revealEntryMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: VaultUnlockInput }) =>
      revealPasswordVaultEntry(id, input),
    onError: (err: Error) => {
      toast.error(err.message || "Could not view password")
    },
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
        url: draft.url.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        category: draft.category.trim() || undefined,
        ...(draft.password !== undefined ? { password: draft.password } : {}),
      }),
    onSuccess: () => {
      toast.success("Credential updated")
      setEditEntry(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: (err: Error) => toast.error(err.message || "Could not update credential"),
  })

  const openVaultUnlock = useCallback(() => {
    setPendingVaultUnlock(true)
    setPendingRevealId(null)
    setPendingCopy(null)
    setPendingEditPasswordReveal(false)
    setUnlockOpen(true)
  }, [])

  useEffect(() => {
    if (vaultQuery.isLoading || autoPrompted) return
    if (entries.length === 0) return
    if (!lockRequired || secretsVisible) return
    queueMicrotask(() => {
      setAutoPrompted(true)
      openVaultUnlock()
    })
  }, [vaultQuery.isLoading, entries.length, lockRequired, secretsVisible, autoPrompted, openVaultUnlock])

  const requestRevealForEntry = (entryId: string, copy?: { label: string; entryId: string }) => {
    setPendingVaultUnlock(false)
    setPendingRevealId(entryId)
    setPendingCopy(copy ?? null)
    setPendingEditPasswordReveal(false)
    setUnlockOpen(true)
  }

  const revealOnlyEntry = useCallback(
    (entryId: string) => {
      setRevealed({ [entryId]: true })
      setEphemeralPasswords((prev) => {
        const next: Record<string, string> = {}
        if (prev[entryId]) next[entryId] = prev[entryId]!
        return next
      })
    },
    [],
  )

  const isPasswordVisible = (entry: PasswordVaultEntry) => {
    const plain = entryPlainPassword(entry, ephemeralPasswords)
    return Boolean(plain && revealed[entry.id])
  }

  const formatPassword = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return "—"
    const plain = entryPlainPassword(entry, ephemeralPasswords)
    if (isPasswordVisible(entry) && plain) return plain
    return maskVaultPassword(maskLengthForEntry(entry), display.maskStyle)
  }

  const onEyeClick = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return

    if (isPasswordVisible(entry)) {
      setRevealed((p) => ({ ...p, [entry.id]: false }))
      setEphemeralPasswords((p) => {
        const next = { ...p }
        delete next[entry.id]
        return next
      })
      return
    }

    if (secretsVisible) {
      revealOnlyEntry(entry.id)
      return
    }

    requestRevealForEntry(entry.id)
  }

  const openEditEntry = (entry: PasswordVaultEntry) => {
    setEditRevealedPassword(null)
    setEditEntry(entry)
  }

  const onCopyPassword = (entry: PasswordVaultEntry) => {
    if (!vaultEntryHasPassword(entry)) return
    const plain = entryPlainPassword(entry, ephemeralPasswords)
    if (plain && revealed[entry.id]) {
      void copyToClipboard(plain, "Password")
      return
    }
    if (secretsVisible && entry.password) {
      revealOnlyEntry(entry.id)
      void copyToClipboard(entry.password, "Password")
      return
    }
    requestRevealForEntry(entry.id, { label: "Password", entryId: entry.id })
  }

  const handleVaultUnlock = async (value: string) => {
    try {
      const payload = unlockPayload(value, pinConfigured)
      const revealId = pendingRevealId ?? pendingCopy?.entryId ?? null

      if (pendingVaultUnlock) {
        await unlockMutation.mutateAsync(payload)
        setEphemeralPasswords({})
        setRevealed({})
        await queryClient.refetchQueries({ queryKey: queryKeys.passwordVault })
        toast.success(pinConfigured ? "Vault unlocked with PIN" : "Vault unlocked")
      } else if (pendingEditPasswordReveal && editEntry) {
        if (secretsVisible) {
          await verifyPasswordVault(payload)
          await queryClient.refetchQueries({ queryKey: queryKeys.passwordVault })
          const fresh = queryClient.getQueryData<Awaited<ReturnType<typeof getPasswordVault>>>(
            queryKeys.passwordVault,
          )
          const entry = fresh?.entries.find((e) => e.id === editEntry.id)
          if (entry?.password) {
            setEditRevealedPassword(entry.password)
          } else {
            toast.error("Could not load password for this entry.")
          }
        } else {
          const entry = await revealEntryMutation.mutateAsync({
            id: editEntry.id,
            input: payload,
          })
          if (entry.password) {
            setEditRevealedPassword(entry.password)
          } else {
            toast.error("Could not load password for this entry.")
          }
        }
      } else if (revealId) {
        const entry = await revealEntryMutation.mutateAsync({ id: revealId, input: payload })
        if (entry.password) {
          setEphemeralPasswords((p) => ({ ...p, [revealId]: entry.password! }))
          revealOnlyEntry(revealId)
        }
        if (pendingCopy && entry.password) {
          await copyToClipboard(entry.password, pendingCopy.label)
        }
      } else if (secretsVisible) {
        await verifyPasswordVault(payload)
      }

      setUnlockOpen(false)
      setPendingVaultUnlock(false)
      setPendingRevealId(null)
      setPendingCopy(null)
      setPendingEditPasswordReveal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Incorrect credentials")
    }
  }

  const unlockDialogTitle = pendingVaultUnlock
    ? pinConfigured
      ? "Unlock password vault"
      : "Unlock password vault"
    : pendingRevealId && !secretsVisible
      ? "View this password"
      : pendingEditPasswordReveal
        ? "Confirm your identity"
        : undefined

  const unlockDialogDescription = pendingVaultUnlock
    ? pinConfigured
      ? "Unlock once to view any credential with the eye icon. Stays unlocked for 15 minutes or until you lock the vault."
      : "Unlock once to view any credential with the eye icon. Stays unlocked for 15 minutes or until you lock the vault."
    : pendingRevealId && !secretsVisible
      ? pinConfigured
        ? "Enter your vault PIN to view this password only. The vault stays locked for other entries."
        : "Enter your account password to view this password only. The vault stays locked for other entries."
      : pendingEditPasswordReveal
        ? "Enter your credentials to load this password in the editor."
        : undefined

  const unlockDialogSubmit = pendingVaultUnlock
    ? "Unlock vault"
    : pendingRevealId
      ? "View password"
      : undefined

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
            {lockRequired && !secretsVisible ? (
              <Button type="button" size="sm" disabled={busyUnlock} onClick={openVaultUnlock}>
                <Lock className="mr-1.5 size-4" />
                Unlock vault
              </Button>
            ) : null}
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

      <div
        className={cn(
          "grid gap-4",
          entries.length > 0 && !vaultQuery.isLoading
            ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
            : "grid-cols-1",
        )}
      >
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
                      role="button"
                      tabIndex={0}
                      onClick={() => selectEntry(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          selectEntry(entry.id)
                        }
                      }}
                      className={cn(
                        "cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/50",
                        effectiveSelectedId === entry.id && "bg-primary/[0.06]",
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
                                className={vaultRowIconBtn}
                                aria-label="Copy username"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void copyToClipboard(entry.username!, "Username")
                                }}
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
                                  className={vaultRowIconBtn}
                                  aria-label={pwdVisible ? "Hide password" : "Show password"}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onEyeClick(entry)
                                  }}
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
                                  className={vaultRowIconBtn}
                                  aria-label="Copy password"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onCopyPassword(entry)
                                  }}
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
                            className={vaultRowIconBtn}
                            aria-label="Edit credential"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditEntry(entry)
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              vaultRowIconBtn,
                              !entry.url && "opacity-40 hover:bg-transparent hover:text-zinc-500",
                            )}
                            aria-label="Open URL"
                            disabled={!entry.url}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (entry.url) openUrl(entry.url)
                            }}
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={vaultRowIconBtnDanger}
                            aria-label="Delete credential"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteEntry(entry)
                            }}
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

        {selectedEntry &&
        selectedIndex >= 0 &&
        entries.length > 0 &&
        !vaultQuery.isLoading &&
        !detailCollapsed ? (
          <PasswordVaultEntryDetail
            entry={{
              ...selectedEntry,
              password:
                entryPlainPassword(selectedEntry, ephemeralPasswords) ?? selectedEntry.password,
            }}
            index={selectedIndex}
            total={entries.length}
            display={display}
            secretsVisible={secretsVisible || Boolean(ephemeralPasswords[selectedEntry.id])}
            passwordVisible={isPasswordVisible(selectedEntry)}
            onClose={() => setDetailCollapsed(true)}
            onPrevious={() => goToEntry(selectedIndex - 1)}
            onNext={() => goToEntry(selectedIndex + 1)}
            onRevealPassword={() => onEyeClick(selectedEntry)}
            onCopyPassword={() => onCopyPassword(selectedEntry)}
            onCopyUsername={() =>
              selectedEntry.username &&
              void copyToClipboard(selectedEntry.username, "Username")
            }
            onEdit={() => openEditEntry(selectedEntry)}
            onDelete={() => setDeleteEntry(selectedEntry)}
            onOpenUrl={() => selectedEntry.url && openUrl(selectedEntry.url)}
          />
        ) : null}
      </div>

      <VaultUnlockDialog
        open={unlockOpen}
        busy={busyUnlock || revealEntryMutation.isPending}
        mode={pinConfigured ? "pin" : "password"}
        title={unlockDialogTitle}
        description={unlockDialogDescription}
        submitLabel={unlockDialogSubmit}
        passwordLabel={pendingRevealId && !secretsVisible ? "Account password" : undefined}
        onOpenChange={(open) => {
          setUnlockOpen(open)
          if (!open) {
            setPendingVaultUnlock(false)
            setPendingRevealId(null)
            setPendingCopy(null)
            setPendingEditPasswordReveal(false)
          }
        }}
        onUnlock={handleVaultUnlock}
      />

      <VaultEntryEditDialog
        entry={editEntry}
        open={Boolean(editEntry)}
        revealedPassword={editRevealedPassword}
        busy={editMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setEditEntry(null)
            setEditRevealedPassword(null)
            setPendingEditPasswordReveal(false)
          }
        }}
        onRequestPasswordReveal={() => {
          if (!editEntry) return
          setPendingVaultUnlock(false)
          setPendingEditPasswordReveal(true)
          setPendingRevealId(null)
          setPendingCopy(null)
          setUnlockOpen(true)
        }}
        onClearRevealedPassword={() => setEditRevealedPassword(null)}
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
