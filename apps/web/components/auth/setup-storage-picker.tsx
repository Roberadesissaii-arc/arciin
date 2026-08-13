"use client"

import { useEffect, useState } from "react"
import {
  Check,
  HardDrive,
  Loader2,
  PencilLine,
  Sparkles,
  Usb,
} from "lucide-react"

import { getStorageDiscovery, prepareStoragePath } from "@/lib/api/instance-storage"
import { UnmountedMountInstructions } from "@/components/storage/unmounted-mount-instructions"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { StorageDiscovery, StorageVolumeOption, UnmountedBlockDevice } from "@/lib/types/models"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const CUSTOM_CHOICE_ID = "__custom__"

function freeRatio(option: StorageVolumeOption) {
  if (option.availableBytes == null || option.totalBytes == null || option.totalBytes <= 0) {
    return null
  }
  return Math.min(1, Math.max(0, option.availableBytes / option.totalBytes))
}

function formatFreeShort(option: StorageVolumeOption) {
  if (option.availableBytes == null) return "Space unknown"
  return `${formatBytes(option.availableBytes)} free`
}

function resolveChoiceId(value: string, discovery: StorageDiscovery): string {
  const volume = discovery.volumes.find((v) => v.arciinPath === value)
  if (volume) return volume.id
  const device = discovery.unmountedDevices.find((d) => d.suggestedArciinPath === value)
  if (device) return device.id
  if (value.trim()) return CUSTOM_CHOICE_ID
  const rec = discovery.volumes.find((v) => v.recommended) ?? discovery.volumes[0]
  return rec?.id ?? CUSTOM_CHOICE_ID
}

