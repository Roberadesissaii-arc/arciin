"use client"

import { useEffect, useState } from "react"
import { HardDrive, Loader2 } from "lucide-react"

import { getStorageDiscovery, prepareStoragePath } from "@/lib/api/instance-storage"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { StorageDiscovery, StorageVolumeOption } from "@/lib/types/models"
import { FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

function formatFree(option: StorageVolumeOption) {
  if (option.availableBytes == null) return "Space unknown"
  const total = option.totalBytes != null ? formatBytes(option.totalBytes) : "?"
  return `${formatBytes(option.availableBytes)} free of ${total}`
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getStorageDiscovery()
      .then((data) => {
        if (cancelled) return
        setDiscovery(data)
        if (!value.trim()) {
          onChange(data.recommendedArciinPath)
          const rec = data.volumes.find((v) => v.recommended) ?? data.volumes[0]
          if (rec) setSelectedId(rec.id)
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
    setSelectedId(option.id)
    setPrepareError(null)
    setPreparing(true)
    try {
      const result = await prepareStoragePath(option.arciinPath)
      onChange(result.arciinPath)
      if (!result.writable) {
        setPrepareError(
          "Directory exists but is not writable by the API. Fix ownership or run ./install.sh / ./scripts/docker-setup.sh on the server.",
        )
      }
    } catch {
      onChange(option.arciinPath)
      setPrepareError(
        "Could not prepare this folder from the browser. Create it on the server (install.sh or docker-setup.sh), then select again.",
      )
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="space-y-3">
      <FieldDescription className="text-xs leading-relaxed text-zinc-400">
        Choose where files live on disk. Prefer a large SSD or HDD — not the small OS card on Raspberry Pi
        unless that is your only drive. Formatting or partitioning must be done on the server (installer
        prompts); this step only picks the folder path.
      </FieldDescription>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin" />
          Scanning disks and mount points…
        </div>
      ) : discovery ? (
        <>
          <ul className="max-h-[min(280px,40vh)] space-y-2 overflow-y-auto pr-1">
            {discovery.volumes.map((option) => {
              const selected = selectedId === option.id || value === option.arciinPath
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={preparing}
                    onClick={() => void selectVolume(option)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary/50 bg-primary/[0.08]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20",
                      preparing && "opacity-60",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <HardDrive
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          option.largeExternal ? "text-primary" : "text-zinc-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-white">{option.label}</p>
                        <p className="truncate font-mono text-[11px] text-zinc-400">{option.arciinPath}</p>
                        <p className="text-[11px] text-zinc-500">{formatFree(option)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-6">
                      {option.recommended ? (
                        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          Recommended
                        </span>
                      ) : null}
                      {option.largeExternal ? (
                        <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                          More space than OS disk
                        </span>
                      ) : null}
                      {!option.writable ? (
                        <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                          Not writable yet
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {discovery.unmountedDevices?.length ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              <p className="font-medium text-amber-200/90">Unmounted drive(s) on this server</p>
              <p className="mt-1">
                Mount on the host first (SSH), then rescan setup or pick the folder below. Example:{" "}
                <span className="font-mono text-zinc-300">
                  {discovery.unmountedDevices[0]!.suggestedArciinPath}
                </span>
              </p>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-zinc-500">
                {discovery.unmountedDevices.map((d) => (
                  <li key={d.id}>
                    {d.device} ({d.sizeLabel}) → {d.suggestedMountPoint}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {discovery.installNotes.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
              {discovery.installNotes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Could not scan storage. Enter a path manually or run ./install.sh on the server first.
        </p>
      )}

      <Input
        value={value}
        onChange={(e) => {
          setSelectedId(null)
          onChange(e.target.value)
        }}
        className="h-11 font-mono text-[12px] rounded-lg border-white/10 bg-white/[0.03]"
        spellCheck={false}
        autoComplete="off"
        placeholder="/srv/arciin-storage/arciin"
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {prepareError ? (
        <p className="text-xs text-amber-500">{prepareError}</p>
      ) : null}
      {errorMessage ? (
        <p className="text-xs text-red-400" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {preparing ? (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="size-3 animate-spin" />
          Preparing folder…
        </p>
      ) : null}
    </div>
  )
}
