"use client"

import Link from "next/link"
import { Cloud, HardDrive, Info, ShieldCheck } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DubsResponse, SeparationBackendInfo } from "@/lib/api/transcripts"

/**
 * Where the heavy separation runs.
 *
 * Separation is the expensive half of a dub and the half that reads the original
 * audio, which makes "local or cloud" a decision about someone's own media
 * rather than an implementation detail. So it is exposed, it is remembered, and
 * an explicit choice is never quietly substituted.
 *
 * Deliberately scoped to the separator. The voice model receives translated text
 * and performance direction either way, and this panel says so in the same
 * breath — otherwise "Local" reads as "nothing leaves this server", which would
 * be the most consequential piece of vagueness in the feature.
 */

export type SeparationMode = "auto" | "local" | "cloud"

const MODE_LABELS: Record<SeparationMode, string> = {
  auto: "Auto",
  local: "Local — this server",
  cloud: "Cloud — connected provider",
}

export function DubProcessing({
  processing,
  value,
  onChange,
  disabled = false,
}: {
  processing: DubsResponse["processing"]
  value: SeparationMode
  onChange: (mode: SeparationMode) => void
  disabled?: boolean
}) {
  const { local, cloud } = processing
  const chosen = effectiveBackend(value, local, cloud)

  return (
    <div className="space-y-2" data-testid="dub-processing">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Processing
      </p>

      <div>
        <p className="text-[11px] font-medium text-muted-foreground">Audio separation</p>
        <Select
          value={value}
          onValueChange={(next) => onChange(next as SeparationMode)}
          disabled={disabled}
        >
          <SelectTrigger
            size="default"
            className="mt-1 h-9 w-full min-w-0 rounded-lg border-border bg-muted/40 text-left text-[12.5px]"
            data-testid="dub-processing-mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-[220] w-[var(--radix-select-trigger-width)] rounded-xl border border-border bg-popover"
          >
            <SelectItem value="auto" className="cursor-pointer text-[12.5px]">
              {MODE_LABELS.auto}
            </SelectItem>
            <SelectItem
              value="local"
              disabled={!local.available}
              className="cursor-pointer text-[12.5px]"
            >
              {MODE_LABELS.local}
            </SelectItem>
            {/*
              Offered but not selectable when nothing is configured. Hiding it
              would suggest cloud separation does not exist; enabling it would
              promise something that could only fail after a long wait.
            */}
            <SelectItem
              value="cloud"
              disabled={!cloud.available}
              className="cursor-pointer text-[12.5px]"
            >
              {cloud.available ? `Cloud — ${cloud.label}` : MODE_LABELS.cloud}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── what this choice means ─────────────────────────────────────── */}
      {value === "cloud" && !cloud.available ? (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2"
          data-testid="dub-processing-cloud-unconfigured"
        >
          <p className="text-[12px] font-medium text-amber-700">
            No cloud audio-separation provider configured
          </p>
          <p className="mt-0.5 text-[11.5px] text-amber-700/90">
            Add one before choosing Cloud. Dubbing will not fall back to this server on its own.
          </p>
          <Link
            href="/settings"
            className="mt-1.5 inline-flex text-[11.5px] font-medium text-primary hover:underline"
            data-testid="dub-processing-configure"
          >
            Configure
          </Link>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2"
          data-testid="dub-processing-summary"
        >
          {chosen.kind === "local" ? (
            <HardDrive className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Cloud className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="space-y-0.5 text-[11.5px] leading-relaxed">
            <p className="font-medium text-foreground">
              {chosen.kind === "local" ? "Local — this server" : `Cloud — ${chosen.label}`}
              {value === "auto" ? " · chosen by Auto" : ""}
            </p>
            {chosen.kind === "local" ? (
              <>
                <p className="text-muted-foreground">
                  Private processing. No source audio is uploaded to separate it.
                </p>
                <p className="text-muted-foreground">
                  May be slow depending on this server&apos;s hardware.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                The source audio is sent to {chosen.label} to be separated.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * What actually leaves the instance, stated per provider.
 *
 * Two lines, never merged, because the two providers have different
 * responsibilities and different answers: with a local separator the media
 * genuinely does not leave, and the voice model still receives text regardless.
 * A single combined sentence would have to be either alarmist or misleading.
 */
export function DubPrivacyDisclosure({
  processing,
  mode,
}: {
  processing: DubsResponse["processing"]
  mode: SeparationMode
}) {
  const chosen = effectiveBackend(mode, processing.local, processing.cloud)

  return (
    <div className="space-y-1.5" data-testid="dub-privacy">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        What leaves this server
      </p>

      <dl className="space-y-1.5 text-[11.5px] leading-relaxed">
        <div>
          <dt className="font-medium text-foreground">Audio separation</dt>
          <dd className="text-muted-foreground" data-testid="dub-privacy-separation">
            {chosen.kind === "local"
              ? "Local — the source media stays on this server. Nothing is uploaded to separate it."
              : `Cloud — the source audio is sent to ${chosen.label} to be separated.`}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Voice generation</dt>
          <dd className="text-muted-foreground" data-testid="dub-privacy-voice">
            Gemini — the translated text and the voice directions are sent. The original recording
            is never uploaded to it.
          </dd>
        </div>
      </dl>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground/80">
        <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          Separator: {processing.local.engine ?? "—"} · Processing:{" "}
          {processing.local.compute ?? "—"}
        </span>
      </p>
    </div>
  )
}

/**
 * Which backend a mode resolves to, for display only.
 *
 * Mirrors the server's rule — local first when it exists — so the panel and the
 * job agree about what Auto will do. The server decides for real; this exists so
 * the reader is not told one thing and given another.
 */
function effectiveBackend(
  mode: SeparationMode,
  local: SeparationBackendInfo,
  cloud: SeparationBackendInfo,
): SeparationBackendInfo {
  if (mode === "local") return local
  if (mode === "cloud") return cloud
  return local.available ? local : cloud
}

/** Shared with the compact line beside the progress bar. */
export function processingLabel(
  mode: SeparationMode,
  processing: DubsResponse["processing"],
): string {
  const chosen = effectiveBackend(mode, processing.local, processing.cloud)
  return chosen.kind === "local" ? "Running locally" : `Running on ${chosen.label}`
}

