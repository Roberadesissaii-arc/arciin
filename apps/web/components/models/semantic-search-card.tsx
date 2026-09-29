"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Search } from "lucide-react"

import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ApiError } from "@/lib/api/errors"
import { queryKeys } from "@/lib/api/query-keys"
import {
  getSemanticSearchStatus,
  installSemanticModel,
  pauseSemanticIndexing,
  rebuildSemanticIndex,
  setSemanticSearchEnabled,
  startSemanticIndexing,
  type SemanticSearchStatus,
} from "@/lib/api/semantic-search"
import { toast } from "@/lib/notifications/arciin-toast"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

/**
 * Semantic search, local and owner-controlled. Nothing runs until the owner
 * turns it on and starts indexing; the model is installed only by pressing
 * Install. Everything happens on this server's Ollama.
 */

const MODEL_STATE: Record<SemanticSearchStatus["model"]["state"], { text: string; tone: string }> = {
  installed: { text: "Installed", tone: "text-emerald-700" },
  missing: { text: "Not installed", tone: "text-amber-700" },
  ollama_offline: { text: "Ollama offline", tone: "text-red-600" },
  not_local: { text: "Ollama URL is not local", tone: "text-red-600" },
}

const INDEX_STATE: Record<SemanticSearchStatus["index"]["state"], string> = {
  off: "Off",
  not_indexed: "Not indexed",
  indexing: "Indexing",
  paused: "Paused",
  ready: "Ready",
}

export function semanticIndexPercent(status: SemanticSearchStatus): number {
  const done = status.index.indexed + status.index.skipped
  return status.index.eligible > 0 ? Math.min(100, Math.floor((done / status.index.eligible) * 100)) : 0
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-zinc-800">{children}</span>
    </div>
  )
}

export function SemanticSearchCard() {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: queryKeys.semanticSearchStatus,
    queryFn: ({ signal }) => getSemanticSearchStatus(signal),
    retry: false,
    // Live while something is moving; quiet otherwise.
    refetchInterval: (q) => {
      const d = q.state.data
      return d && (d.install?.state === "running" || d.index.state === "indexing") ? 5_000 : false
    },
  })
  const act = useMutation({
    mutationFn: (fn: () => Promise<SemanticSearchStatus>) => fn(),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.semanticSearchStatus, data),
    onError: (error) => toast.error(error instanceof Error ? error.message : "That did not work."),
  })

  // Owner-only: anyone else simply does not see the card.
  if (statusQuery.error instanceof ApiError && (statusQuery.error.status === 403 || statusQuery.error.status === 401)) return null
  const status = statusQuery.data
  const busy = act.isPending

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-testid="semantic-search-card" aria-label="Semantic search">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-primary">
            <Search className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-zinc-900">Semantic search</h2>
            <p className="text-[12px] leading-snug text-zinc-500">
              Find files by what they show or are about — “birthday party”, “invoice”. Runs on this server only.
            </p>
          </div>
        </div>
        {status ? (
          <Button
            size="sm"
            variant={status.enabled ? "outline" : "default"}
            disabled={busy}
            onClick={() => act.mutate(() => setSemanticSearchEnabled(!status.enabled))}
            data-testid="semantic-toggle"
          >
            {status.enabled ? "Turn off" : "Enable"}
          </Button>
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Checking…
        </p>
      ) : statusQuery.isError || !status ? (
        <p className="mt-3 text-[12px] text-red-600">Could not load semantic search status.</p>
      ) : (
        <>
          <div className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200/80 px-3" data-testid="semantic-status">
            <Row label="Semantic search">{status.enabled ? "On" : "Off"}</Row>
            <Row label="Provider">{status.provider}</Row>
            <Row label="Embedding model">{status.embeddingModel}</Row>
            <Row label="Model status">
              <span className={MODEL_STATE[status.model.state].tone} data-testid="semantic-model-state">
                {MODEL_STATE[status.model.state].text}
                {status.model.state === "installed" && status.model.sizeBytes ? ` · ${formatBytes(status.model.sizeBytes)}` : ""}
              </span>
            </Row>
            <Row label="Image captions">{status.captionModel ?? "No local vision model — text only"}</Row>
            <Row label="Index">
              <span data-testid="semantic-index-state">{INDEX_STATE[status.index.state]}</span>
            </Row>
            <Row label="Indexed">
              <span className="tabular-nums" data-testid="semantic-index-counts">
                {status.index.indexed.toLocaleString()} / {status.index.eligible.toLocaleString()} files
                {status.index.pending ? ` · ${status.index.pending.toLocaleString()} pending` : ""}
                {status.index.failed ? ` · ${status.index.failed.toLocaleString()} failed` : ""}
              </span>
            </Row>
          </div>

          {status.enabled && status.index.eligible > 0 ? (
            <Progress value={semanticIndexPercent(status)} className="mt-3 h-1.5" aria-label="Indexing progress" />
          ) : null}

          {status.model.state === "missing" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-testid="semantic-model-missing">
              Semantic search needs a local embedding model ({status.embeddingModel}).
              {status.install?.state === "running" ? (
                <span className="mt-1 block tabular-nums">
                  Installing…{" "}
                  {status.install.total ? `${formatBytes(status.install.completed ?? 0)} of ${formatBytes(status.install.total)}` : ""}
                </span>
              ) : status.install?.state === "failed" ? (
                <span className="mt-1 block">The install did not finish. Try again.</span>
              ) : null}
            </div>
          ) : null}
          {status.model.state === "ollama_offline" ? (
            <p className="mt-3 text-[12px] text-zinc-600" data-testid="semantic-offline">
              Ollama is not running on this server. Search keeps working by name; meaning comes back when Ollama does.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {status.model.state === "missing" ? (
              <ConfirmDestructiveButton
                variant="default"
                title={`Install ${status.embeddingModel}?`}
                description={
                  <>
                    Downloads the {status.embeddingModel} embedding model (about 275 MB) into this
                    server&apos;s Ollama. It runs locally; nothing from your library is sent anywhere.
                  </>
                }
                confirmLabel="Install model"
                disabled={busy || status.install?.state === "running"}
                onConfirm={() => act.mutateAsync(installSemanticModel)}
                data-testid="semantic-install"
              >
                Install model
              </ConfirmDestructiveButton>
            ) : null}
            {status.enabled && status.model.state === "installed" ? (
              status.indexingActive ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate(pauseSemanticIndexing)}>
                  Pause indexing
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => act.mutate(startSemanticIndexing)} data-testid="semantic-index">
                  Index library
                </Button>
              )
            ) : null}
            {status.enabled && status.model.state === "installed" && status.index.indexed > 0 ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate(rebuildSemanticIndex)}>
                Rebuild
              </Button>
            ) : null}
          </div>
          <p className={cn("mt-2 text-[11px] text-zinc-400")}>
            Captions and vectors stay on this server. Keyword search is never replaced.
          </p>
        </>
      )}
    </section>
  )
}
