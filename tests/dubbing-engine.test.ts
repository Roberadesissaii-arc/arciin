import { describe, expect, it } from "vitest"

import {
  GEMINI_VOICES,
  NEUTRAL_VOICE,
  buildVoiceProfile,
  describeVocalCharacter,
  matchVoice,
  voiceSettingsFingerprint,
  type VoiceProfile,
} from "../packages/media-ai/src/dub-voice"
import {
  DUB_TTS_MODEL,
  INSTRUCTION_LABELS,
  MAX_SPEAKERS_PER_REQUEST,
  accentInstruction,
  buildDubPrompt,
  chunkSegments,
  emotionInstruction,
  groupSpeakersForRequests,
  paceInstruction,
  spokenTextOf,
} from "../packages/media-ai/src/dub-prompt"
import {
  MAX_RATE,
  fitSegment,
  fitSegments,
  layoutTimeline,
  summariseFit,
} from "../packages/media-ai/src/dub-timing"
import {
  AudioSeparationService,
  SeparationUnavailableError,
  type AudioSeparationBackend,
} from "../packages/media-ai/src/audio-separation"

/** A profile with everything explicit, so each test varies one thing. */
function profile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    speakerId: "Speaker 1",
    presentation: "auto",
    ageStyle: "adult",
    pitch: "medium",
    energy: "medium",
    pace: "medium",
    selectedGeminiVoice: "Schedar",
    accent: { kind: "preserve-source" },
    emotion: { kind: "match-original" },
    ...overrides,
  }
}

describe("matching a voice to a vocal character", () => {
  it("picks a different voice for a low, warm, mature character than a bright youthful one", () => {
    const mature = matchVoice({
      speakerId: "s1",
      pitch: "low",
      energy: "medium",
      texture: "warm",
      ageStyle: "mature",
    })
    const youthful = matchVoice({
      speakerId: "s2",
      pitch: "high",
      energy: "high",
      texture: "bright",
      ageStyle: "youthful",
    })

    // The point is the mapping, not which name comes out.
    expect(mature.voice).not.toBe(youthful.voice)
    expect(mature.confidence).toBe("high")
    expect(youthful.confidence).toBe("high")
  })

  it("is deterministic, so regenerating does not change voice", () => {
    const analysis = { speakerId: "s1", pitch: "low", energy: "low", texture: "breathy" } as const
    expect(matchVoice(analysis).voice).toBe(matchVoice(analysis).voice)
  })

  it("uses a neutral voice rather than guessing when it knows nothing", () => {
    const result = matchVoice({ speakerId: "s1" })
    expect(result.voice).toBe(NEUTRAL_VOICE)
    expect(result.confidence).toBe("low")
  })

  it("reports lower confidence from thinner evidence", () => {
    expect(matchVoice({ speakerId: "s", pitch: "low" }).confidence).toBe("low")
    expect(matchVoice({ speakerId: "s", pitch: "low", energy: "low" }).confidence).toBe("medium")
  })

  it("only ever returns a voice the provider actually has", () => {
    const names = new Set(GEMINI_VOICES.map((v) => v.name))
    for (const analysis of [
      { speakerId: "a", pitch: "low" as const },
      { speakerId: "b", energy: "high" as const, texture: "bright" as const },
      { speakerId: "c" },
    ]) {
      expect(names.has(matchVoice(analysis).voice)).toBe(true)
    }
  })

  it("lets an explicit choice beat the match", () => {
    const built = buildVoiceProfile(
      { speakerId: "s1", pitch: "low", texture: "warm" },
      { selectedGeminiVoice: "Leda" },
    )
    expect(built.selectedGeminiVoice).toBe("Leda")
    expect(built.confidence).toBe("high")
  })

  it("describes character without claiming anything about the person", () => {
    const text = describeVocalCharacter(profile({ ageStyle: "mature", texture: "warm", pitch: "low" }))
    expect(text).toContain("mature")
    expect(text).toContain("warm")
    // Never a demographic claim.
    expect(text).not.toMatch(/man|woman|male|female|years old|nationality/i)
  })
})

describe("accent direction", () => {
  it("asks for a retained source accent when preserving", () => {
    const note = accentInstruction(profile({ accent: { kind: "preserve-source" } }), "hi", "en")!
    expect(note).toMatch(/Hindi-influenced accent/i)
    expect(note).toMatch(/English/)
    // Not a caricature.
    expect(note).toMatch(/understated|never exaggerated/i)
  })

  it("asks for standard pronunciation when neutral, and drops the source entirely", () => {
    const note = accentInstruction(profile({ accent: { kind: "neutral-target" } }), "hi", "en")!
    expect(note).toMatch(/standard pronunciation/i)
    expect(note).toMatch(/Do not carry over an accent/i)
    expect(note).not.toMatch(/Hindi/i)
  })

  it("passes a custom accent through", () => {
    const note = accentInstruction(
      profile({ accent: { kind: "custom", description: "British English" } }),
      "hi",
      "en",
    )!
    expect(note).toContain("British English")
  })

  it("says nothing about source accent when the source language is unknown", () => {
    expect(accentInstruction(profile(), null, "en")).toBeNull()
  })
})

