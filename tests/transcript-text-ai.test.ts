import { describe, expect, it } from "vitest"

import {
  applyTranslation,
  buildTitlePrompt,
  buildTranslationPrompt,
  parseTitles,
} from "../packages/media-ai/src/transcript-text-ai"
import { isSameLanguage, languageName, translationLanguageOptions } from "../packages/types/src/languages"
import { titleToFilename } from "../apps/web/components/libraries/video-ai-title"

/**
 * Translation is a text transformation, not a retranscription.
 *
 * Everything here guards that sentence. The timeline belongs to the original
 * recording; a model asked to restate it will drift, and a drifted timestamp
 * stops seeking the video — which looks like a broken player rather than a bad
 * translation.
 */

const ORIGINAL = [
  { startMs: 0, endMs: 4000, speaker: "Speaker 1", text: "Hello everyone." },
  { startMs: 5000, endMs: 9000, speaker: "Speaker 2", text: "Today we're discussing Arciin." },
]

describe("translating segments", () => {
  it("keeps the original timings", () => {
    const { segments } = applyTranslation(
      ORIGINAL,
      JSON.stringify({
        segments: [
          { index: 0, text: "Hola a todos." },
          { index: 1, text: "Hoy hablamos de Arciin." },
        ],
      }),
    )

    expect(segments).toHaveLength(2)
    expect(segments.map((s) => s.startMs)).toEqual([0, 5000])
    expect(segments.map((s) => s.endMs)).toEqual([4000, 9000])
    expect(segments.map((s) => s.text)).toEqual(["Hola a todos.", "Hoy hablamos de Arciin."])
  })

  it("keeps speaker labels attached to the same lines", () => {
    const { segments } = applyTranslation(
      ORIGINAL,
      JSON.stringify({ segments: [{ index: 1, text: "Hoy hablamos de Arciin." }] }),
    )
    expect(segments[0]!.speaker).toBe("Speaker 1")
    expect(segments[1]!.speaker).toBe("Speaker 2")
  })

  it("leaves a line in its original words when the model skips it", () => {
    // Better a missing translation than a missing line: dropping the entry
    // would shift every timestamp after it.
    const { segments } = applyTranslation(
      ORIGINAL,
      JSON.stringify({ segments: [{ index: 0, text: "Hola a todos." }] }),
    )
    expect(segments).toHaveLength(2)
    expect(segments[1]!.text).toBe("Today we're discussing Arciin.")
    expect(segments[1]!.startMs).toBe(5000)
  })

  it("survives a model that returns nonsense", () => {
    const { segments, fullText } = applyTranslation(ORIGINAL, "not json at all")
    expect(segments.map((s) => s.startMs)).toEqual([0, 5000])
    expect(segments.map((s) => s.text)).toEqual(ORIGINAL.map((s) => s.text))
    expect(fullText).toContain("Hello everyone.")
  })

  it("ignores extra entries the model invents", () => {
    const { segments } = applyTranslation(
      ORIGINAL,
      JSON.stringify({
        segments: [
          { index: 0, text: "Hola." },
          { index: 1, text: "Hoy." },
          { index: 2, text: "Una frase que no existe." },
        ],
      }),
    )
    // Two in, two out. A third line would carry a timestamp nobody recorded.
    expect(segments).toHaveLength(2)
  })
})

describe("the translation prompt", () => {
  it("sends transcript text, indexed, and never asks for timings", () => {
    const prompt = buildTranslationPrompt(ORIGINAL, "Spanish", "English")
    expect(prompt).toContain("Hello everyone.")
    expect(prompt).toContain("Today we're discussing Arciin.")
    expect(prompt).toContain("Spanish")
    expect(prompt).toContain("English")
    // The model is never invited to produce a timeline: no timing fields are
    // named, and the only mention of timestamps is an instruction not to emit
    // any. Timings are carried over in code, by `applyTranslation`.
    expect(prompt).not.toMatch(/startMs|endMs/)
    expect(prompt).toMatch(/Do not add[^\n]*timestamps/i)
    expect(prompt).toContain("same index")
  })

  it("carries no media reference of any kind", () => {
    const prompt = buildTranslationPrompt(ORIGINAL, "Amharic")
    expect(prompt).not.toMatch(/video|audio|mp4|file|upload/i)
  })
})

