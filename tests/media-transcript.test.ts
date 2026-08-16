import { describe, expect, it } from "vitest"

import {
  formatTimecode,
  isTranscriptRunning,
  normalizeTranscriptSegments,
  transcriptHasContent,
  transcriptToPlainText,
  transcriptToSrt,
  transcriptToTimestampedText,
  type TranscriptSegment,
} from "@arciin/types"

/**
 * The pure parts of a transcript: how times are shown, how model output is
 * made safe, and how the text is exported.
 *
 * Structured output still arrives as JSON written by a language model, so
 * `normalizeTranscriptSegments` treats every field as untrusted. Most of this
 * file is about what happens when the model returns something slightly wrong —
 * which it will, eventually, on somebody's two-hour recording.
 */

describe("timecodes", () => {
  it("reads as MM:SS for short media", () => {
    expect(formatTimecode(0)).toBe("00:00")
    expect(formatTimecode(8300)).toBe("00:08")
    expect(formatTimecode(65_000)).toBe("01:05")
    expect(formatTimecode(599_000)).toBe("09:59")
  })

  it("grows to HH:MM:SS once the media passes an hour", () => {
    expect(formatTimecode(3_814_000)).toBe("1:03:34")
    expect(formatTimecode(7_200_000)).toBe("2:00:00")
  })

  it("can be forced to hours so a long transcript lines up in a column", () => {
    // Otherwise segment 1 reads 00:08 and segment 400 reads 1:03:34, and the
    // timestamps no longer form a column.
    expect(formatTimecode(8300, { forceHours: true })).toBe("0:00:08")
  })

  it("never shows a negative or fractional time", () => {
    expect(formatTimecode(-5000)).toBe("00:00")
    expect(formatTimecode(1999)).toBe("00:01")
  })
})

describe("normalising what the model returned", () => {
  it("keeps well-formed segments", () => {
    const out = normalizeTranscriptSegments([
      { startMs: 0, endMs: 4000, text: "Your server." },
      { startMs: 4000, text: "Your control.", speaker: "Speaker 1" },
    ])
    expect(out).toEqual([
      { startMs: 0, endMs: 4000, text: "Your server." },
      { startMs: 4000, speaker: "Speaker 1", text: "Your control." },
    ])
  })

  it("drops empty text rather than rendering a blank line", () => {
    expect(normalizeTranscriptSegments([{ startMs: 0, text: "   " }])).toEqual([])
  })

  it("sorts out-of-order segments", () => {
    const out = normalizeTranscriptSegments([
      { startMs: 5000, text: "second" },
      { startMs: 0, text: "first" },
    ])
    expect(out.map((s) => s.text)).toEqual(["first", "second"])
  })

  it("accepts the time formats models actually emit", () => {
    // Milliseconds, seconds-as-string, MM:SS and HH:MM:SS have all shown up.
    expect(normalizeTranscriptSegments([{ start: "00:05", text: "a" }])[0]!.startMs).toBe(5000)
    expect(normalizeTranscriptSegments([{ start: "01:00:01", text: "a" }])[0]!.startMs).toBe(3_601_000)
    expect(normalizeTranscriptSegments([{ start_ms: 250, text: "a" }])[0]!.startMs).toBe(250)
  })

  it("clamps a negative start rather than rejecting the line", () => {
    expect(normalizeTranscriptSegments([{ startMs: -10, text: "a" }])[0]!.startMs).toBe(0)
  })

  it("ignores an end time that is not after the start", () => {
    const out = normalizeTranscriptSegments([{ startMs: 1000, endMs: 500, text: "a" }])
    expect(out[0]).not.toHaveProperty("endMs")
  })

  it("omits a speaker rather than inventing one", () => {
    // "unknown" is the model declining to answer, not a speaker's name.
    expect(normalizeTranscriptSegments([{ startMs: 0, text: "a", speaker: "unknown" }])[0])
      .not.toHaveProperty("speaker")
    expect(normalizeTranscriptSegments([{ startMs: 0, text: "a", speaker: "  " }])[0])
      .not.toHaveProperty("speaker")
  })

  it("survives complete nonsense", () => {
    expect(normalizeTranscriptSegments(null)).toEqual([])
    expect(normalizeTranscriptSegments("not an array")).toEqual([])
    expect(normalizeTranscriptSegments([null, 42, { nope: true }])).toEqual([])
  })
})

describe("reading and exporting", () => {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 4000, text: "Your server." },
    { startMs: 4000, endMs: 8000, text: "Your control." },
    { startMs: 8000, speaker: "Speaker 2", text: "Thank you." },
  ]

  it("copies as plain readable text with speaker turns", () => {
    const text = transcriptToPlainText(segments)
    expect(text).toContain("Your server.")
    expect(text).toContain("Speaker 2:")
    // No timecodes in the plain form — that is the point of it.
    expect(text).not.toMatch(/\d\d:\d\d/)
  })

  it("copies with timecodes when asked", () => {
    const text = transcriptToTimestampedText(segments)
    expect(text).toContain("[00:00] Your server.")
    expect(text).toContain("[00:08] Speaker 2: Thank you.")
  })

  it("uses hours throughout once any segment passes an hour", () => {
    const long: TranscriptSegment[] = [
      { startMs: 0, text: "start" },
      { startMs: 3_700_000, text: "later" },
    ]
    const text = transcriptToTimestampedText(long)
    expect(text).toContain("[0:00:00] start")
    expect(text).toContain("[1:01:40] later")
  })

  it("writes valid SRT", () => {
    const srt = transcriptToSrt(segments)
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:04,000\nYour server.")
    expect(srt).toContain("00:00:04,000 --> 00:00:08,000\nYour control.")
    expect(srt).toContain("Speaker 2: Thank you.")
  })

  it("gives a segment with no end a usable cue length", () => {
    // A zero-length cue is dropped by some players, so the last line would
    // silently vanish from an exported subtitle file.
    const srt = transcriptToSrt([{ startMs: 0, text: "only" }])
    const [, times] = srt.split("\n")
    expect(times).toBe("00:00:00,000 --> 00:00:04,000")
  })

  it("ends a cue at the next segment's start when its own end is missing", () => {
    const srt = transcriptToSrt([
      { startMs: 0, text: "a" },
      { startMs: 2000, text: "b" },
    ])
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000")
  })
})

describe("status helpers", () => {
  it("treats queued and processing as running", () => {
    expect(isTranscriptRunning("PENDING")).toBe(true)
    expect(isTranscriptRunning("PROCESSING")).toBe(true)
  })

  it("treats every settled state as not running", () => {
    // A drawer that keeps polling a finished job is a drawer that never stops.
    for (const status of ["READY", "FAILED", "NO_AUDIO", "NO_SPEECH"] as const) {
      expect(isTranscriptRunning(status)).toBe(false)
    }
  })

  it("only calls a transcript useful when it has words", () => {
    expect(transcriptHasContent({ status: "READY", segments: [{}] })).toBe(true)
    expect(transcriptHasContent({ status: "READY", segments: [] })).toBe(false)
    expect(transcriptHasContent({ status: "NO_SPEECH", segments: [] })).toBe(false)
  })
})