describe("emotion direction", () => {
  it("carries the observed delivery when matching the original", () => {
    const note = emotionInstruction({ kind: "match-original" }, "excited and fast")!
    expect(note).toMatch(/excited and fast/)
  })

  it("removes expressive direction when set to neutral", () => {
    const note = emotionInstruction({ kind: "neutral" }, "excited and fast")!
    expect(note).toMatch(/plainly|no particular emotional/i)
    // The observation must not leak through.
    expect(note).not.toMatch(/excited/i)
  })

  it("uses a preset or free text when asked", () => {
    expect(emotionInstruction({ kind: "preset", preset: "seriously" })!).toContain("seriously")
    expect(
      emotionInstruction({ kind: "custom", description: "quietly confident but slightly nervous" })!,
    ).toContain("quietly confident but slightly nervous")
  })

  it("claims nothing about mood when the source offered nothing", () => {
    const note = emotionInstruction({ kind: "match-original" }, null)!
    expect(note).toMatch(/original delivery/i)
    expect(note).not.toMatch(/excited|angry|sad/i)
  })
})

describe("the prompt keeps direction out of the dialogue", () => {
  const prompt = buildDubPrompt({
    profile: profile(),
    segments: [
      { startMs: 0, endMs: 4000, text: "No, I'm the teacher." },
      { startMs: 5000, endMs: 9000, text: "Please sit down." },
    ],
    sourceLanguage: "hi",
    targetLanguage: "en",
    scene: "Classroom discussion recorded indoors.",
  })

  it("still contains the direction, for the model", () => {
    expect(prompt).toContain("AUDIO PROFILE")
    expect(prompt).toContain("DIRECTOR'S NOTES")
    expect(prompt).toContain("SCENE")
  })

  it("but the spoken portion is only the lines", () => {
    /**
     * The failure this prevents is a dub that reads "Director's notes" aloud.
     * The words to speak are fenced, and this asserts nothing else got inside.
     */
    const spoken = spokenTextOf(prompt)
    expect(spoken).toBe("No, I'm the teacher.\nPlease sit down.")
    for (const label of INSTRUCTION_LABELS) {
      expect(spoken, `"${label}" must never be spoken`).not.toContain(label)
    }
    expect(spoken).not.toMatch(/accent|pacing|articulate/i)
  })

  it("tells the model plainly not to read the instructions", () => {
    expect(prompt).toMatch(/Do not read these\s*\n?\s*instructions/i)
  })

  it("asks for a duration rather than a playback rate", () => {
    const note = paceInstruction(profile(), 3500)
    expect(note).toMatch(/3\.5 seconds/)
    expect(note).not.toMatch(/\dx|speed up|faster than/i)
  })
})

describe("splitting work into requests", () => {
  it("never mixes two speakers into one chunk", () => {
    const chunks = chunkSegments([
      { startMs: 0, endMs: 1000, speaker: "Speaker 1", text: "one" },
      { startMs: 1000, endMs: 2000, speaker: "Speaker 2", text: "two" },
      { startMs: 2000, endMs: 3000, speaker: "Speaker 1", text: "three" },
    ])
    expect(chunks).toHaveLength(3)
    for (const chunk of chunks) {
      expect(new Set(chunk.map((s) => s.speaker)).size).toBe(1)
    }
  })

  it("breaks up long stretches, because a long take drifts", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      startMs: i * 4000,
      endMs: i * 4000 + 3500,
      speaker: "Speaker 1",
      text: "a reasonably long sentence of translated dialogue here",
    }))
    const chunks = chunkSegments(many)
    expect(chunks.length).toBeGreaterThan(1)
    // And not one request per line either.
    expect(chunks.length).toBeLessThan(many.length)
  })

  it("keeps a short conversation in one request", () => {
    const chunks = chunkSegments([
      { startMs: 0, endMs: 1000, speaker: "Speaker 1", text: "hello" },
      { startMs: 1000, endMs: 2000, speaker: "Speaker 1", text: "there" },
    ])
    expect(chunks).toHaveLength(1)
  })

  it("respects the provider's two-speaker ceiling", () => {
    expect(MAX_SPEAKERS_PER_REQUEST).toBe(2)
    const groups = groupSpeakersForRequests(["S1", "S2", "S3", "S4", "S5"])
    for (const group of groups) expect(group.length).toBeLessThanOrEqual(2)
    // Nobody is dropped, and nobody is merged into someone else's voice.
    expect(groups.flat()).toEqual(["S1", "S2", "S3", "S4", "S5"])
  })

  it("names the TTS model in exactly one place", () => {
    expect(DUB_TTS_MODEL).toMatch(/tts/)
  })
})

