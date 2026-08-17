import { describe, expect, it } from "vitest"

import {
  SeparatorProgressReader,
  parseSeparatorProgress,
  percentOf,
} from "../packages/media-ai/src/separator-progress"

/**
 * Progress parsing, tested against what the separator really printed.
 *
 * The samples below are taken verbatim from the output of a genuine failed run
 * on this machine (a 11:51 video, `htdemucs.yaml`, separator 0.44.5), including
 * the log lines it interleaves and the exact tqdm formatting. Inventing the
 * input would have tested the parser against my idea of tqdm rather than tqdm.
 */

/** One tqdm redraw, as it actually appears — carriage return and all. */
const redraw = (completed: number, total: number, bar: string, timing: string) =>
  `\r${Math.round((completed / total) * 100)}%|${bar}| ${completed}/${total} [${timing}]`

describe("parseSeparatorProgress", () => {
  it("reads the pair out of a real tqdm redraw", () => {
    const line = redraw(39, 122, "███▏      ", "29:19<1:01:53, 44.74s/it")
    expect(parseSeparatorProgress(line)).toEqual({ completed: 39, total: 122, percent: 32 })
  })

  it("reads the first frame, where nothing has happened yet", () => {
    const line = "\r  0%|          | 0/122 [00:00<?, ?it/s]"
    expect(parseSeparatorProgress(line)).toEqual({ completed: 0, total: 122, percent: 0 })
  })

  it("takes the newest redraw when a chunk carries several", () => {
    // Exactly how it arrives: tqdm never flushes a newline, so one read can
    // contain a dozen frames and only the last one is the current state.
    const chunk =
      redraw(1, 122, "          ", "00:35<1:10:38, 35.03s/it") +
      redraw(2, 122, "▏         ", "01:10<1:10:01, 35.01s/it") +
      redraw(3, 122, "▏         ", "01:49<1:13:49, 37.22s/it")
    expect(parseSeparatorProgress(chunk)?.completed).toBe(3)
  })

  it("ignores the log lines the separator interleaves", () => {
    const log = [
      "2026-08-17 12:46:44.215 - INFO - cli - Separator version 0.44.5 beginning with input path(s): /srv/x/source.wav",
      "2026-08-17 12:46:44.320 - INFO - common_separator - Input audio subtype: PCM_16",
      "2026-08-17 12:46:44.320 - INFO - common_separator - Detected input bit depth: 16-bit",
    ].join("\n")
    expect(parseSeparatorProgress(log)).toBeNull()
  })

  it("is not fooled by a rate, which is the pair-shaped thing next to the pair", () => {
    // "44.74s/it" and "35.03s/it" are slashes with numbers around them.
    expect(parseSeparatorProgress("44.74s/it")).toBeNull()
    expect(parseSeparatorProgress("[00:00<?, ?it/s]")).toBeNull()
  })

  it("rejects a version, a ratio of one, and a count past its total", () => {
    expect(parseSeparatorProgress("model v1.5/2 loaded")).toBeNull()
    expect(parseSeparatorProgress("step 3/1")).toBeNull()
    expect(parseSeparatorProgress("1/1")).toBeNull()
  })

  it("survives ANSI colour around the bar", () => {
    const coloured = `[32m 32%|[0m███| 39/122 [0m[29:19]`
    expect(parseSeparatorProgress(coloured)).toEqual({
      completed: 39,
      total: 122,
      percent: 32,
    })
  })

  it("finds progress even when a log line shares the chunk", () => {
    const mixed = `2026-08-17 12:46:44.320 - INFO - separator - Starting separation process\n\r 32%|###| 39/122 [29:19]`
    expect(parseSeparatorProgress(mixed)?.completed).toBe(39)
  })

  it("tolerates surrounding text changing shape entirely", () => {
    // A future separator version could reword everything around the numbers.
    // The pair is all this depends on, which is the point.
    expect(parseSeparatorProgress("Chunk 39 of 122 done")?.completed).toBeUndefined()
    expect(parseSeparatorProgress("processed 39 / 122 segments")).toEqual({
      completed: 39,
      total: 122,
      percent: 32,
    })
  })
})

