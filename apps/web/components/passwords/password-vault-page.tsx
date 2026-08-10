"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { maskVaultPassword, vaultEntryHasPassword } from "@arciin/shared"
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  FingerprintPattern,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  notifyPasswordVault,
  notifyPasswordVaultError,
} from "@/lib/notifications/toast-actions"

import { SoftLockBanner } from "@/components/license/soft-lock-banner"
import { PasswordVaultCredentialsSection } from "@/components/passwords/password-vault-credentials-section"
import { PasswordVaultDetailPlaceholder } from "@/components/passwords/password-vault-detail-placeholder"
import { PasswordVaultEntryDetail } from "@/components/passwords/password-vault-entry-detail"
import { PasswordVaultPageIntro } from "@/components/passwords/password-vault-page-intro"
import { useLicense } from "@/lib/license/use-license"
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
import { AppPagination } from "@/components/ui/app-pagination"
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

/** First page of the credentials table — seven roomy rows. */
const PAGE_SIZE = 7

function openUrl(url: string) {
  const href = url.startsWith("http") ? url : `https://${url}`
  window.open(href, "_blank", "noopener,noreferrer")
}

const vaultRowIconBtn =
  "size-7 shrink-0 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
const vaultRowIconBtnDanger =
  "size-7 shrink-0 text-zinc-500 transition-colors hover:bg-red-50 hover:text-destructive"

const vaultEmptyShell = cn(
  "flex min-h-[calc(100dvh-18rem)] flex-1 flex-col items-center justify-center rounded-2xl",
  "border border-dashed border-zinc-300/90 px-4 py-10 text-center md:px-6",
)

function VaultEmptyPlaceholder({
  loading = false,
  locked = false,
  planLabel = "Pro",
}: {
  loading?: boolean
  locked?: boolean
  planLabel?: string
}) {
  return (
    <div className={vaultEmptyShell}>
      {loading ? (
        <>
          <Skeleton className="size-12 rounded-md" />
          <Skeleton className="mt-4 h-4 w-44" />
          <Skeleton className="mt-2 h-3 w-60 max-w-full" />
        </>
      ) : locked ? (
        <SoftLockBanner
          plan={planLabel}
          title="Password vault is on Pro"
          description="Activate Pro (or higher) to store and unlock credentials. Your other files and libraries stay free."
        />
      ) : (
        <>
          <FingerprintPattern className="size-12 text-zinc-300" strokeWidth={1.5} />
          <p className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            No credentials yet
          </p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-zinc-500">
            Import entries from Settings when you are ready.
          </p>
        </>
      )}
    </div>
  )
}

