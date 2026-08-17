import { describe, expect, it } from "vitest"

import {
  MediaToolError,
  describeExit,
  sanitizeToolOutput,
} from "../packages/media-ai/src/media-tool-error"
import { runStreaming } from "../packages/media-ai/src/run-streaming"

/**
 * Running an external tool, and reporting it when it goes wrong.
 *
 * Real subprocesses rather than a mocked `spawn`, because every property worth
 * asserting here is a property of process behaviour: that output arrives while
 * the process is still alive, that a silent process is eventually killed, that a
 * signalled death is described rather than swallowed. Mocking the thing under
 * test would leave all of that unproven.
 */

/** A tiny shell stand-in for the separator. */
const shell = (script: string) => ["-c", script] as string[]

describe("runStreaming", () => {
  it("delivers output while the process is still running", async () => {
    const seen: string[] = []
    const started = Date.now()
    await runStreaming("sh", shell('printf "first\\n"; sleep 0.4; printf "second\\n"'), {
      onOutput: (chunk) => seen.push(`${Date.now() - started < 350 ? "early" : "late"}:${chunk.trim()}`),
    })

    // The point of streaming: "first" is visible before the process ends. With
    // execFile both lines arrived together, after the run — which is why a
    // separation could not report progress at all.
    expect(seen.some((s) => s.startsWith("early:first"))).toBe(true)
    expect(seen.some((s) => s.includes("second"))).toBe(true)
  })

  it("reads stderr as well as stdout, because tqdm writes to stderr", async () => {
    const seen: string[] = []
    await runStreaming("sh", shell('printf "bar 3/8\\n" >&2'), {
      onOutput: (chunk) => seen.push(chunk),
    })
    expect(seen.join("")).toContain("3/8")
  })

  it("hands the full output to the diagnostics sink, not just the tail", async () => {
    let full = ""
    await runStreaming("sh", shell('for i in $(seq 1 500); do printf "line $i\\n"; done'), {
      tailBytes: 200,
      onComplete: (output) => {
        full = output
      },
    })
    expect(full).toContain("line 1\n")
    expect(full).toContain("line 500")
  })

  it("keeps only a bounded tail for the error, and it is the end", async () => {
    const failure = await runStreaming(
      "sh",
      shell('for i in $(seq 1 400); do printf "noise $i\\n"; done; printf "the real reason\\n"; exit 3'),
      { tailBytes: 300 },
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MediaToolError)
    const error = failure as MediaToolError
    // The reason is at the end of a log, always; the start is version banners.
    expect(error.detail).toContain("the real reason")
    expect(error.detail).not.toContain("noise 1\n")
    expect(error.detail.length).toBeLessThan(1000)
  })

  it("describes a non-zero exit rather than throwing a bare Error", async () => {
    const error = (await runStreaming("sh", shell("exit 7")).catch((e: unknown) => e)) as MediaToolError
    expect(error).toBeInstanceOf(MediaToolError)
    expect(error.exitCode).toBe(7)
    expect(error.summary).toContain("exited with code 7")
  })

  it("reports a command that does not exist as unstartable", async () => {
    const error = (await runStreaming("arciin-not-a-real-binary", []).catch(
      (e: unknown) => e,
    )) as MediaToolError
    expect(error).toBeInstanceOf(MediaToolError)
    expect(error.summary).toMatch(/could not be started/i)
  })

  it("kills a process that goes silent, and says that is what happened", async () => {
    /**
     * The guard that replaced the wall clock.
     *
     * A tool that prints nothing for long enough is stuck; one that prints
     * slowly is merely slow. The old 30-minute duration limit could not tell
     * those apart and killed a real separation at 39 of 122 chunks.
     */
    const error = (await runStreaming("sh", shell("sleep 30"), {
      stallTimeoutMs: 400,
    }).catch((e: unknown) => e)) as MediaToolError

    expect(error).toBeInstanceOf(MediaToolError)
    expect(error.summary).toMatch(/stopped reporting progress/i)
  })

  it("does not kill a slow process that keeps talking", async () => {
    // Total runtime well past the stall window, but never silent for long.
    const result = await runStreaming(
      "sh",
      shell('for i in 1 2 3 4 5 6; do printf "tick $i\\n"; sleep 0.15; done'),
      { stallTimeoutMs: 500 },
    )
    expect(result.exitCode).toBe(0)
  })

  it("stops the process when the caller aborts", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const error = (await runStreaming("sh", shell("sleep 30"), {
      signal: controller.signal,
      stallTimeoutMs: 60_000,
    }).catch((e: unknown) => e)) as MediaToolError
    expect(error).toBeInstanceOf(MediaToolError)
  })
})