describe("percentOf", () => {
  it("rounds once, in one place", () => {
    expect(percentOf(39, 122)).toBe(32)
    expect(percentOf(0, 122)).toBe(0)
    expect(percentOf(122, 122)).toBe(100)
  })

  it("refuses to divide by nothing", () => {
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe("SeparatorProgressReader", () => {
  it("reassembles a pair split across two chunks", () => {
    const reader = new SeparatorProgressReader()
    /**
     * The failure this exists for. A pipe read can end mid-number, and a naive
     * parser sees "9/122" from the tail of "39/122" — a progress bar that jumps
     * backwards for no reason the user can see.
     */
    expect(reader.push("\r 32%|###| 3")).toBeNull()
    expect(reader.push("9/122 [29:19<1:01:53]\n")).toEqual({
      completed: 39,
      total: 122,
      percent: 32,
    })
  })

  it("reports each step once and stays quiet in between", () => {
    const reader = new SeparatorProgressReader()
    reader.push(redraw(1, 122, " ", "00:35") + "                         ")
    const repeated = reader.push(redraw(1, 122, " ", "00:36") + "                         ")
    expect(repeated, "the same count again is not news").toBeNull()
    expect(reader.push(redraw(2, 122, " ", "01:10") + "                         ")?.completed).toBe(2)
  })

  it("does not let progress run backwards inside a phase", () => {
    const reader = new SeparatorProgressReader()
    reader.push(redraw(95, 122, "#", "70:00") + "                         ")
    // The separator prints a fresh zero when it starts another pass over the
    // same file. Showing that would read as a crash to someone watching 78%.
    expect(reader.push(redraw(0, 122, " ", "00:00") + "                         ")).toBeNull()
    expect(reader.current?.completed).toBe(95)
  })

  it("accepts a decrease when the total changes, because that is a new phase", () => {
    const reader = new SeparatorProgressReader()
    reader.push(redraw(122, 122, "#", "90:00") + "                         ")
    expect(reader.push(redraw(1, 8, " ", "00:01") + "                         ")).toEqual({
      completed: 1,
      total: 8,
      percent: 13,
    })
  })

  it("reads a complete final frame straight away, without needing a flush", () => {
    const reader = new SeparatorProgressReader()
    // Nothing is held back once a non-numeric character has followed the pair,
    // so the last frame is reported when it arrives rather than on close.
    expect(reader.push("\r100%|#####| 122/122 [92:11]")).toEqual({
      completed: 122,
      total: 122,
      percent: 100,
    })
    expect(reader.flush()).toBeNull()
  })

  it("gives up a genuinely truncated tail when the process ends", () => {
    const reader = new SeparatorProgressReader()
    // Killed mid-write: the pair arrived with nothing after it, so it is held as
    // possibly-incomplete. Without a flush, that last step is lost.
    expect(reader.push("\r100%|#####| 122/122")).toBeNull()
    expect(reader.flush()).toEqual({ completed: 122, total: 122, percent: 100 })
  })

  it("holds nothing back when there was nothing to hold", () => {
    const reader = new SeparatorProgressReader()
    expect(reader.flush()).toBeNull()
  })

  it("walks a whole separation without a spurious reading", () => {
    const reader = new SeparatorProgressReader()
    const seen: number[] = []
    for (let i = 0; i <= 122; i += 1) {
      // Chunked the way a pipe delivers it: arbitrary splits, mixed with logs.
      const frame = redraw(i, 122, "#".repeat(Math.floor(i / 12)), `${i}:00<1:00:00, 44.7s/it`)
      const half = Math.floor(frame.length / 2)
      // Both halves, because a reading can surface on either: which one depends
      // only on where the split happened to fall relative to the pair.
      for (const part of [frame.slice(0, half), frame.slice(half)]) {
        const reading = reader.push(part)
        if (reading) seen.push(reading.completed)
      }
    }
    const tail = reader.flush()
    if (tail) seen.push(tail.completed)

    // Every step, in order, exactly once — no gaps and no repeats.
    expect(seen).toEqual(Array.from({ length: 123 }, (_, i) => i))
  })
})
