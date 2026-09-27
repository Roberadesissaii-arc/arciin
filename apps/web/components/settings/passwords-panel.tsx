"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isVaultImportEntry, parsePasswordImportFile } from "@arciin/shared"
import { VaultPinInput } from "@/components/passwords/vault-pin-input"
import { VaultUnlockDialog } from "@/components/passwords/vault-unlock-dialog"
import {
  ClipboardPaste,
  FileUp,
  FingerprintPattern,
  Lock,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"
import {
  notifyDeleted,
  notifyPasswordSaved,
  notifyPasswordVault,
  notifyPasswordVaultError,
} from "@/lib/notifications/toast-actions"

import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  PillSwitch,
  SectionHeader,
  SettingRow,
} from "@/components/settings/settings-panel-primitives"
import { SettingsSegment } from "@/components/settings/settings-segment"
import {
  clearPasswordVault,
  getPasswordVault,
  importPasswordVault,
  removePasswordVaultPin,
  setPasswordVaultPin,
  updatePasswordVaultDisplay,
} from "@/lib/api/password-vault"
import { LockedFeatureCard } from "@/components/license/locked-feature-card"
import { queryKeys } from "@/lib/api/query-keys"
import { ApiError } from "@/lib/api/errors"
import { useLicense } from "@/lib/license/use-license"
import type { PasswordVaultDisplaySettings } from "@/lib/types/models"
import type { PasswordVaultList } from "@/lib/api/password-vault"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"

const ACCEPT = ".json,.csv,.txt,application/json,text/csv,text/plain"

type VaultTab = "import" | "display" | "pin"

const TAB_OPTIONS: { value: VaultTab; label: string }[] = [
  { value: "import", label: "Import" },
  { value: "display", label: "Display" },
  { value: "pin", label: "PIN" },
]

const MASK_OPTIONS = [
  { value: "dots" as const, label: "Dots" },
  { value: "asterisk" as const, label: "Asterisk" },
  { value: "block" as const, label: "Hidden" },
]

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

function countImportable(text: string, fileName?: string) {
  return parsePasswordImportFile(text, fileName).filter(isVaultImportEntry).length
}

function csvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function manualEntryToImportText(entry: {
  name: string
  username: string
  password: string
  url: string
}) {
  return [
    csvCell(entry.name.trim()),
    csvCell(entry.username.trim()),
    csvCell(entry.password),
    csvCell(entry.url.trim()),
  ].join(",")
}

const EMPTY_MANUAL_ENTRY = {
  name: "",
  username: "",
  password: "",
  url: "",
}