describe("sanitizeToolOutput", () => {
  it("keeps only the last frame of a carriage-return redraw", () => {
    const tqdm = "\r 1%| | 1/122\r 2%| | 2/122\r 32%|###| 39/122 [29:19]"
    const cleaned = sanitizeToolOutput(tqdm)
    expect(cleaned).toContain("39/122")
    expect(cleaned).not.toContain("1/122")
  })

  it("does not leak the server's directory layout", () => {
    const raw =
      "Command failed: /srv/arce-projects/arciin-separator/bin/audio-separator /srv/arciin-storage/arciin/temp/dub-abc/source.wav"
    const cleaned = sanitizeToolOutput(raw)
    // The filename is useful; the path to it is nobody's business and is exactly
    // the sort of detail that should not leave the instance.
    expect(cleaned).toContain("audio-separator")
    expect(cleaned).toContain("source.wav")
    expect(cleaned).not.toContain("/srv/arce-projects")
    expect(cleaned).not.toContain("/srv/arciin-storage")
  })

  it("drops the repeated log timestamps", () => {
    const raw = "2026-08-17 12:46:44.215 - INFO - cli - Separator version 0.44.5"
    expect(sanitizeToolOutput(raw)).toBe("INFO - cli - Separator version 0.44.5")
  })

  it("truncates from the front and says so", () => {
    const cleaned = sanitizeToolOutput("x".repeat(9000), 500)
    expect(cleaned.startsWith("…truncated…")).toBe(true)
    expect(cleaned.length).toBeLessThan(600)
  })

  it("bounds the real 4232-character failure to something a panel can show", () => {
    // Roughly the size of the error that was being rendered in the UI.
    const raw = `Command failed: /srv/x/bin/audio-separator\n${"\r 1%| | 1/122".repeat(400)}\nRuntimeError: killed`
    const cleaned = sanitizeToolOutput(raw)
    expect(cleaned.length).toBeLessThanOrEqual(4000)
    expect(cleaned).toContain("RuntimeError: killed")
  })

  it("has nothing to say about nothing", () => {
    expect(sanitizeToolOutput("")).toBe("")
  })
})

describe("describeExit", () => {
  it("names a stall in minutes, not milliseconds", () => {
    expect(describeExit({ tool: "audio-separator", exitCode: null, signal: "SIGTERM", stalled: true, stallMinutes: 15 })).toBe(
      "audio-separator stopped reporting progress for 15 minutes and was ended.",
    )
  })

  it("reads SIGKILL as the memory problem it almost always is", () => {
    // On a 7 GB box running Demucs, this is the kernel, not a bug.
    expect(describeExit({ tool: "audio-separator", exitCode: null, signal: "SIGKILL" })).toMatch(
      /ran out of memory/,
    )
  })

  it("falls back to the exit code when there is nothing better", () => {
    expect(describeExit({ tool: "ffmpeg", exitCode: 1, signal: null })).toBe(
      "ffmpeg exited with code 1.",
    )
  })
})

describe("MediaToolError", () => {
  it("sanitises its detail on the way in, so a caller cannot forget to", () => {
    const error = new MediaToolError({
      tool: "audio-separator",
      summary: "Audio separation failed.",
      detail: "died at /srv/arce-projects/arciin/temp/x/source.wav",
    })
    expect(error.detail).not.toContain("/srv/arce-projects")
    expect(error.message).toBe("Audio separation failed.")
  })
})
