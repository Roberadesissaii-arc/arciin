"use client"

import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  ChevronDown,
  HardDriveDownload,
  KeyRound,
  Loader2,
  Lock,
  Terminal,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { UnmountedMountInstructions } from "@/components/storage/unmounted-mount-instructions"
import { ApiError } from "@/lib/api/errors"
import { mountStorageDevice } from "@/lib/api/settings"
import { cn } from "@/lib/utils"
import type { UnmountedBlockDevice } from "@/lib/types/models"

type UnmountedDrivesPanelProps = {
  devices: UnmountedBlockDevice[]
  selectedId: string | null
  onSelect: (device: UnmountedBlockDevice | null) => void
  onMounted: (result: { arciinPath: string; deviceId: string }) => void
  disabled?: boolean
  isDocker?: boolean
  mountPasswordlessSudo?: boolean
}

export function UnmountedDrivesPanel({
  devices,
  selectedId,
  onSelect,
  onMounted,
  disabled = false,
  isDocker = false,
  mountPasswordlessSudo = false,
}: UnmountedDrivesPanelProps) {
  const [sudoPassword, setSudoPassword] = useState("")
  const [luksPassphrase, setLuksPassphrase] = useState("")
  const [formatAsExt4, setFormatAsExt4] = useState(false)
  const [confirmErase, setConfirmErase] = useState(false)
  const [showSshHelp, setShowSshHelp] = useState(false)
  const [mountDialogOpen, setMountDialogOpen] = useState(false)
  const [sudoError, setSudoError] = useState<string | null>(null)
  const sudoInputRef = useRef<HTMLInputElement>(null)

  const selected = devices.find((d) => d.id === selectedId) ?? null
  const sudoRequired = !mountPasswordlessSudo && !isDocker

  // Reset format choices when the selected drive (or its format need) changes —
  // render-phase state adjustment instead of an effect.
  const selectionKey = selected ? `${selected.id}:${selected.needsFormat ? 1 : 0}` : null
  const [lastSelectionKey, setLastSelectionKey] = useState<string | null>(null)
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey)
    if (selected?.needsFormat) {
      setFormatAsExt4(true)
    } else if (selected) {
      setFormatAsExt4(false)
      setConfirmErase(false)
    }
  }

  const mountMutation = useMutation({
    mutationFn: (passwordOverride?: string) => {
      if (!selected) throw new Error("Select a drive first.")
      const password = (passwordOverride ?? sudoPassword).trim()
      return mountStorageDevice({
        deviceId: selected.id,
        sudoPassword: password || undefined,
        luksPassphrase: selected.isLuks ? luksPassphrase : undefined,
        formatAsExt4,
        confirmErase: formatAsExt4 ? confirmErase : undefined,
      })
    },
    onSuccess: (result) => {
      toast.success("Drive mounted.", {
        description: `Rescanning volumes — ${result.arciinPath} is ready to use.`,
      })
      onMounted({ arciinPath: result.arciinPath, deviceId: selected!.id })
      setMountDialogOpen(false)
      setSudoPassword("")
      setSudoError(null)
      setLuksPassphrase("")
      setFormatAsExt4(false)
      setConfirmErase(false)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "SUDO_PASSWORD_REQUIRED") {
        setSudoError("Enter the Linux password for the server user running Arciin.")
        setMountDialogOpen(true)
        setTimeout(() => sudoInputRef.current?.focus(), 50)
        return
      }
      if (err instanceof ApiError && err.code === "NO_FILESYSTEM") {
        setFormatAsExt4(true)
        toast.error("No filesystem on this drive.", {
          description: "Check format below, then try again.",
        })
        return
      }
      if (err instanceof ApiError && err.code === "FORMAT_FAILED") {
        setFormatAsExt4(true)
        toast.error("Format did not complete.", {
          description:
            err.message || "Filesystem was not detected. Try Mount again or Rescan.",
        })
        return
      }
      toast.error("Could not mount drive", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  function validateBeforeMount(): boolean {
    if (!selected) return false
    if (formatAsExt4 && !confirmErase) {
      toast.error("Confirm before formatting.", {
        description: "Check the box confirming you understand formatting erases this disk.",
      })
      return false
    }
    if (selected.isLuks && !luksPassphrase.trim()) {
      toast.error("Password required.", {
        description: "Enter the disk encryption (LUKS) password.",
      })
      return false
    }
    return true
  }

  function handleMountClick() {
    if (!validateBeforeMount()) return
    if (sudoRequired && !sudoPassword.trim()) {
      setSudoError(null)
      setMountDialogOpen(true)
      setTimeout(() => sudoInputRef.current?.focus(), 50)
      return
    }
    mountMutation.mutate(undefined)
  }

  function handleDialogMount() {
    if (!sudoPassword.trim()) {
      setSudoError("Sudo password is required on this server.")
      sudoInputRef.current?.focus()
      return
    }
    if (!validateBeforeMount()) return
    setSudoError(null)
    mountMutation.mutate(sudoPassword)
  }

  if (!devices.length) {
    return (
      <section className="space-y-2 rounded-xl border border-border bg-muted/15 p-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[10px] font-bold text-muted-foreground"
              aria-hidden
            >
              2
            </span>
            <h4 className="text-[12px] font-semibold text-foreground">
              Attached drives — not mounted yet
            </h4>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {isDocker
              ? "Docker cannot mount disks from the UI. Mount on the host, then tap Rescan."
              : "No unmounted drives detected. Plug in an SD card or USB disk on the server, then tap Rescan."}
          </p>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border bg-muted/15 p-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[10px] font-bold text-muted-foreground"
              aria-hidden
            >
              2
            </span>
            <h4 className="text-[12px] font-semibold text-foreground">
              Attached drives — not mounted yet
            </h4>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Extra SD cards or USB disks appear here. Select one, mount it, then pick it under{" "}
            <span className="font-medium text-foreground">Move files to</span> below.
          </p>
        </div>

        <ul className="grid gap-2">
          {devices.map((device) => {
            const isSelected = selectedId === device.id
            return (
              <li key={device.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(isSelected ? null : device)}
                  className={cn(
                    "flex w-full min-h-[88px] flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                    isSelected
                      ? "border-primary/40 bg-card ring-1 ring-primary/25"
                      : "border-border bg-card hover:bg-muted/25",
                    disabled && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <HardDriveDownload
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-mono text-[12px] font-medium text-foreground">
                          {device.device}
                        </p>
                        <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {device.sizeLabel}
                        </span>
                        {device.model ? (
                          <span className="text-[10px] text-muted-foreground">{device.model}</span>
                        ) : null}
                        {device.isLuks ? (
                          <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                            Encrypted
                          </span>
                        ) : null}
                        {device.needsFormat ? (
                          <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            Blank — format first
                          </span>
                        ) : device.filesystem ? (
                          <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {device.filesystem}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        → {device.suggestedArciinPath}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>

        {selected ? (
          <div className="space-y-3 rounded-xl border border-border bg-card px-3.5 py-3">
            <p className="text-[11px] font-medium text-foreground">
              Prepare <span className="font-mono">{selected.device}</span>
            </p>

            {isDocker ? (
              <p className="text-[11px] leading-relaxed text-primary">
                Docker cannot mount disks from the UI. Mount on the host, then tap Rescan.
              </p>
            ) : (
              <>
                {sudoRequired ? (
                  <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                      <KeyRound className="size-3.5 text-primary" />
                      Server sudo password required
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Arciin will ask for your Linux user password when you tap Mount (same as SSH).
                    </p>
                  </div>
                ) : null}

                {selected.isLuks ? (
                  <div className="space-y-2">
                    <Label htmlFor="mount-luks" className="flex items-center gap-1.5 text-[11px]">
                      <Lock className="size-3" />
                      Disk encryption password (LUKS)
                    </Label>
                    <Input
                      id="mount-luks"
                      type="password"
                      autoComplete="off"
                      value={luksPassphrase}
                      onChange={(e) => setLuksPassphrase(e.target.value)}
                      className="h-10 border-border bg-background text-foreground"
                    />
                  </div>
                ) : null}

                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={formatAsExt4}
                    onChange={(e) => {
                      setFormatAsExt4(e.target.checked)
                      if (!e.target.checked) setConfirmErase(false)
                    }}
                  />
                  <span>
                    Format as ext4 if empty{" "}
                    <span className="text-destructive">(erases all data on this disk)</span>
                  </span>
                </label>

                {formatAsExt4 ? (
                  <label className="flex cursor-pointer items-start gap-2 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={confirmErase}
                      onChange={(e) => setConfirmErase(e.target.checked)}
                    />
                    <span>I understand this will erase everything on {selected.device}</span>
                  </label>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={disabled || mountMutation.isPending}
                  onClick={handleMountClick}
                >
                  {mountMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <HardDriveDownload className="size-3.5" />
                  )}
                  Mount this drive
                </Button>
              </>
            )}

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              After mounting, Arciin rescans and selects the new volume so you can transfer to{" "}
              <span className="font-mono">{selected.suggestedArciinPath}</span>.
            </p>
          </div>
        ) : null}

        <Collapsible open={showSshHelp} onOpenChange={setShowSshHelp}>
          <CollapsibleTrigger
            type="button"
            className="group flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-[11px] font-medium text-foreground hover:bg-muted/25"
          >
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Manual mount over SSH (optional)</span>
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                showSshHelp && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <UnmountedMountInstructions
              devices={showSshHelp && selected ? [selected] : devices}
              theme="dark"
            />
          </CollapsibleContent>
        </Collapsible>
      </section>

      <AlertDialog open={mountDialogOpen} onOpenChange={setMountDialogOpen}>
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Enter server sudo password</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-muted-foreground">
              Mounting <span className="font-mono text-foreground">{selected?.device}</span> needs
              your Linux user password on this machine. It is sent only to the local API and is not
              stored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="mount-sudo-dialog" className="text-[11px]">
              Sudo password
            </Label>
            <Input
              ref={sudoInputRef}
              id="mount-sudo-dialog"
              type="password"
              autoComplete="current-password"
              value={sudoPassword}
              onChange={(e) => {
                setSudoPassword(e.target.value)
                setSudoError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleDialogMount()
                }
              }}
              className={cn(
                "h-10 border-border bg-background text-foreground",
                sudoError && "border-destructive ring-destructive/30",
              )}
              placeholder="Your Linux login password"
            />
            {sudoError ? (
              <p className="text-[11px] text-destructive">{sudoError}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mountMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              disabled={mountMutation.isPending}
              onClick={handleDialogMount}
              className="gap-2"
            >
              {mountMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="size-3.5" />
              )}
              Mount drive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
