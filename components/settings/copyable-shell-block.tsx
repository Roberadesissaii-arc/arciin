"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Could not copy to clipboard")
  }
}

export function CopyableShellBlock({
  title,
  description,
  script,
  copyLabel = "Copy script",
  className,
}: {
  title: string
  description?: string
  script: string
  copyLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className={cn("relative rounded-xl border border-zinc-800 bg-zinc-950", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          onClick={async () => {
            await copyText(script, copyLabel.replace(/^Copy\s+/i, ""))
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : copyLabel}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-relaxed text-zinc-100">
        <code>{script}</code>
      </pre>
    </div>
  )
}