function truncateUrl(url: string, max = 28) {
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
  const license = useLicense()
  // Secure: locked until license confirms vault entitlement (no unlocked flash while loading)
  const vaultLocked = !license.hasFeature("vault.password")
  const vaultPlanLabel = license.planLabel(license.requiredPlanFor("vault.password") ?? "pro")
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailCollapsed, setDetailCollapsed] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  /** Narrowing the list can leave you on a page that no longer exists. */
  const [searchAtPageReset, setSearchAtPageReset] = useState("")
  if (searchAtPageReset !== search) {
    setSearchAtPageReset(search)
    setPage(1)
  }

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
    enabled: !vaultLocked,
  })

  const display = vaultQuery.data?.display ?? DEFAULT_DISPLAY
  const secretsVisible = vaultQuery.data?.secretsVisible ?? !display.lockSidebarVault
  const lockRequired = vaultQuery.data?.lockRequired ?? display.lockSidebarVault
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false
  const allEntries = useMemo(
    () => vaultQuery.data?.entries ?? [],
    [vaultQuery.data?.entries],
  )

  /**
   * Filtering here rather than at the table means pagination, the selected
   * entry and the detail pane's next/previous all follow the same list.
   *
   * Deliberately does not search the password or notes: passwords are redacted
   * while the vault is locked so matching would be inconsistent, and notes are
   * free text people keep secrets in — no reason to make those greppable.
   */
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allEntries
    const terms = q.split(/\s+/)
    return allEntries.filter((entry) => {
      const haystack = [entry.name, entry.username, entry.url, entry.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [allEntries, search])

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageEntries = useMemo(
    () => entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [entries, safePage],
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

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(nextPage)
      const first = entries[(nextPage - 1) * PAGE_SIZE]
      if (first) {
        setSelectedId(first.id)
        setDetailCollapsed(false)
      }
    },
    [entries],
  )

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
      notifyPasswordVaultError(err.message || "Could not unlock vault")
    },
  })

  const lockMutation = useMutation({
    mutationFn: lockPasswordVault,
    onSuccess: () => {
      notifyPasswordVault("Vault locked")
      setRevealed({})
      setEphemeralPasswords({})
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => notifyPasswordVaultError("Could not lock vault"),
  })

  const revealEntryMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: VaultUnlockInput }) =>
      revealPasswordVaultEntry(id, input),
    onError: (err: Error) => {
      notifyPasswordVaultError(err.message || "Could not view password")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deletePasswordVaultEntry,
    onSuccess: () => {
      notifyPasswordVault("Credential removed")
      setDeleteEntry(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => notifyPasswordVaultError("Could not delete credential"),
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
      notifyPasswordVault("Credential updated")
      setEditEntry(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: (err: Error) => notifyPasswordVaultError(err.message || "Could not update credential"),
  })

  const openVaultUnlock = useCallback(() => {
    setPendingVaultUnlock(true)
    setPendingRevealId(null)
    setPendingCopy(null)
    setPendingEditPasswordReveal(false)
    setUnlockOpen(true)
  }, [])

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
    if (isPasswordVisible(entry)) {
      const plain = entryPlainPassword(entry, ephemeralPasswords)
      if (plain) {
        void copyToClipboard(plain, "Password")
        return
      }
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
        notifyPasswordVault(pinConfigured ? "Vault unlocked with PIN" : "Vault unlocked")
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
            notifyPasswordVaultError("Could not load password for this entry.")
          }
        } else {
          const entry = await revealEntryMutation.mutateAsync({
            id: editEntry.id,
            input: payload,
          })
          if (entry.password) {
            setEditRevealedPassword(entry.password)
          } else {
            notifyPasswordVaultError("Could not load password for this entry.")
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
      notifyPasswordVaultError(err instanceof Error ? err.message : "Incorrect credentials")
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

  const busyUnlock = unlockMutation.isPending

  const vaultActionClass =
    "h-10 gap-1.5 px-4 text-[13px] font-semibold"

  const vaultActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className={vaultActionClass} asChild>
        <Link href="/settings?tab=passwords">
          <FileUp className="size-4" />
          Import
        </Link>
      </Button>
      {lockRequired && !secretsVisible ? (
        <Button type="button" className={vaultActionClass} disabled={busyUnlock} onClick={openVaultUnlock}>
          <Lock className="size-4" />
          Unlock vault
        </Button>
      ) : null}
      {lockRequired && secretsVisible ? (
        <Button
          type="button"
          variant="outline"
          className={vaultActionClass}
          disabled={lockMutation.isPending}
          onClick={() => lockMutation.mutate()}
        >
          <Lock className="size-4" />
          Lock vault
        </Button>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn(
        // Match other dashboard pages: outer padding comes from DashboardContentArea only
        "dashboard-main flex w-full min-w-0 flex-1 flex-col gap-6 pb-8",
        (vaultLocked || (entries.length === 0 && !vaultQuery.isLoading)) && "pb-0",
      )}
    >
      <PasswordVaultPageIntro
        entryCount={vaultLocked ? 0 : entries.length}
        loading={!vaultLocked && vaultQuery.isLoading}
        pinConfigured={pinConfigured}
        lockRequired={lockRequired}
        secretsVisible={secretsVisible}
      />

      {!vaultLocked && allEntries.length > 0 && !vaultQuery.isLoading ? (
        <PasswordVaultCredentialsSection
          pinConfigured={pinConfigured}
          lockRequired={lockRequired}
          secretsVisible={secretsVisible}
          actions={vaultActions}
          search={search}
          onSearchChange={setSearch}
        />
      ) : !vaultLocked && !vaultQuery.isLoading ? (
        <div className="flex justify-end">{vaultActions}</div>
      ) : null}

      <div
        className={cn(
          "min-h-0",
          (vaultLocked || (allEntries.length === 0 && !vaultQuery.isLoading)) &&
            "flex flex-1 flex-col",
          !vaultLocked &&
            allEntries.length > 0 &&
            !vaultQuery.isLoading
            ? "grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
            : "grid-cols-1",
        )}
      >
        {vaultLocked ? (
          <VaultEmptyPlaceholder locked planLabel={vaultPlanLabel} />
        ) : vaultQuery.isLoading && !vaultQuery.data ? (
          <VaultEmptyPlaceholder loading />
        ) : allEntries.length === 0 ? (
          <VaultEmptyPlaceholder />
        ) : entries.length === 0 ? (
          // A search miss is not an empty vault — saying "import some entries"
          // here would be nonsense when you have 187 of them.
          <div className="flex min-h-[32rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              No credentials match &ldquo;{search.trim()}&rdquo;
            </p>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Search looks at the site, username, and category.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 border-border"
              onClick={() => setSearch("")}
            >
              Clear search
            </Button>
          </div>
        ) : (
        <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-5">
            <FingerprintPattern className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Credentials</span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-max table-fixed text-left">
              <colgroup>
                <col style={{ width: "18%" }} />
                {display.showUsername ? <col style={{ width: "18%" }} /> : null}
                {display.showPasswordColumn ? <col style={{ width: "18%" }} /> : null}
                {display.showUrl ? <col style={{ width: "18%" }} /> : null}
                {display.showNotes ? <col style={{ width: "12%" }} /> : null}
                {display.showCategory ? <col style={{ width: "10%" }} /> : null}
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Name
                  </th>
                  {display.showUsername ? (
                    <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Username
                    </th>
                  ) : null}
                  {display.showPasswordColumn ? (
                    <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Password
                    </th>
                  ) : null}
                  {display.showUrl ? (
                    <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Link
                    </th>
                  ) : null}
                  {display.showNotes ? (
                    <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Notes
                    </th>
                  ) : null}
                  {display.showCategory ? (
                    <th className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Category
                    </th>
                  ) : null}
                  <th className="px-5 py-3.5 text-right text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageEntries.map((entry) => {
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
                        "h-[3.75rem] cursor-pointer transition-colors hover:bg-muted/40",
                        effectiveSelectedId === entry.id && "bg-primary/[0.06]",
                      )}
                    >
                      <td className="px-5 py-4 align-middle text-[13px] font-medium text-foreground">
                        <span className="block truncate" title={entry.name}>
                          {entry.name}
                        </span>
                      </td>
                      {display.showUsername ? (
                        <td className="px-5 py-4 align-middle">
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="min-w-0 truncate text-[12px] text-zinc-600">
                              {entry.username ?? "—"}
                            </span>
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
                        <td className="px-5 py-4 align-middle">
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
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
                        <td className="px-5 py-4 align-middle">
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
                        <td className="truncate px-5 py-4 align-middle text-[12px] text-zinc-500">
                          {entry.notes ?? "—"}
                        </td>
                      ) : null}
                      {display.showCategory ? (
                        <td className="truncate px-5 py-4 align-middle text-[12px] text-zinc-500">
                          {entry.category ?? "—"}
                        </td>
                      ) : null}
                      <td className="px-5 py-4 align-middle">
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
          {totalPages > 1 ? (
            <div className="border-t border-border px-5 py-3">
              <AppPagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          ) : null}
        </div>
        )}

        {entries.length > 0 && !vaultQuery.isLoading ? (
          selectedEntry && !detailCollapsed ? (
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
          ) : (
            <PasswordVaultDetailPlaceholder
              total={entries.length}
              collapsed={detailCollapsed}
              onExpand={() => setDetailCollapsed(false)}
            />
          )
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