export function SetupStoragePicker({
  value,
  onChange,
  hint,
  errorMessage,
  compact = true,
}: {
  value: string
  onChange: (path: string) => void
  hint?: string | null
  errorMessage?: string
  /** Tighter layout for the multi-step setup wizard. */
  compact?: boolean
}) {
  const [discovery, setDiscovery] = useState<StorageDiscovery | null>(null)
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [choiceId, setChoiceId] = useState<string | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)

  const customMode = choiceId === CUSTOM_CHOICE_ID || showCustom

  useEffect(() => {
    let cancelled = false
    void getStorageDiscovery()
      .then((data) => {
        if (cancelled) return
        setDiscovery(data)
        if (!value.trim()) {
          onChange(data.recommendedArciinPath)
          const rec = data.volumes.find((v) => v.recommended) ?? data.volumes[0]
          setChoiceId(rec?.id ?? CUSTOM_CHOICE_ID)
          setShowCustom(!rec)
        } else {
          const id = resolveChoiceId(value, data)
          setChoiceId(id)
          setShowCustom(id === CUSTOM_CHOICE_ID)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiscovery(null)
          setShowCustom(true)
          setChoiceId(CUSTOM_CHOICE_ID)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed default once on load
  }, [])

  const selectVolume = async (option: StorageVolumeOption) => {
    setChoiceId(option.id)
    setShowCustom(false)
    setPrepareError(null)
    setPreparing(true)
    try {
      const result = await prepareStoragePath(option.arciinPath)
      onChange(result.arciinPath)
      if (!result.writable) {
        setPrepareError(
          "Folder is not writable yet. Run ./install.sh on the server or fix permissions.",
        )
      }
    } catch {
      onChange(option.arciinPath)
      setPrepareError("Could not prepare this folder. Create it on the server, then select again.")
    } finally {
      setPreparing(false)
    }
  }

  const selectDevice = (device: UnmountedBlockDevice) => {
    setChoiceId(device.id)
    setShowCustom(false)
    onChange(device.suggestedArciinPath)
    setPrepareError("Mount this drive on the server first, then rescan.")
  }

  const enableCustom = () => {
    setChoiceId(CUSTOM_CHOICE_ID)
    setShowCustom(true)
    setPrepareError(null)
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border border-[#ececec] bg-[#fafafa] px-3 text-sm text-[#a0a0a0]",
          compact ? "h-12" : "h-16",
        )}
      >
        <Loader2 className="size-3.5 animate-spin text-[#ff4f12]" />
        Scanning disks…
      </div>
    )
  }

  const volumes = discovery?.volumes ?? []
  const unmounted = discovery?.unmountedDevices ?? []
  const recommended = volumes.find((v) => v.recommended) ?? volumes[0]
  const others = volumes.filter((v) => v.id !== recommended?.id)

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {discovery && recommended ? (
        <button
          type="button"
          disabled={preparing}
          onClick={() => void selectVolume(recommended)}
          className={cn(
            "group relative w-full overflow-hidden rounded-2xl border text-left transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f12]/35",
            choiceId === recommended.id && !customMode
              ? "border-[#ffb59a] bg-gradient-to-br from-[#fff8f4] to-white shadow-[0_1px_0_rgba(255,79,18,0.08)]"
              : "border-[#ececec] bg-white hover:border-[#e0e0e0]",
            compact ? "px-3.5 py-3.5" : "p-3.5",
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                choiceId === recommended.id && !customMode
                  ? "border-[#ffcab5] bg-white text-[#ff4f12]"
                  : "border-[#f0f0f0] bg-[#f7f7f7] text-[#8a8a8a]",
              )}
            >
              <HardDrive className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-[#111111]">
                  {recommended.label}
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[#ff4f12]/10 px-1.5 py-px text-[10px] font-semibold text-[#e04a12]">
                  <Sparkles className="size-2.5" />
                  Recommended
                </span>
                {choiceId === recommended.id && !customMode ? (
                  <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-[#ff4f12] text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-[#8a8a8a]">
                {recommended.arciinPath}
              </p>
              {(() => {
                const ratio = freeRatio(recommended)
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-[#a0a0a0]">
                      <span>{formatFreeShort(recommended)}</span>
                      {recommended.totalBytes != null ? (
                        <span className="tabular-nums">
                          of {formatBytes(recommended.totalBytes)}
                        </span>
                      ) : null}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#f0f0f0]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#ff4f12] to-[#ff8a55]"
                        style={{ width: `${ratio != null ? Math.round(ratio * 100) : 62}%` }}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </button>
      ) : null}

      {(others.length > 0 || unmounted.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((option) => {
            const selected = choiceId === option.id && !customMode
            return (
              <button
                key={option.id}
                type="button"
                disabled={preparing}
                onClick={() => void selectVolume(option)}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                  selected
                    ? "border-[#ffb59a] bg-[#fff5f0] text-[#c2410c]"
                    : "border-[#ececec] bg-white text-[#555555] hover:border-[#ddd]",
                )}
                title={option.arciinPath}
              >
                <HardDrive className="size-3 shrink-0 opacity-70" />
                <span className="truncate">{option.label}</span>
                <span className="shrink-0 text-[10px] font-normal text-[#a0a0a0]">
                  {formatFreeShort(option)}
                </span>
              </button>
            )
          })}
          {unmounted.map((device) => {
            const selected = choiceId === device.id && !customMode
            return (
              <button
                key={device.id}
                type="button"
                disabled={preparing}
                onClick={() => selectDevice(device)}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                  selected
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-[#ececec] bg-white text-[#555555] hover:border-[#ddd]",
                )}
                title={device.suggestedArciinPath}
              >
                <Usb className="size-3 shrink-0 opacity-70" />
                <span className="truncate">
                  {device.device} · {device.sizeLabel}
                </span>
                <span className="shrink-0 text-[10px] font-normal text-amber-600">Mount</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={enableCustom}
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 transition-colors",
            customMode ? "text-[#ff4f12]" : "text-[#a0a0a0] hover:text-[#555555] hover:underline",
          )}
        >
          <PencilLine className="size-3" />
          Custom path
        </button>
        {unmounted.length > 0 ? (
          <Sheet>
            <SheetTrigger
              type="button"
              className="text-[11px] font-medium text-[#a0a0a0] underline-offset-2 hover:text-[#555555] hover:underline"
            >
              Mount guide ({unmounted.length})
            </SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Mount unmounted drives</SheetTitle>
                <SheetDescription>
                  Run on the server over SSH, then pick the drive again.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <UnmountedMountInstructions devices={unmounted} />
              </div>
            </SheetContent>
          </Sheet>
        ) : null}
        {preparing ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#a0a0a0]">
            <Loader2 className="size-3 animate-spin" />
            Preparing…
          </span>
        ) : null}
      </div>

      {customMode ? (
        <div className="flex items-center rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] px-3.5 py-2.5">
          <input
            id="storageRoot"
            value={value}
            onChange={(e) => {
              setChoiceId(CUSTOM_CHOICE_ID)
              setShowCustom(true)
              onChange(e.target.value)
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[#222222] outline-none placeholder:text-[#c0c0c0]"
            spellCheck={false}
            autoComplete="off"
            placeholder="/srv/arciin-storage/arciin"
          />
        </div>
      ) : null}

      {!discovery ? (
        <p className="text-[11px] text-[#a0a0a0]">
          Could not scan storage. Enter a custom path or re-run install on the server.
        </p>
      ) : null}

      {hint && !compact ? (
        <p className="px-0.5 text-[11px] leading-relaxed text-[#a0a0a0]">{hint}</p>
      ) : null}
      {prepareError ? <p className="px-0.5 text-[11px] text-amber-600">{prepareError}</p> : null}
      {errorMessage ? (
        <p className="px-0.5 text-[11px] font-medium text-[#dc2626]" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}