export function PasswordsPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const license = useLicense()
  const [tab, setTab] = useState<VaultTab>("import")
  const [replaceOnImport, setReplaceOnImport] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [manualEntry, setManualEntry] = useState(EMPTY_MANUAL_ENTRY)
  const [showManualPassword, setShowManualPassword] = useState(false)
  const [confirmRevealOpen, setConfirmRevealOpen] = useState(false)
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [pinAccountPassword, setPinAccountPassword] = useState("")
  const [removePinPassword, setRemovePinPassword] = useState("")

  const vaultLocked = license.shouldPaywall("vault.password")
  const vaultPlan = license.requiredPlanFor("vault.password")
  const vaultPlanLabel = vaultPlan ? license.planLabel(vaultPlan) : "Pro"

  const vaultQuery = useQuery({
    queryKey: queryKeys.passwordVault,
    queryFn: ({ signal }) => getPasswordVault(signal),
    // Don't spam LICENSE_REQUIRED while Free — show the Pro lock card instead.
    enabled: !vaultLocked,
  })

  const display = vaultQuery.data?.display ?? DEFAULT_DISPLAY
  const pinConfigured = vaultQuery.data?.pinConfigured ?? false

  const displayMutation = useMutation({
    mutationFn: updatePasswordVaultDisplay,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.passwordVault })
      const prev = queryClient.getQueryData<PasswordVaultList>(queryKeys.passwordVault)
      queryClient.setQueryData<PasswordVaultList>(queryKeys.passwordVault, (old) => {
        if (!old) return old
        return { ...old, display: { ...old.display, ...patch } }
      })
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.passwordVault, ctx.prev)
      notifyPasswordVaultError("Could not save display settings.")
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
  })

  const importMutation = useMutation({
    mutationFn: importPasswordVault,
    onSuccess: async (data) => {
      notifyPasswordSaved(data.imported)
      setPasteText("")
      setManualEntry(EMPTY_MANUAL_ENTRY)
      setShowManualPassword(false)
      // Defer heavy vault refetch so the settings UI does not freeze after large imports.
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
      }, 0)
    },
    onError: (err: Error) => {
      notifyPasswordVaultError(err.message || "Import failed.")
    },
  })

  const setPinMutation = useMutation({
    mutationFn: setPasswordVaultPin,
    onSuccess: () => {
      notifyPasswordVault("Vault PIN saved")
      setPin("")
      setConfirmPin("")
      setPinAccountPassword("")
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: (err: Error) => notifyPasswordVaultError(err.message || "Could not save PIN"),
  })

  const removePinMutation = useMutation({
    mutationFn: removePasswordVaultPin,
    onSuccess: () => {
      notifyPasswordVault("Vault PIN removed")
      setRemovePinPassword("")
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: (err: Error) => notifyPasswordVaultError(err.message || "Could not remove PIN"),
  })

  const clearMutation = useMutation({
    mutationFn: clearPasswordVault,
    onSuccess: (data) => {
      notifyDeleted({ kind: "vault", count: data.deleted })
      void queryClient.invalidateQueries({ queryKey: queryKeys.passwordVault })
    },
    onError: () => notifyPasswordVaultError("Could not clear vault."),
  })

  const runImport = (text: string, fileName?: string) => {
    const count = countImportable(text, fileName)
    if (count === 0) {
      notifyPasswordVaultError(
        "No password entries found. Export CSV from Edge, Chrome, or Firefox (name,url,username,password), or use Bitwarden JSON.",
      )
      return
    }
    importMutation.mutate({ text, fileName, replace: replaceOnImport })
  }

  const saveManualEntry = () => {
    const name = manualEntry.name.trim()
    if (!name) {
      notifyPasswordVaultError("Enter a name for this credential.")
      return
    }

    const hasDetail =
      manualEntry.username.trim() ||
      manualEntry.password.trim() ||
      manualEntry.url.trim()

    if (!hasDetail) {
      notifyPasswordVaultError("Add at least a username, password, or URL.")
      return
    }

    runImport(manualEntryToImportText({ ...manualEntry, name }), "manual-entry.csv")
  }

  const manualEntryReady =
    manualEntry.name.trim() &&
    (manualEntry.username.trim() || manualEntry.password.trim() || manualEntry.url.trim())

  const onFile = async (file: File) => {
    const text = await file.text()
    runImport(text, file.name)
  }

  const patchDisplay = (patch: Partial<PasswordVaultDisplaySettings>) => {
    displayMutation.mutate(patch)
  }

  const entries = vaultQuery.data?.entries ?? []
  const busy = importMutation.isPending || clearMutation.isPending || displayMutation.isPending

  // Same Pro lock treatment as Assist / sidebar — not a red error banner.
  if (vaultLocked) {
    return (
      <div className="p-1" data-testid="passwords-settings-locked">
        <LockedFeatureCard
          plan={vaultPlanLabel}
          title="Password vault is a Pro feature"
          description="Encrypted credentials, import, and PIN unlock are part of Pro — the same plan that unlocks AI Chat and Assist. Free still keeps your files on this server."
        />
      </div>
    )
  }

  if (vaultQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-48 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    )
  }

  if (vaultQuery.isError) {
    const err = vaultQuery.error
    if (err instanceof ApiError && err.code === "LICENSE_REQUIRED") {
      return (
        <div className="p-1" data-testid="passwords-settings-locked">
          <LockedFeatureCard
            plan={vaultPlanLabel}
            title="Password vault is a Pro feature"
            description="Encrypted credentials, import, and PIN unlock are part of Pro — the same plan that unlocks AI Chat and Assist. Free still keeps your files on this server."
          />
        </div>
      )
    }
    return (
      <SettingsPanelError
        message={
          err instanceof Error ? err.message : "Could not load password vault settings."
        }
        hint="Password vault settings require OWNER or ADMIN on this instance."
      />
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <SectionHeader
                icon={FingerprintPattern}
                title="Password vault"
                description={
                  tab === "import"
                    ? "Import Edge, Chrome, Firefox, or Bitwarden exports (CSV/JSON), paste text, or add credentials manually."
                    : tab === "display"
                      ? "Control columns, masking, and sidebar unlock behavior."
                      : "Set a 6-digit PIN for the Passwords page (account password required to change)."
                }
              />
            </div>
            <SettingsSegment
              aria-label="Password vault section"
              options={TAB_OPTIONS}
              value={tab}
              disabled={busy}
              onChange={setTab}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {tab === "display" ? (
            <>
              <SettingRow label="Show username" hint="Email or login name column">
                <PillSwitch
                  on={display.showUsername}
                  disabled={busy}
                  onChange={() => patchDisplay({ showUsername: !display.showUsername })}
                />
              </SettingRow>
              <SettingRow label="Show URL" hint="Site or login link column">
                <PillSwitch
                  on={display.showUrl}
                  disabled={busy}
                  onChange={() => patchDisplay({ showUrl: !display.showUrl })}
                />
              </SettingRow>
              <SettingRow label="Show notes" hint="Imported notes (never sent to AI)">
                <PillSwitch
                  on={display.showNotes}
                  disabled={busy}
                  onChange={() => patchDisplay({ showNotes: !display.showNotes })}
                />
              </SettingRow>
              <SettingRow label="Show category" hint="Folder or collection from export">
                <PillSwitch
                  on={display.showCategory}
                  disabled={busy}
                  onChange={() => patchDisplay({ showCategory: !display.showCategory })}
                />
              </SettingRow>
              <SettingRow label="Show password column" hint="Hide the entire password field">
                <PillSwitch
                  on={display.showPasswordColumn}
                  disabled={busy}
                  onChange={() => patchDisplay({ showPasswordColumn: !display.showPasswordColumn })}
                />
              </SettingRow>
              <SettingRow
                label="Reveal passwords by default"
                hint="While the vault is unlocked on the Passwords page, the eye shows passwords without asking again. Requires account password to enable."
              >
                <PillSwitch
                  on={display.revealByDefault}
                  disabled={busy}
                  onChange={() => {
                    if (display.revealByDefault) {
                      patchDisplay({ revealByDefault: false })
                      return
                    }
                    setConfirmRevealOpen(true)
                  }}
                />
              </SettingRow>
              {display.showPasswordColumn ? (
                <SettingRow label="Mask style" hint="How hidden passwords look in the table">
                  <SettingsSegment
                    aria-label="Password mask style"
                    options={MASK_OPTIONS}
                    value={display.maskStyle}
                    disabled={busy}
                    onChange={(value) => patchDisplay({ maskStyle: value })}
                  />
                </SettingRow>
              ) : null}
              <SettingRow
                label="Require unlock in sidebar"
                hint="When enabled, /passwords hides secrets until you enter your vault PIN or account password"
              >
                <PillSwitch
                  on={display.lockSidebarVault}
                  disabled={busy}
                  onChange={() => patchDisplay({ lockSidebarVault: !display.lockSidebarVault })}
                />
              </SettingRow>
              <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-zinc-600">
                <p>
                  <span className="font-medium text-foreground">AI access</span> is configured under{" "}
                  <Link href="/settings?tab=ai-security" className="font-medium text-primary hover:underline">
                    Settings → AI Security → Password vault
                  </Link>
                  . The assistant only sees what you allow there; passwords always appear as{" "}
                  <span className="font-mono text-foreground">[VAULT_ENCRYPTED]</span> in chat.
                </p>
              </div>
            </>
          ) : tab === "pin" ? (
            <div className="space-y-4">
              <p className="text-[12px] leading-relaxed text-zinc-500">
                {pinConfigured
                  ? "PIN is active on the Passwords page."
                  : "Six digits, grouped 3 + 3 — same layout as unlock."}
              </p>
              <div className="w-fit max-w-full space-y-4">
                <VaultPinInput
                  id="vault-new-pin"
                  label="New PIN"
                  value={pin}
                  disabled={setPinMutation.isPending}
                  onChange={setPin}
                />
                <VaultPinInput
                  id="vault-confirm-pin"
                  label="Confirm PIN"
                  value={confirmPin}
                  disabled={setPinMutation.isPending}
                  onChange={setConfirmPin}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="pin-account-password" className="text-[13px] font-medium text-foreground">
                    Account password
                  </Label>
                  <Input
                    id="pin-account-password"
                    type="password"
                    autoComplete="current-password"
                    className="h-9 w-full"
                    value={pinAccountPassword}
                    disabled={setPinMutation.isPending}
                    onChange={(e) => setPinAccountPassword(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  disabled={
                    setPinMutation.isPending ||
                    pin.length !== 6 ||
                    confirmPin.length !== 6 ||
                    pin !== confirmPin ||
                    !pinAccountPassword.trim()
                  }
                  onClick={() =>
                    setPinMutation.mutate({
                      pin,
                      confirmPin,
                      accountPassword: pinAccountPassword,
                    })
                  }
                >
                  {pinConfigured ? "Update PIN" : "Set PIN"}
                </Button>
                {pinConfigured ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-[13px] font-medium text-foreground">Remove PIN</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="remove-pin-password" className="text-[13px] font-medium text-foreground">
                        Account password
                      </Label>
                      <Input
                        id="remove-pin-password"
                        type="password"
                        autoComplete="current-password"
                        className="h-9 w-full"
                        value={removePinPassword}
                        disabled={removePinMutation.isPending}
                        onChange={(e) => setRemovePinPassword(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={removePinMutation.isPending || !removePinPassword.trim()}
                      onClick={() => removePinMutation.mutate(removePinPassword)}
                    >
                      Remove PIN
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFile(file)
                  e.target.value = ""
                }}
              />

              <div className="space-y-3">
                <p className="text-[13px] font-medium text-foreground">Import from file or paste</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Export CSV from Edge, Chrome, or Firefox (or Bitwarden JSON), then import below.
                  Entries are encrypted on this server — delete the export file after upload.
                </p>

                <div className="flex flex-wrap gap-2 text-[11px] font-medium text-zinc-600">
                  <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                    Edge CSV
                  </span>
                  <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                    Chrome CSV
                  </span>
                  <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                    Firefox CSV
                  </span>
                  <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                    Bitwarden JSON
                  </span>
                </div>

                <textarea
                  placeholder={`Paste Edge/Chrome CSV or JSON…\nname,url,username,password\nGitHub,https://github.com/login,you@email.com,secret`}
                  value={pasteText}
                  disabled={busy}
                  rows={5}
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[7.5rem] w-full resize-y rounded-xl border px-3.5 py-3 font-mono text-xs leading-snug focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={(e) => setPasteText(e.target.value)}
                />

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 border-border px-4 text-[13px] font-semibold"
                    disabled={busy || !pasteText.trim()}
                    onClick={() => runImport(pasteText, "paste.txt")}
                  >
                    <ClipboardPaste className="mr-2 size-4" />
                    Import pasted text
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 border-border px-4 text-[13px] font-semibold"
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                  >
                    <FileUp className="mr-2 size-4" />
                    Import file
                  </Button>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="replace-vault"
                      checked={replaceOnImport}
                      disabled={busy}
                      onCheckedChange={(v) => setReplaceOnImport(v === true)}
                    />
                    <Label htmlFor="replace-vault" className="text-sm font-normal text-muted-foreground">
                      Replace vault on import
                    </Label>
                  </div>

                  {entries.length > 0 ? (
                    <ConfirmDestructiveButton
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      title="Delete every saved credential?"
                      description="All entries in the Passwords vault on this instance are deleted permanently. This cannot be undone."
                      confirmLabel="Clear vault"
                      disabled={busy}
                      pending={clearMutation.isPending}
                      onConfirm={() => clearMutation.mutateAsync()}
                    >
                      <Trash2 className="mr-1.5 size-4" />
                      Clear vault
                    </ConfirmDestructiveButton>
                  ) : null}
                </div>

                {pasteText.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const n = countImportable(pasteText, "paste.txt")
                      return (
                        <>
                          Preview: <span className="font-medium text-foreground">{n}</span> entr
                          {n === 1 ? "y" : "ies"} detected
                        </>
                      )
                    })()}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-[13px] font-medium text-foreground">Add manually</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Optional — save a single credential without a CSV or JSON file.
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="vault-manual-name" className="text-[13px] font-medium text-foreground">
                      Name
                    </Label>
                    <Input
                      id="vault-manual-name"
                      placeholder="GitHub Personal"
                      value={manualEntry.name}
                      disabled={busy}
                      className="h-9"
                      onChange={(e) => setManualEntry((entry) => ({ ...entry, name: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="vault-manual-username" className="text-[13px] font-medium text-foreground">
                      Username
                    </Label>
                    <Input
                      id="vault-manual-username"
                      placeholder="you@example.com"
                      autoComplete="off"
                      value={manualEntry.username}
                      disabled={busy}
                      className="h-9"
                      onChange={(e) =>
                        setManualEntry((entry) => ({ ...entry, username: e.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="vault-manual-password" className="text-[13px] font-medium text-foreground">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="vault-manual-password"
                        type={showManualPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={manualEntry.password}
                        disabled={busy}
                        className="h-9 pr-10"
                        onChange={(e) =>
                          setManualEntry((entry) => ({ ...entry, password: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-9 px-2 text-muted-foreground hover:text-foreground"
                        disabled={busy}
                        onClick={() => setShowManualPassword((show) => !show)}
                      >
                        {showManualPassword ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="vault-manual-url" className="text-[13px] font-medium text-foreground">
                      URL
                    </Label>
                    <Input
                      id="vault-manual-url"
                      placeholder="https://github.com/login"
                      autoComplete="off"
                      value={manualEntry.url}
                      disabled={busy}
                      className="h-9"
                      onChange={(e) => setManualEntry((entry) => ({ ...entry, url: e.target.value }))}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  className="mt-3 h-9"
                  disabled={busy || !manualEntryReady}
                  onClick={saveManualEntry}
                >
                  <Plus className="mr-2 size-4" />
                  Save credential
                </Button>
              </div>

              {entries.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{entries.length}</span> credential
                  {entries.length === 1 ? "" : "s"} in vault. View and copy them in the{" "}
                  <Link href="/passwords" className="font-medium text-primary hover:underline">
                    Passwords
                  </Link>{" "}
                  sidebar page.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <VaultUnlockDialog
        open={confirmRevealOpen}
        onOpenChange={setConfirmRevealOpen}
        busy={displayMutation.isPending}
        title="Confirm account password"
        description="Enabling reveal-by-default lets the eye icon show passwords without PIN or account password. Passwords still appear masked until you tap the eye. Enter your account password to confirm."
        submitLabel="Enable reveal"
        passwordId="vault-reveal-confirm-password"
        onUnlock={async (accountPassword) => {
          await displayMutation.mutateAsync({ revealByDefault: true, accountPassword })
          notifyPasswordVault("Reveal by default enabled.")
          setConfirmRevealOpen(false)
        }}
      />

      <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
        <div className="flex items-start gap-2.5 text-sm leading-relaxed text-zinc-600">
          <Lock className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
          <p>
            Credentials are encrypted at rest (AES-256-GCM). AI access is configured under{" "}
            <Link
              href="/settings?tab=ai-security"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Settings → AI Security → Password vault
            </Link>
            . The assistant never receives vault passwords.
          </p>
        </div>
      </div>
    </div>
  )
}
