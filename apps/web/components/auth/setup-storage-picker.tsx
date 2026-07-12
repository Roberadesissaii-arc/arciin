"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { getStorageDiscovery, prepareStoragePath } from "@/lib/api/instance-storage"
import { UnmountedMountInstructions } from "@/components/storage/unmounted-mount-instructions"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { StorageDiscovery, StorageVolumeOption, UnmountedBlockDevice } from "@/lib/types/models"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const CUSTOM_CHOICE_ID = "__custom__"

function formatFree(option: StorageVolumeOption) {
  if (option.availableBytes == null) return "Space unknown"
  const total = option.totalBytes != null ? formatBytes(option.totalBytes) : "?"
  return `${formatBytes(option.availableBytes)} free of ${total}`
}

function volumeStatus(option: StorageVolumeOption) {
  const tags: string[] = []
  if (option.recommended) tags.push("Recommended")
  if (option.largeExternal) tags.push("More space")
  if (!option.writable) tags.push("Not writable yet")
  return tags
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

function selectedVolume(
  discovery: StorageDiscovery,
  choiceId: string | null,
): StorageVolumeOption | null {
  if (!choiceId || choiceId === CUSTOM_CHOICE_ID) return null
  return discovery.volumes.find((v) => v.id === choiceId) ?? null
}

function selectedDevice(
  discovery: StorageDiscovery,
  choiceId: string | null,
): UnmountedBlockDevice | null {
  if (!choiceId || choiceId === CUSTOM_CHOICE_ID) return null
  return discovery.unmountedDevices.find((d) => d.id === choiceId) ?? null
}

export function SetupStoragePicker({
  value,
  onChange,
  hint,
  errorMessage,
}: {
  value: string
  onChange: (path: string) => void
  hint?: string | null
  errorMessage?: string
}) {
  const [discovery, setDiscovery] = useState<StorageDiscovery | null>(null)
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [choiceId, setChoiceId] = useState<string | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)

  const customMode = choiceId === CUSTOM_CHOICE_ID
  const activeVolume = discovery ? selectedVolume(discovery, choiceId) : null
  const activeDevice = discovery ? selectedDevice(discovery, choiceId) : null

  const selectPlaceholder = useMemo(() => {
    if (loading) return "Scanning disks…"
    if (!discovery?.volumes.length && !discovery?.unmountedDevices.length) {
      return "No locations found"
    }
    return "Choose a storage location"
  }, [discovery, loading])

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
        } else {
          setChoiceId(resolveChoiceId(value, data))
        }
      })
      .catch(() => {
        if (!cancelled) setDiscovery(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed default once on load
  }, [])

  const selectVolume = async (option: StorageVolumeOption) => {
    setChoiceId(option.id)
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

  const handleChoiceChange = (nextId: string) => {
    if (!discovery) return

    setChoiceId(nextId)
    setPrepareError(null)

    if (nextId === CUSTOM_CHOICE_ID) {
      return
    }

    const volume = discovery.volumes.find((v) => v.id === nextId)
    if (volume) {
      void selectVolume(volume)
      return
    }

    const device = discovery.unmountedDevices.find((d) => d.id === nextId)
    if (device) {
      onChange(device.suggestedArciinPath)
      setPrepareError("Mount this drive on the server first, then rescan.")
    }
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex h-11 items-center gap-2 rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] px-4 text-sm text-[#a0a0a0]">
          <Loader2 className="size-3.5 animate-spin" />
          Scanning disks…
        </div>
      ) : discovery ? (
        <>
          <Select
            value={choiceId ?? undefined}
            onValueChange={handleChoiceChange}
            disabled={preparing}
          >
            <SelectTrigger
              className="h-11 w-full rounded-2xl border-[#e8e8e8] bg-[#f7f7f7] px-4 text-left text-sm text-[#222222] shadow-none [&_svg]:text-[#c0c0c0]"
              size="default"
            >
              <SelectValue placeholder={selectPlaceholder} />
            </SelectTrigger>
            <SelectContent
              surface="dashboard"
              position="popper"
              align="start"
              viewportClassName="max-h-56 min-w-[var(--radix-select-trigger-width)]"
            >
              {discovery.volumes.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Mounted locations</SelectLabel>
                  {discovery.volumes.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      textValue={option.label}
                      className="py-2"
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="truncate">{option.label}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatFree(option)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}

              {discovery.unmountedDevices.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Unmounted drives</SelectLabel>
                  {discovery.unmountedDevices.map((device) => (
                    <SelectItem
                      key={device.id}
                      value={device.id}
                      textValue={`${device.device} ${device.sizeLabel}`}
                      className="py-2"
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="truncate">
                          {device.device}{" "}
                          <span className="text-muted-foreground">({device.sizeLabel})</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-amber-600">Mount first</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}

              <SelectGroup>
                <SelectItem value={CUSTOM_CHOICE_ID} textValue="Custom path">
                  Custom path…
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          {!customMode && (activeVolume || activeDevice) ? (
            <div className="rounded-2xl border border-[#ececec] bg-white px-3.5 py-2.5">
              <p className="truncate font-mono text-[11px] text-[#717171]">
                {activeVolume?.arciinPath ?? activeDevice?.suggestedArciinPath}
              </p>
              {activeVolume ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#a0a0a0]">
                  <span>{formatFree(activeVolume)}</span>
                  {volumeStatus(activeVolume).map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "rounded px-1 py-px text-[10px] font-medium",
                        tag === "Not writable yet"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-[#fff0e9] text-[#e04a12]",
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : activeDevice ? (
                <p className="mt-1 text-[11px] text-amber-600">
                  Mount on the server before using this path.
                </p>
              ) : null}
            </div>
          ) : null}

          {discovery.unmountedDevices.length > 0 ? (
            <Sheet>
              <SheetTrigger
                type="button"
                className="text-[11px] font-medium text-[#a0a0a0] underline-offset-2 hover:text-[#555555] hover:underline"
              >
                {discovery.unmountedDevices.length} unmounted drive
                {discovery.unmountedDevices.length === 1 ? "" : "s"} — mount instructions
              </SheetTrigger>
              <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Mount unmounted drives</SheetTitle>
                  <SheetDescription>
                    Run on the server over SSH, then pick the drive from the dropdown and rescan.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4">
                  <UnmountedMountInstructions devices={discovery.unmountedDevices} />
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-[#a0a0a0]">
          Could not scan storage. Enter a custom path or run ./install.sh on the server.
        </p>
      )}

      {customMode || !discovery ? (
        <div className="flex items-center rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] px-4 py-3">
          <input
            id="storageRoot"
            value={value}
            onChange={(e) => {
              setChoiceId(CUSTOM_CHOICE_ID)
              onChange(e.target.value)
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[#222222] outline-none placeholder:text-[#c0c0c0]"
            spellCheck={false}
            autoComplete="off"
            placeholder="/srv/arciin-storage/arciin"
          />
        </div>
      ) : null}

      {hint ? <p className="px-1 text-[11px] leading-relaxed text-[#a0a0a0]">{hint}</p> : null}
      {prepareError ? <p className="px-1 text-[11px] text-amber-600">{prepareError}</p> : null}
      {errorMessage ? (
        <p className="px-1 text-[11px] font-medium text-[#dc2626]" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {preparing ? (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-[#a0a0a0]">
          <Loader2 className="size-3 animate-spin" />
          Preparing folder…
        </p>
      ) : null}
    </div>
  )
}
