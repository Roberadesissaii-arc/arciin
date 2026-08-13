"use client"

import { useState } from "react"
import {
  Check,
  Copy,
  HardDrive,
  ShieldAlert,
  Terminal,
} from "lucide-react"

import type { UnmountedBlockDevice } from "@/lib/types/models"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type InstructionTheme = "light" | "dark"

type MountStep = {
  title: string
  detail: string
  command: string
  warning?: boolean
}

function buildCommands(device: UnmountedBlockDevice): MountStep[] {
  return [
    {
      title: "Create mount point",
      detail: "Empty folder where this disk will be attached.",
      command: `sudo mkdir -p ${device.suggestedMountPoint}`,
    },
    {
      title: "Format (only if empty)",
      detail: "Skip this if the disk already has data you want to keep.",
      command: `sudo mkfs.ext4 -L arciin-data ${device.device}`,
      warning: true,
    },
    {
      title: "Persist in fstab",
      detail: "So the disk remounts after reboot.",
      command: `echo '${device.device} ${device.suggestedMountPoint} ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab`,
    },
    {
      title: "Mount now",
      detail: "Apply fstab and attach the filesystem.",
      command: "sudo mount -a",
    },
    {
      title: "Fix ownership",
      detail: "Let your user write into the mount.",
      command: `sudo chown -R $(id -u):$(id -g) ${device.suggestedMountPoint}`,
    },
  ]
}

function CopyLine({
  command,
  theme,
}: {
  command: string
  theme: InstructionTheme
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 rounded-xl border px-3 py-2.5 font-mono text-[11px] leading-relaxed",
        theme === "light"
          ? "border-zinc-200/90 bg-zinc-950 text-zinc-100"
          : "border-white/10 bg-black/40 text-zinc-200",
      )}
    >
      <Terminal
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          theme === "light" ? "text-[#ff6a30]" : "text-white/50",
        )}
      />
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all">{command}</pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(
          "shrink-0 opacity-80 transition-opacity hover:opacity-100",
          theme === "light"
            ? "text-zinc-300 hover:bg-white/10 hover:text-white"
            : "text-zinc-400 hover:bg-white/10 hover:text-white",
        )}
        aria-label="Copy command"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  )
}

export function UnmountedMountInstructions({
  devices,
  compact = false,
  theme = "light",
}: {
  devices: UnmountedBlockDevice[]
  compact?: boolean
  theme?: InstructionTheme
}) {
  if (!devices.length) return null

  if (compact) {
    return (
      <ul className="space-y-2">
        {devices.map((device) => (
          <li
            key={device.id}
            className={cn(
              "rounded-xl border px-3 py-2 text-[11px]",
              theme === "light"
                ? "border-zinc-200 bg-zinc-50 text-zinc-600"
                : "border-white/10 bg-white/[0.03] text-zinc-400",
            )}
          >
            <p className={theme === "light" ? "font-medium text-zinc-900" : "font-medium text-zinc-200"}>
              {device.device} · {device.sizeLabel}
            </p>
            <p className="mt-1 font-mono text-[10px] text-zinc-500">
              → {device.suggestedMountPoint}
            </p>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "rounded-2xl border px-4 py-3 text-[12px] leading-relaxed",
          theme === "light"
            ? "border-amber-200/80 bg-amber-50/90 text-amber-950"
            : "border-amber-500/25 bg-amber-500/10 text-amber-100",
        )}
      >
        <div className="flex gap-2.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">SSH into this server first</p>
            <p className="mt-0.5 opacity-90">
              Run each command on the host, not in the browser. Formatting erases the disk — only
              format empty drives.
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-4">
        {devices.map((device) => {
          const steps = buildCommands(device)
          return (
            <li
              key={device.id}
              className={cn(
                "overflow-hidden rounded-2xl border shadow-sm",
                theme === "light"
                  ? "border-zinc-200/90 bg-white"
                  : "border-white/10 bg-white/[0.04]",
              )}
            >
              <div
                className={cn(
                  "flex items-start gap-3 border-b px-4 py-3.5",
                  theme === "light" ? "border-zinc-100 bg-zinc-50/80" : "border-white/10 bg-white/[0.03]",
                )}
              >
                <div
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-xl border",
                    theme === "light"
                      ? "border-[#ffcab5] bg-[#fff5f0] text-[#ff4f12]"
                      : "border-white/15 bg-white/10 text-white/80",
                  )}
                >
                  <HardDrive className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate font-heading text-[14px] font-semibold",
                      theme === "light" ? "text-zinc-900" : "text-white",
                    )}
                  >
                    {device.device}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        theme === "light"
                          ? "bg-zinc-900 text-white"
                          : "bg-white/15 text-white/90",
                      )}
                    >
                      {device.sizeLabel}
                    </span>
                    {device.filesystem ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          theme === "light"
                            ? "bg-zinc-100 text-zinc-600"
                            : "bg-white/10 text-white/70",
                        )}
                      >
                        {device.filesystem}
                      </span>
                    ) : null}
                    {device.isLuks ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        LUKS
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        theme === "light"
                          ? "bg-[#fff0e9] text-[#c2410c]"
                          : "bg-[#ff4f12]/20 text-[#ffb59a]",
                      )}
                    >
                      → {device.suggestedArciinPath}
                    </span>
                  </div>
                </div>
              </div>

              <ol className="space-y-3 px-4 py-4">
                {steps.map((step, index) => (
                  <li key={step.title} className="space-y-1.5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                          step.warning
                            ? "bg-amber-100 text-amber-800"
                            : theme === "light"
                              ? "bg-[#ff4f12] text-white"
                              : "bg-white/15 text-white",
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[12.5px] font-semibold",
                            theme === "light" ? "text-zinc-900" : "text-white",
                          )}
                        >
                          {step.title}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[11px] leading-snug",
                            theme === "light" ? "text-zinc-500" : "text-white/55",
                          )}
                        >
                          {step.detail}
                        </p>
                      </div>
                    </div>
                    <div className="pl-8">
                      <CopyLine command={step.command} theme={theme} />
                    </div>
                  </li>
                ))}
              </ol>

              <div
                className={cn(
                  "border-t px-4 py-3 text-[11px] leading-relaxed",
                  theme === "light"
                    ? "border-zinc-100 bg-zinc-50/70 text-zinc-600"
                    : "border-white/10 bg-white/[0.03] text-white/60",
                )}
              >
                After mounting, pick this location in setup storage — path{" "}
                <code
                  className={cn(
                    "rounded px-1 py-0.5 font-mono text-[10.5px]",
                    theme === "light" ? "bg-white text-zinc-800" : "bg-black/30 text-white/80",
                  )}
                >
                  {device.suggestedArciinPath}
                </code>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
