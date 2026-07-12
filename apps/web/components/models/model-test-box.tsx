"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FlaskConical, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getAvailableModels, testModelProfile } from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import { ApiError } from "@/lib/api/errors"

const DEFAULT_PROMPT = "Say hello from Arciin."

/** Small trigger — sits inline in the actions row beside Configure / Disconnect. */
export function ModelTestTrigger({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2.5 text-[12px]"
      aria-expanded={open}
      onClick={onToggle}
    >
      <FlaskConical className="size-3.5" />
      Test model
    </Button>
  )
}

/**
 * Free-tier connection test for connected Ollama profiles — one short prompt,
 * one short reply. Proves the key / local daemon works without full AI Chat.
 * Auto-picks a model that is actually installed/available so the test never
 * blocks on an unset profile default.
 */
export function ModelTestPanel({
  profileId,
  onClose,
}: {
  profileId: string
  onClose: () => void
}) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const availableQuery = useQuery({
    queryKey: queryKeys.availableModels(profileId),
    queryFn: ({ signal }) => getAvailableModels(profileId, { signal }),
    staleTime: 60_000,
  })

  const model = availableQuery.data?.models[0]
  const loadingModel = availableQuery.isLoading
  const noModelsFound = !loadingModel && !availableQuery.isError && !model

  async function run() {
    if (!model) return
    setRunning(true)
    setError(null)
    setReply(null)
    try {
      const result = await testModelProfile(profileId, {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        model,
      })
      setReply(result.reply)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed. Try again.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="w-full border-t border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-foreground">Test this model</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {loadingModel
              ? "Checking which models are installed…"
              : model
                ? `Ask a quick prompt to confirm your connection works — using ${model}.`
                : "Ask a quick prompt to confirm your connection works."}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close test panel"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="mt-2 flex gap-2">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running && model) void run()
          }}
          placeholder={DEFAULT_PROMPT}
          className="h-8 flex-1 text-[12px]"
          maxLength={200}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 bg-[color:var(--arciin-accent,#FF4F12)] px-3 text-[12px] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90"
          disabled={running || loadingModel || !model}
          onClick={() => void run()}
        >
          {running || loadingModel ? <Loader2 className="size-3.5 animate-spin" /> : "Run"}
        </Button>
      </div>

      {noModelsFound ? (
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800">
          No installed models found on this connection. Pull a model on the server, then reopen
          this panel.
        </p>
      ) : null}

      {reply ? (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Connection works
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
            {reply}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg border border-red-500/25 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
