import { describe, expect, it } from "vitest"

import {
  TtsEmptyResponseError,
  isRetryableTtsError,
  pcmDurationMs,
  pcmToWav,
} from "../packages/media-ai/src/dub-tts"
import {
  atempoChain,
  buildMixArgs,
  buildMixFilter,
  buildRemuxArgs,
  dubFilename,
} from "../packages/media-ai/src/dub-mix"
import { DUB_TTS_SAMPLE_RATE } from "../packages/media-ai/src/dub-prompt"

describe("reading the provider's audio", () => {
  it("derives duration from the byte count, since the provider does not report it", () => {
    // One second of 24 kHz mono 16-bit is 48,000 bytes.
    expect(pcmDurationMs(48_000)).toBe(1000)
    expect(pcmDurationMs(24_000)).toBe(500)
    expect(pcmDurationMs(0)).toBe(0)
  })

  it("matches the format observed from the live API", () => {
    // 88,320 bytes came back for a short line in the probe against Gemini.
    expect(DUB_TTS_SAMPLE_RATE).toBe(24_000)
    expect(pcmDurationMs(88_320)).toBe(1840)
  })

  it("wraps raw samples in a container everything downstream expects", () => {
    const pcm = Buffer.alloc(48_000)
    const wav = pcmToWav(pcm)

    expect(wav.subarray(0, 4).toString()).toBe("RIFF")
    expect(wav.subarray(8, 12).toString()).toBe("WAVE")
    expect(wav.subarray(36, 40).toString()).toBe("data")
    expect(wav.readUInt32LE(40)).toBe(pcm.length)
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(24_000)
    expect(wav.length).toBe(pcm.length + 44)
  })
})

describe("deciding whether to try again", () => {
  it("retries an empty response, which the provider is known to return", () => {
    expect(isRetryableTtsError(new TtsEmptyResponseError())).toBe(true)
  })

  it("retries transient transport failures", () => {
    for (const message of [
      "503 Service Unavailable",
      "429 rate limit exceeded",
      "model is overloaded",
      "deadline exceeded",
      "ECONNRESET",
    ]) {
      expect(isRetryableTtsError(new Error(message)), message).toBe(true)
    }
  })

  it("does not retry what will fail identically", () => {
    /**
     * Retrying a rejected prompt or a bad key spends quota three times to
     * receive the same answer, and delays the real error reaching the reader.
     */
    for (const message of [
      "API_KEY_INVALID",
      "permission denied",
      "invalid argument: unsupported language",
      "blocked by safety settings",
    ]) {
      expect(isRetryableTtsError(new Error(message)), message).toBe(false)
    }
  })

  it("treats an unrecognised failure as final rather than looping", () => {
    expect(isRetryableTtsError(new Error("something unexpected"))).toBe(false)
  })
})

describe("time-stretching within ffmpeg's limits", () => {
  it("passes ordinary rates through untouched", () => {
    expect(atempoChain(1)).toBe("atempo=1.0000")
    expect(atempoChain(1.15)).toBe("atempo=1.1500")
    expect(atempoChain(0.85)).toBe("atempo=0.8500")
  })

  it("chains when a rate exceeds what one atempo accepts", () => {
    // Never requested by this pipeline, but a filter that errors at mix time
    // would fail a job after all the synthesis had been paid for.
    const chain = atempoChain(4)
    expect(chain.split(",").length).toBeGreaterThan(1)
    const product = chain
      .split(",")
      .map((f) => Number(f.replace("atempo=", "")))
      .reduce((a, b) => a * b, 1)
    expect(product).toBeCloseTo(4, 3)
  })

  it("degrades a nonsensical rate into a valid filter", () => {
    expect(atempoChain(0)).toBe("atempo=1.0")
    expect(atempoChain(Number.NaN)).toBe("atempo=1.0")
  })
})