describe("fitting speech to the original timeline", () => {
  it("leaves a segment alone when it is close enough", () => {
    const fit = fitSegment({ startMs: 0, endMs: 3500, actualMs: 3550 })
    expect(fit.rate).toBe(1)
    expect(fit.needsReview).toBe(false)
  })

  it("compresses slightly when the translation runs a little long", () => {
    // 10% over: exactly the case the brief describes.
    const fit = fitSegment({ startMs: 12_000, endMs: 15_500, actualMs: 3850 })
    expect(fit.rate).toBeGreaterThan(1)
    expect(fit.rate).toBeLessThanOrEqual(MAX_RATE)
    expect(fit.needsReview).toBe(false)
  })

  it("flags for review rather than producing a chipmunk", () => {
    // Twice as long as its slot. Nothing decent can be done with that.
    const fit = fitSegment({ startMs: 0, endMs: 3000, actualMs: 6000 })
    expect(fit.needsReview).toBe(true)
    expect(fit.rate).toBe(MAX_RATE)
    expect(fit.reason).toMatch(/past the .* limit/i)
  })

  it("never stretches a short line to fill its slot", () => {
    // The gap is silence, and silence plays the original background.
    const fit = fitSegment({ startMs: 0, endMs: 5000, actualMs: 2000 })
    expect(fit.rate).toBe(1)
    expect(fit.needsReview).toBe(false)
  })

  it("summarises what happened across a whole dub", () => {
    const summary = summariseFit(
      fitSegments([
        { startMs: 0, endMs: 3000, actualMs: 3000 },
        { startMs: 3000, endMs: 6000, actualMs: 3300 },
        { startMs: 6000, endMs: 9000, actualMs: 9000 },
      ]),
    )
    expect(summary.total).toBe(3)
    expect(summary.adjusted).toBe(2)
    expect(summary.needsReview).toBe(1)
  })

  it("does not let one segment start before the previous one ends", () => {
    // Two voices from one mono track talking over each other is unlistenable.
    const placed = layoutTimeline(
      fitSegments([
        { startMs: 0, endMs: 1000, actualMs: 2000 },
        { startMs: 1000, endMs: 2000, actualMs: 1000 },
      ]),
    )
    expect(placed[1]!.startMs).toBeGreaterThanOrEqual(placed[0]!.startMs + placed[0]!.playMs)
    expect(placed[1]!.shiftedBy).toBeGreaterThan(0)
  })
})

describe("the separation boundary", () => {
  const stems = {
    dialoguePath: "/tmp/d.wav",
    backgroundPath: "/tmp/b.wav",
    strategy: "separated" as const,
  }
  const working: AudioSeparationBackend = {
    id: "test-backend",
    isAvailable: async () => true,
    separate: async () => stems,
  }
  const missing: AudioSeparationBackend = {
    id: "absent",
    isAvailable: async () => false,
    separate: async () => stems,
  }

  it("uses the first backend that can actually run", async () => {
    const service = new AudioSeparationService([missing, working])
    expect((await service.resolveBackend())?.id).toBe("test-backend")
    expect(await service.isAvailable()).toBe(true)
  })

  it("refuses rather than silently destroying the background", async () => {
    /**
     * The tempting fallback is "no separator, so just replace the whole audio".
     * That throws away the music the feature exists to preserve, and it would
     * do it quietly. Failing loudly is the correct behaviour.
     */
    const service = new AudioSeparationService([missing])
    expect(await service.isAvailable()).toBe(false)
    await expect(
      service.separate({ inputPath: "/tmp/in.wav", workDir: "/tmp" }),
    ).rejects.toThrow(SeparationUnavailableError)
  })

  it("explains what to do about it", async () => {
    const service = new AudioSeparationService([])
    const error = await service
      .separate({ inputPath: "/tmp/in.wav", workDir: "/tmp" })
      .catch((e: Error) => e)
    expect(error.message).toMatch(/music and ambience/i)
  })
})

describe("knowing when a dub is out of date", () => {
  it("changes fingerprint when a voice setting changes", () => {
    const before = voiceSettingsFingerprint([profile()])
    const after = voiceSettingsFingerprint([profile({ selectedGeminiVoice: "Gacrux" })])
    expect(after).not.toBe(before)
  })

  it("changes fingerprint when the accent mode changes", () => {
    const preserve = voiceSettingsFingerprint([profile({ accent: { kind: "preserve-source" } })])
    const neutral = voiceSettingsFingerprint([profile({ accent: { kind: "neutral-target" } })])
    expect(neutral).not.toBe(preserve)
  })

  it("changes fingerprint when the emotion changes", () => {
    const match = voiceSettingsFingerprint([profile({ emotion: { kind: "match-original" } })])
    const neutral = voiceSettingsFingerprint([profile({ emotion: { kind: "neutral" } })])
    expect(neutral).not.toBe(match)
  })

  it("is stable for the same settings, so regenerating reproduces the dub", () => {
    expect(voiceSettingsFingerprint([profile()])).toBe(voiceSettingsFingerprint([profile()]))
  })

  it("does not depend on the order speakers arrive in", () => {
    const a = profile({ speakerId: "Speaker 1" })
    const b = profile({ speakerId: "Speaker 2", selectedGeminiVoice: "Leda" })
    expect(voiceSettingsFingerprint([a, b])).toBe(voiceSettingsFingerprint([b, a]))
  })
})
