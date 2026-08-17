/**
 * What a failed external tool is allowed to tell a person.
 *
 * A separator that dies part-way leaves four kilobytes of Python logging, tqdm
 * redraws and absolute filesystem paths. Putting that in `MediaDub.error` — which
 * is what used to happen — meant the failure UI rendered a wall of process
 * output containing the server's own directory layout, and the reader still had
 * no idea what went wrong.
 *
 * So a failure carries two things. A `summary` a person can act on, and a
 * `detail` that is bounded, stripped of absolute paths, and shown only when
 * someone asks for it. The complete log is kept on disk, where diagnostics
 * belong, rather than in a database column that the browser renders.
 */

/** Enough to see the shape of a failure; far less than a log file. */
export const MAX_DETAIL_LENGTH = 4000

export class MediaToolError extends Error {
  readonly tool: string
  /** One or two sentences, safe to show unprompted. */
  readonly summary: string
  /** Bounded, sanitised technical text for a collapsed section. */
  readonly detail: string
  readonly exitCode: number | null
  readonly signal: string | null

  constructor(input: {
    tool: string
    summary: string
    detail?: string
    exitCode?: number | null
    signal?: string | null
  }) {
    super(input.summary)
    this.name = "MediaToolError"
    this.tool = input.tool
    this.summary = input.summary
    this.detail = sanitizeToolOutput(input.detail ?? "")
    this.exitCode = input.exitCode ?? null
    this.signal = input.signal ?? null
  }
}

/**
 * Make tool output safe and small enough to show.
 *
 * Three jobs, in order. Collapse the tqdm redraws, because a progress bar
 * rendered as text is thousands of characters of noise that push the actual
 * error off the end. Replace absolute paths with a marker, because the server's
 * directory layout is not the reader's business and is exactly the sort of thing
 * that should not leave the instance. Then keep the *end*, because the error is
 * always at the end while the beginning is version banners.
 */
export function sanitizeToolOutput(raw: string, maxLength = MAX_DETAIL_LENGTH): string {
  if (!raw) return ""

  const cleaned = raw
    // ANSI colour.
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, "")
    // A carriage-return redraw only ever needs its final frame.
    .split("\n")
    .map((line) => {
      const frames = line.split("\r")
      return frames[frames.length - 1] ?? line
    })
    .join("\n")
    // Absolute paths, ours and anyone's, down to the file they name.
    .replace(/(?:\/[\w.@+-]+){2,}/g, (match) => `…/${match.split("/").pop() ?? ""}`)
    // Timestamped log prefixes carry nothing once the lines are in order.
    .replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d+ - /gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (cleaned.length <= maxLength) return cleaned
  // The end, because that is where the reason is.
  return `…truncated…\n${cleaned.slice(cleaned.length - maxLength)}`
}

/**
 * Why a process stopped, in words rather than an exit code.
 *
 * Signals are worth naming: `SIGKILL` on this hardware almost always means the
 * kernel ran out of memory, and telling someone "the separator was stopped by
 * the system, probably for memory" is actionable in a way that "exited with
 * null" is not.
 */
export function describeExit(input: {
  tool: string
  exitCode: number | null
  signal: string | null
  stalled?: boolean
  stallMinutes?: number
}): string {
  if (input.stalled) {
    return `${input.tool} stopped reporting progress for ${input.stallMinutes ?? 0} minutes and was ended.`
  }
  if (input.signal === "SIGKILL") {
    return `${input.tool} was stopped by the system, most likely because it ran out of memory.`
  }
  if (input.signal) {
    return `${input.tool} was stopped by ${input.signal}.`
  }
  return `${input.tool} exited with code ${input.exitCode ?? "unknown"}.`
}
