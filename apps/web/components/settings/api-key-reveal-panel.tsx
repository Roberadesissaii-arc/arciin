"use client"

import { useRef, type RefObject } from "react"
import { Copy, Key, ShieldAlert } from "lucide-react"

import { ApiKeyScopeBadges } from "@/components/settings/api-key-scope-badges"
import { ScrollFadeHint } from "@/components/settings/scroll-fade-hint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { notifyApiKey, notifyApiKeyError } from "@/lib/notifications/toast-actions"
import { copyFromField, copyTextNow, formatApiKeyPreview } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"

export function ApiKeyRevealPanel({
  rawKey,
  keyName,
  scopes,
  className,
  onCopied,
  copyFieldRef: copyFieldRefProp,
}: {
  rawKey: string
  keyName: string
  scopes: string[]
  className?: string
  onCopied?: () => void
  copyFieldRef?: RefObject<HTMLInputElement | null>
}) {
  const localInputRef = useRef<HTMLInputElement>(null)
  const inputRef = copyFieldRefProp ?? localInputRef
  const prefix = rawKey.slice(0, 12)
  const preview = formatApiKeyPreview(rawKey)

  const handleCopy = () => {
    const ok = copyTextNow(rawKey, inputRef.current)
    if (ok) {
      notifyApiKey("copied")
      onCopied?.()
      return
    }
    if (inputRef.current) {
      copyFromField(inputRef.current, rawKey)
    }
    notifyApiKeyError("Click the field, press Ctrl+A, then Ctrl+C (or Cmd+C).")
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="shrink-0 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-2 text-primary">
          <Key className="size-4 shrink-0" />
          <p className="text-[13px] font-semibold text-foreground">{keyName}</p>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Copy this secret now — Arciin will not show the full value again.
        </p>
      </div>

      <div className="shrink-0 space-y-2">
        <label htmlFor="api-key-secret" className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          API secret
        </label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id="api-key-secret"
            readOnly
            value={rawKey}
            title={rawKey}
            onFocus={(event) => event.currentTarget.select()}
            onDoubleClick={(event) => event.currentTarget.select()}
            className="h-10 min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
            aria-label={`API key ${preview}`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 shrink-0 border-border px-3"
            onMouseDown={(event) => {
              event.preventDefault()
              handleCopy()
            }}
          >
            <Copy className="size-4" />
            Copy
          </Button>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{preview}</p>
        <p className="text-[11px] text-muted-foreground">
          Prefix <span className="font-mono text-foreground">{prefix}</span> — the field holds the full secret even
          when truncated.
        </p>
      </div>

      <ScrollFadeHint className="min-h-0 flex-1" innerClassName="bg-muted/15 p-3">
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Granted scopes</p>
            <div className="mt-2">
              <ApiKeyScopeBadges scopes={scopes} maxVisible={4} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">How to use</p>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
              <li>
                REST:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  Authorization: Bearer &lt;key&gt;
                </code>
              </li>
              <li>Socket.IO monitors: pass this key when connecting to the events stream.</li>
              <li>Never commit the key to git — use a password manager or secrets file.</li>
            </ul>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] leading-relaxed text-amber-900/90">
              Revoke this key from API Keys if it is ever exposed.
            </p>
          </div>
        </div>
      </ScrollFadeHint>
    </div>
  )
}