describe("the mix", () => {
  const clips = [
    { path: "/tmp/a.wav", startMs: 0, rate: 1 },
    { path: "/tmp/b.wav", startMs: 5000, rate: 1.08 },
  ]

  it("places each clip where it belongs on the timeline", () => {
    const filter = buildMixFilter({
      backgroundPath: "/tmp/bg.wav",
      clips,
      outputPath: "/tmp/out.m4a",
    })
    expect(filter).toContain("adelay=0|0")
    expect(filter).toContain("adelay=5000|5000")
    expect(filter).toContain("atempo=1.0800")
  })

  it("keeps the background at a constant level", () => {
    /**
     * `amix` normalises by input count, which would drop the background 6 dB
     * the instant any speech existed — the music would duck and swell with
     * every line. `normalize=0` is what stops that.
     */
    const filter = buildMixFilter({
      backgroundPath: "/tmp/bg.wav",
      clips,
      outputPath: "/tmp/out.m4a",
    })
    expect(filter).toContain("normalize=0")
    expect(filter).not.toMatch(/amix=inputs=\d+(?!:normalize=0)/)
  })

  it("protects headroom without flattening the soundtrack", () => {
    const filter = buildMixFilter({
      backgroundPath: "/tmp/bg.wav",
      clips,
      outputPath: "/tmp/out.m4a",
    })
    // A limiter, not loudness normalisation: summing two sources clips, but
    // the original dynamics are the thing being preserved.
    expect(filter).toContain("alimiter")
    expect(filter).not.toContain("loudnorm")
  })

  it("plays only the original background where nobody speaks", () => {
    const filter = buildMixFilter({
      backgroundPath: "/tmp/bg.wav",
      clips: [],
      outputPath: "/tmp/out.m4a",
    })
    // No synthesised filler in the silence.
    expect(filter).toBe("[0:a]anull[out]")
    expect(filter).not.toContain("anullsrc")
  })

  it("ducks only when asked", () => {
    const plain = buildMixFilter({ backgroundPath: "/tmp/bg.wav", clips, outputPath: "/o.m4a" })
    const ducked = buildMixFilter({
      backgroundPath: "/tmp/bg.wav",
      clips,
      outputPath: "/o.m4a",
      duck: true,
    })
    // Most edited video already ducks its own music; doing it twice pumps.
    expect(plain).not.toContain("sidechaincompress")
    expect(ducked).toContain("sidechaincompress")
  })

  it("feeds ffmpeg the background first and every clip after", () => {
    const args = buildMixArgs({
      backgroundPath: "/tmp/bg.wav",
      clips,
      outputPath: "/tmp/out.m4a",
    })
    expect(args.indexOf("/tmp/bg.wav")).toBeLessThan(args.indexOf("/tmp/a.wav"))
    expect(args).toContain("-filter_complex")
    expect(args[args.length - 1]).toBe("/tmp/out.m4a")
  })
})

describe("remuxing a dub onto the video", () => {
  it("copies the picture rather than re-encoding it", () => {
    const args = buildRemuxArgs({
      videoPath: "/tmp/in.mp4",
      audioPath: "/tmp/dub.m4a",
      outputPath: "/tmp/out.mp4",
    })
    // Re-encoding would cost minutes and lose quality to change nothing.
    expect(args.join(" ")).toContain("-c:v copy")
    expect(args.join(" ")).toContain("-map 0:v:0")
    expect(args.join(" ")).toContain("-map 1:a:0")
  })
})

describe("naming a dub", () => {
  it("marks the language and keeps the original name intact", () => {
    expect(dubFilename("Teacher Classroom Discussion.mp4", "es", "video")).toBe(
      "Teacher Classroom Discussion.es.dub.mp4",
    )
    expect(dubFilename("Teacher Classroom Discussion.mp4", "es", "audio")).toBe(
      "Teacher Classroom Discussion.es.dub.m4a",
    )
  })

  it("keeps the source container for video and uses m4a for audio", () => {
    expect(dubFilename("clip.mov", "am", "video")).toBe("clip.am.dub.mov")
    expect(dubFilename("clip.mov", "am", "audio")).toBe("clip.am.dub.m4a")
  })

  it("copes with a name that has no extension", () => {
    expect(dubFilename("recording", "fr", "audio")).toBe("recording.fr.dub.m4a")
  })

  it("never mutates the original", () => {
    const original = "Interview.mp4"
    dubFilename(original, "es", "video")
    expect(original).toBe("Interview.mp4")
  })
})
