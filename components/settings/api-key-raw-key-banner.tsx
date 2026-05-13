"use client"

import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

/** Short preview — full value is copy-only, no horizontal scroll. */
export function formatApiKeyPreview(key: string, head = 14, tail = 6) {
  const gap = 3
  if (key.length <= head + tail + gap) {
    return key
  }
  return `${key.slice(0, head)}…${key.slice(-tail)}`
}

export function ApiKeyRawKeyBanner({
  rawKey,
  title = "Generated key",
  hint = "Copy now — this is the only time the full key is shown.",
}: {
  rawKey: string
  title?: string
  hint?: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 backdrop-blur-sm">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[rgba(255,255,255,0.95)]">{title}</div>
          <p
            className="mt-1.5 font-mono text-[13px] leading-snug tracking-tight text-zinc-400"
            title={rawKey}
          >
            {formatApiKeyPreview(rawKey)}
          </p>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">{hint}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-white/[0.1] bg-white/[0.06] text-zinc-100 hover:bg-white/[0.1]"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(rawKey)
              toast.success("Key copied to clipboard.")
            } catch {
              toast.error("Could not copy — try selecting the key manually.")
            }
          }}
        >
          <Copy className="size-4" />
          Copy
        </Button>
      </div>
    </div>
  )
}
