"use client"

import { useState } from "react"
import { AlertCircle, Copy, RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { DuplicateConflict } from "@/lib/stores/upload-store"

type Resolution = DuplicateConflict["resolution"]

const RESOLUTIONS: { value: NonNullable<Resolution>; label: string; description: string }[] = [
  { value: "replace",   label: "Replace",   description: "Overwrite the existing file" },
  { value: "keep-both", label: "Keep both", description: "Rename to filename (1).ext"  },
  { value: "skip",      label: "Skip",      description: "Don't upload this file"       },
]

function ResolutionButton({
  value,
  selected,
  onClick,
}: {
  value: NonNullable<Resolution>
  selected: boolean
  onClick: () => void
}) {
  const cfg = RESOLUTIONS.find((r) => r.value === value)!
  const Icon = value === "replace" ? RefreshCw : value === "keep-both" ? Copy : X
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-center transition-colors"
      style={{
        background: selected ? "rgba(255,79,18,0.08)" : "rgba(255,255,255,0.02)",
        borderColor: selected ? "rgba(255,79,18,0.4)" : "rgba(255,255,255,0.08)",
        color: selected ? "#FF4F12" : "rgba(255,255,255,0.55)",
      }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-[11px] font-semibold leading-none">{cfg.label}</span>
    </button>
  )
}

export function DuplicateResolutionDialog({
  conflicts,
  onResolve,
  onCancel,
}: {
  conflicts: DuplicateConflict[]
  onResolve: (resolved: DuplicateConflict[]) => void
  onCancel: () => void
}) {
  const [resolutions, setResolutions] = useState<Record<string, NonNullable<Resolution>>>(() => {
    const init: Record<string, NonNullable<Resolution>> = {}
    conflicts.forEach((c) => { init[c.file.name] = "keep-both" })
    return init
  })

  function setAll(res: NonNullable<Resolution>) {
    const next: Record<string, NonNullable<Resolution>> = {}
    conflicts.forEach((c) => { next[c.file.name] = res })
    setResolutions(next)
  }

  function setOne(filename: string, res: NonNullable<Resolution>) {
    setResolutions((prev) => ({ ...prev, [filename]: res }))
  }

  function handleConfirm() {
    const resolved = conflicts.map((c) => ({
      ...c,
      resolution: resolutions[c.file.name] ?? "keep-both",
    }))
    onResolve(resolved)
  }

  const allSame = new Set(Object.values(resolutions)).size === 1
    ? (Object.values(resolutions)[0] as NonNullable<Resolution>)
    : null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(255,79,18,0.12)" }}>
            <AlertCircle className="h-4 w-4 text-[#FF4F12]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-white">
              {conflicts.length === 1 ? "File already exists" : `${conflicts.length} files already exist`}
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              How should Arciin handle the conflict{conflicts.length > 1 ? "s" : ""}?
            </p>
          </div>
        </div>

        {/* Apply-to-all strip */}
        {conflicts.length > 1 && (
          <div className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}>
            <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.35)" }}>Apply to all:</span>
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setAll(r.value)}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: allSame === r.value ? "rgba(255,79,18,0.12)" : "rgba(255,255,255,0.05)",
                  color: allSame === r.value ? "#FF4F12" : "rgba(255,255,255,0.5)",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* Conflict list */}
        <div className="max-h-64 overflow-y-auto">
          {conflicts.map((conflict) => {
            const selected = resolutions[conflict.file.name] ?? "keep-both"
            return (
              <div
                key={conflict.file.name}
                className="flex flex-col gap-2 px-5 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                <p className="truncate text-[12px] font-medium text-white" title={conflict.file.name}>
                  {conflict.file.name}
                </p>
                <div className="flex gap-2">
                  {RESOLUTIONS.map((r) => (
                    <ResolutionButton
                      key={r.value}
                      value={r.value}
                      selected={selected === r.value}
                      onClick={() => setOne(conflict.file.name, r.value)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="rounded-lg border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            className="rounded-lg bg-[#FF4F12] text-white hover:bg-[#e04410]"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
