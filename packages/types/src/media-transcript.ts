/**
 * A transcript of the speech in a media asset.
 *
 * Shared between the API, the worker and the web app so all three agree on what
 * a segment is. Times are milliseconds because that is what arithmetic wants;
 * every place a person reads one, it is formatted first.
 */

export const MEDIA_TRANSCRIPT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
  "NO_AUDIO",
  "NO_SPEECH",
] as const

export type MediaTranscriptStatus = (typeof MEDIA_TRANSCRIPT_STATUSES)[number]

export type TranscriptSegment = {
  startMs: number
  endMs?: number
  /**
   * "Speaker 1", "Speaker 2" — never a real name.
   *
   * Absent when the model could not separate voices reliably. An omitted
   * speaker is honest; a guessed one is a claim about who was in the room.
   */
  speaker?: string
  text: string
}

export type MediaTranscript = {
  id: string
  assetId: string
  status: MediaTranscriptStatus
  provider: string | null
  model: string | null
  /** As detected, never forced to English. */
  language: string | null
  fullText: string | null
  segments: TranscriptSegment[]
  durationSeconds: number | null
  /** True once a person has corrected it — a regenerate should warn first. */
  edited: boolean
  error: string | null
  jobId: string | null
  generatedAt: string | null
  updatedAt: string
}

/** Stages the drawer shows. Named, not a fabricated percentage. */
export const TRANSCRIPT_STAGES = [
  "queued",
  "preparing",
  "uploading",
  "analyzing",
  "saving",
] as const

export type TranscriptStage = (typeof TRANSCRIPT_STAGES)[number]

export function isTranscriptRunning(status: MediaTranscriptStatus): boolean {
  return status === "PENDING" || status === "PROCESSING"
}

/** A transcript worth showing: it has words in it. */
export function transcriptHasContent(t: {
  status: MediaTranscriptStatus
  segments?: unknown[]
}): boolean {
  return t.status === "READY" && Array.isArray(t.segments) && t.segments.length > 0
}

/**
 * `MM:SS`, or `HH:MM:SS` once the media runs past an hour.
 *
 * Raw milliseconds are never shown to a reader, and a two-hour recording should
 * not display `01:23` for something 83 minutes in.
 */
export function formatTimecode(ms: number, opts: { forceHours?: boolean } = {}): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  if (hours > 0 || opts.forceHours) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${pad(minutes)}:${pad(seconds)}`
}

/** Plain reading copy: speaker turns kept, timestamps dropped. */
export function transcriptToPlainText(segments: TranscriptSegment[]): string {
  const lines: string[] = []
  let lastSpeaker: string | undefined
  for (const s of segments) {
    if (s.speaker && s.speaker !== lastSpeaker) {
      if (lines.length > 0) lines.push("")
      lines.push(`${s.speaker}:`)
      lastSpeaker = s.speaker
    }
    lines.push(s.text)
  }
  return lines.join("\n").trim()
}

/** Reading copy with timecodes, the way the drawer shows it. */
export function transcriptToTimestampedText(segments: TranscriptSegment[]): string {
  const long = segments.some((s) => s.startMs >= 3_600_000)
  return segments
    .map((s) => {
      const time = formatTimecode(s.startMs, { forceHours: long })
      const who = s.speaker ? `${s.speaker}: ` : ""
      return `[${time}] ${who}${s.text}`
    })
    .join("\n")
}

/**
 * SubRip subtitles.
 *
 * Worth having because the segments already carry the timings a caption file
 * needs. A segment with no end time gets a readable default rather than a zero
 * duration cue, which some players drop entirely.
 */
export function transcriptToSrt(segments: TranscriptSegment[]): string {
  const srtTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms))
    const h = Math.floor(total / 3_600_000)
    const m = Math.floor((total % 3_600_000) / 60_000)
    const s = Math.floor((total % 60_000) / 1000)
    const milli = total % 1000
    const pad = (n: number, w = 2) => String(n).padStart(w, "0")
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`
  }

  return segments
    .map((seg, i) => {
      const next = segments[i + 1]
      const end = seg.endMs ?? next?.startMs ?? seg.startMs + 4000
      const who = seg.speaker ? `${seg.speaker}: ` : ""
      return `${i + 1}\n${srtTime(seg.startMs)} --> ${srtTime(Math.max(end, seg.startMs + 500))}\n${who}${seg.text}\n`
    })
    .join("\n")
}

/**
 * Coerce whatever the model returned into segments we can trust.
 *
 * Structured output still arrives as JSON from a language model, so every field
 * is treated as untrusted: a segment with no text is dropped rather than shown
 * as an empty line, times are clamped to non-negative, and the list is sorted
 * so a model that emits out of order cannot scramble the reader's view.
 */
export function normalizeTranscriptSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return []
  const out: TranscriptSegment[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const text = typeof row.text === "string" ? row.text.trim() : ""
    if (!text) continue

    const startMs = toMs(row.startMs ?? row.start_ms ?? row.start ?? row.startTime)
    if (startMs === null) continue
    const endMs = toMs(row.endMs ?? row.end_ms ?? row.end ?? row.endTime)

    const speakerRaw = typeof row.speaker === "string" ? row.speaker.trim() : ""
    const speaker = speakerRaw && speakerRaw.toLowerCase() !== "unknown" ? speakerRaw : undefined

    out.push({
      startMs: Math.max(0, Math.round(startMs)),
      ...(endMs !== null && endMs > startMs ? { endMs: Math.round(endMs) } : {}),
      ...(speaker ? { speaker } : {}),
      text,
    })
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

/** Accepts a number of ms, a number of seconds, or `MM:SS` / `HH:MM:SS`. */
function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)

  const parts = trimmed.split(":").map((p) => Number(p))
  if (parts.some((p) => !Number.isFinite(p))) return null
  if (parts.length === 2) return (parts[0]! * 60 + parts[1]!) * 1000
  if (parts.length === 3) return (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000
  return null
}