describe("title suggestions", () => {
  it("reads titles out of a structured reply", () => {
    const titles = parseTitles(
      JSON.stringify({ titles: ["Teacher Clarifies Her Role During Class", "A Quick Role Mix-Up"] }),
    )
    expect(titles).toEqual([
      "Teacher Clarifies Her Role During Class",
      "A Quick Role Mix-Up",
    ])
  })

  it("strips the quotes and extensions models add anyway", () => {
    const titles = parseTitles(
      JSON.stringify({ titles: ['"A Classroom Conversation"', "Something Useful.mp4", "“Curly”"] }),
    )
    expect(titles).toEqual(["A Classroom Conversation", "Something Useful", "Curly"])
  })

  it("drops blanks and duplicates", () => {
    const titles = parseTitles(
      JSON.stringify({ titles: ["One Title", "one title", "   ", "", "Another"] }),
    )
    expect(titles).toEqual(["One Title", "Another"])
  })

  it("returns nothing rather than guessing when the reply is unusable", () => {
    expect(parseTitles("garbage")).toEqual([])
    expect(parseTitles(JSON.stringify({ titles: "not an array" }))).toEqual([])
  })

  it("prompts for the transcript, not the file", () => {
    const prompt = buildTitlePrompt("Hello everyone. Today we're discussing Arciin.")
    expect(prompt).toContain("Today we're discussing Arciin.")
    expect(prompt).toMatch(/never/i)
    expect(prompt).toMatch(/quotation marks/i)
  })
})

describe("applying a title to a filename", () => {
  it("keeps the original extension", () => {
    expect(titleToFilename("Teacher Clarifies Her Role During Class", "7492908407147073536.mp4")).toBe(
      "Teacher Clarifies Her Role During Class.mp4",
    )
    expect(titleToFilename("A Quiet Morning", "IMG_9274920381.mov")).toBe("A Quiet Morning.mov")
  })

  it("never lets a title change the extension", () => {
    // The model does not get to decide what kind of file this is.
    expect(titleToFilename("Something.avi", "clip.mp4")).toBe("Something.avi.mp4")
  })

  it("removes characters a filename cannot carry", () => {
    expect(titleToFilename('A/B: "C" <D>|E', "clip.mp4")).toBe("A-B- C -D--E.mp4")
  })

  it("flattens line breaks rather than writing them into a name", () => {
    expect(titleToFilename("Two\nLines\tHere", "clip.mp4")).toBe("Two Lines Here.mp4")
  })

  it("falls back to the original name when a title is empty", () => {
    expect(titleToFilename("   ", "clip.mp4")).toBe("clip.mp4")
    expect(titleToFilename('"""', "clip.mp4")).toBe("clip.mp4")
  })

  it("stays inside the length the API accepts", () => {
    const result = titleToFilename("word ".repeat(200), "clip.mp4")
    expect(result.length).toBeLessThanOrEqual(255)
    expect(result.endsWith(".mp4")).toBe(true)
  })

  it("handles a file with no extension at all", () => {
    expect(titleToFilename("A Title", "noextension")).toBe("A Title")
  })
})

describe("the language list", () => {
  it("covers the languages the request named", () => {
    const tags = new Set(translationLanguageOptions().map((o) => o.tag))
    for (const tag of ["en", "am", "om", "es", "fr", "ar", "de", "pt", "zh", "ja", "ko", "hi"]) {
      expect(tags.has(tag), `${tag} should be offered`).toBe(true)
    }
  })

  it("names languages rather than showing raw tags", () => {
    expect(languageName("am")).toBe("Amharic")
    expect(languageName("om")).toMatch(/Oromo/i)
    expect(languageName("es")).toBe("Spanish")
  })

  it("shows an unknown tag as itself rather than inventing a name", () => {
    expect(languageName("zz-not-a-language")).toBe("zz-not-a-language")
    expect(languageName(null)).toBe("")
  })

  it("treats regional variants as the same language", () => {
    // "en-GB" into "en" is a paid request that could only return its input.
    expect(isSameLanguage("en-GB", "en")).toBe(true)
    expect(isSameLanguage("pt-BR", "pt")).toBe(true)
    expect(isSameLanguage("es", "en")).toBe(false)
    expect(isSameLanguage(null, "en")).toBe(false)
  })
})
