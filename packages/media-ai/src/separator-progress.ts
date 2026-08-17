/**
 * Reading progress out of a separator's console output.
 *
 * The separator is a Python program that reports progress with tqdm, and tqdm
 * writes for a terminal, not for a parser: it redraws one line by emitting a
 * carriage return and overwriting, decorates it with block-drawing characters
 * and sometimes ANSI colour, and it arrives down a pipe in chunks that split
 * wherever the buffer happened to end. A single chunk can carry several redraws.
 *
 * So this does not match a line. It scans for the one thing that is actually
 * dependable — a `39/122` pair — and refuses everything it cannot defend:
 *
 *     0/122                                      accepted, 0 of 122
 *     39%|###       | 39/122 [29:19<1:01:53]     accepted, 39 of 122
 *     44.74s/it                                  rejected, not a count
 *     Separator version 0.44.5                   rejected, no pair
 *     5/1                                        rejected, past the end
 *
 * Deliberately not anchored to the surrounding text, because that text is the
 * part most likely to change between separator versions, and a parser that
 * breaks on a cosmetic upstream change is worse than one that occasionally sees
 * nothing: seeing nothing degrades to "no counter", which the UI handles.
 */

export type SeparatorProgress = {
  completed: number
  total: number
  /** 0-100, integer. Derived here so every consumer agrees on the rounding. */
  percent: number
}

/**
 * Pairs that are progress, and pairs that merely look like it.
 *
 * A version string, a rate and a file size all contain a slash. The guards
 * reject those without needing to know what they are: both sides whole numbers
 * with no adjacent decimal point, a total of at least two, and a completed
 * count that cannot exceed it.
 */
const PAIR = /(?<![\d.,])(\d{1,7})\s*\/\s*(\d{1,7})(?![.,]?\d)/g

/** tqdm redraws with a carriage return, and may colour the bar. */
const ANSI_PATTERN = "\\u001b\\[[0-9;?]*[ -/]*[@-~]"

function stripControl(chunk: string): string {
  return chunk.replace(new RegExp(ANSI_PATTERN, "g"), "").replace(/\r/g, "\n")
}

export function percentOf(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
}

/**
 * The last defensible pair in a piece of output, or nothing.
 *
 * The *last* rather than the first, because one chunk often contains several
 * redraws and the newest is the true state.
 */
export function parseSeparatorProgress(chunk: string): SeparatorProgress | null {
  const text = stripControl(chunk)
  let found: SeparatorProgress | null = null

  for (const match of text.matchAll(PAIR)) {
    const completed = Number(match[1])
    const total = Number(match[2])
    if (!Number.isInteger(completed) || !Number.isInteger(total)) continue
    // A total of one carries no information and is usually a version string.
    if (total < 2) continue
    // Counting past the end is not progress; it is a coincidence.
    if (completed > total) continue
    found = { completed, total, percent: percentOf(completed, total) }
  }

  return found
}

/**
 * Turns a stream of arbitrary chunks into progress readings.
 *
 * Stateful for two reasons. A chunk boundary can fall inside `39/122`, so a
 * short tail is held back and prepended to the next chunk — without that, a long
 * separation silently loses updates and, worse, can report `9/122` from a split
 * `39/122`.
 *
 * And progress must not go backwards. The separator prints a fresh `0/122` when
 * it begins another pass, and a bar that jumps from 78% back to nothing reads as
 * a crash to the person watching. A decrease is only accepted when the total
 * changes, which is a genuinely new phase.
 */
export class SeparatorProgressReader {
  private pending = ""
  private last: SeparatorProgress | null = null

  /**
   * A ceiling on what may be held over, so a chunk of pure whitespace or a very
   * long run of digits cannot stall reporting indefinitely.
   */
  private static readonly MAX_CARRY = 16

  /** Returns a reading only when it is new and defensible. */
  push(chunk: string): SeparatorProgress | null {
    const text = this.pending + chunk
    const boundary = text.length - SeparatorProgressReader.carryLength(text)
    this.pending = text.slice(boundary)

    const reading = parseSeparatorProgress(text.slice(0, boundary))
    if (!reading) return null

    if (this.last && reading.total === this.last.total) {
      // Same phase: only forward movement is news.
      if (reading.completed <= this.last.completed) return null
    }

    this.last = reading
    return reading
  }

  /** Anything still held back when the process ends. */
  flush(): SeparatorProgress | null {
    if (!this.pending) return null
    const remainder = this.pending
    this.pending = ""
    const text = remainder
    const reading = parseSeparatorProgress(text)
    if (!reading) return null
    if (this.last && reading.total === this.last.total && reading.completed <= this.last.completed) {
      return null
    }
    this.last = reading
    return reading
  }

  get current(): SeparatorProgress | null {
    return this.last
  }

  /**
   * How much of the end of a buffer might still be growing.
   *
   * Only a run of digits, slashes and spaces can be half of a `39/122`, so only
   * that is held back — an earlier version held a fixed 24 characters, which hid
   * a pair that happened to sit at the end of a chunk until the *next* frame
   * arrived. On this hardware the next frame is 45 seconds later, so the bar
   * would have shown one step behind reality the whole way through.
   */
  private static carryLength(text: string): number {
    const trailing = /[\d\s/]*$/.exec(text)?.[0].length ?? 0
    return Math.min(trailing, SeparatorProgressReader.MAX_CARRY)
  }
}
