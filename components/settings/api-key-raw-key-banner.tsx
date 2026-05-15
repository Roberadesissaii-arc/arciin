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
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-zinc-800">{title}</div>
          <p
            className="mt-1.5 font-mono text-[13px] leading-snug tracking-tight text-zinc-700"
            title={rawKey}
          >
            {formatApiKeyPreview(rawKey)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">{hint}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
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
