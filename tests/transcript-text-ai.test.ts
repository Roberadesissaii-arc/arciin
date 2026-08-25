import { describe, expect, it } from "vitest"

import {
  applyTranslation,
  buildSummaryPrompt,
  buildTitlePrompt,
  buildTranslationPrompt,
  parseSummaryPayload,
  parseTitles,
  parseTitleResponse,
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
  it("caps long model replies to one or two words", () => {
    const titles = parseTitles(
      JSON.stringify({ titles: ["Teacher Clarifies Her Role During Class", "A Quick Role Mix-Up"] }),
    )
    expect(titles).toEqual(["Teacher Clarifies", "A Quick"])
  })

  it("strips the quotes and extensions models add anyway", () => {
    const titles = parseTitles(
      JSON.stringify({ titles: ['"Classroom chat"', "Budget tips.mp4", "“Curly”"] }),
    )
    expect(titles).toEqual(["Classroom chat", "Budget tips", "Curly"])
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

  it("prompts for short library-style titles from the transcript", () => {
    const prompt = buildTitlePrompt("Hello everyone. Today we're discussing Arciin.")
    expect(prompt).toContain("Today we're discussing Arciin.")
    expect(prompt).toMatch(/ONE or TWO words/i)
    expect(prompt).toMatch(/quotation marks/i)
  })

  it("asks the model to name a released work before describing it", () => {
    const prompt = buildTitlePrompt("Mr Wayne, the Joker has taken the ferry.")
    expect(prompt).toMatch(/already-released work/i)
    expect(prompt).toMatch(/movie/i)
    expect(prompt).toMatch(/exact released title/i)
    // Length cap applies to the generic labels, never to a real title.
    expect(prompt).toMatch(/even when it runs longer than two words/i)
  })

  it("warns the model off guessing a famous title", () => {
    const prompt = buildTitlePrompt("Some people talking.")
    expect(prompt).toMatch(/confident.*false|unsure/i)
    expect(prompt).toMatch(/wrong film title/i)
  })
})

describe("identifying a released work from a transcript", () => {
  it("leads with the real film name, past the two-word cap", () => {
    const parsed = parseTitleResponse(
      JSON.stringify({
        work: { kind: "movie", title: "The Dark Knight", confident: true },
        titles: ["Gotham chaos", "Ferry choice"],
      }),
    )
    expect(parsed.work).toEqual({ kind: "movie", title: "The Dark Knight" })
    expect(parsed.titles[0]).toBe("The Dark Knight")
    expect(parsed.titles).toEqual(["The Dark Knight", "Gotham chaos", "Ferry choice"])
  })

  it("ignores a work the model is not confident about", () => {
    const parsed = parseTitleResponse(
      JSON.stringify({
        work: { kind: "movie", title: "Inception", confident: false },
        titles: ["Dream heist", "Spinning top"],
      }),
    )
    expect(parsed.work).toBeNull()
    expect(parsed.titles).toEqual(["Dream heist", "Spinning top"])
  })

  it("still returns short labels when nothing is identified", () => {
    const parsed = parseTitleResponse(JSON.stringify({ titles: ["Coffee", "Tokyo night"] }))
    expect(parsed.work).toBeNull()
    expect(parsed.titles).toEqual(["Coffee", "Tokyo night"])
  })

  it("cleans a work title the same way as a label, minus the cap", () => {
    const parsed = parseTitleResponse(
      JSON.stringify({
        work: { kind: "movie", title: '"Spirited Away.mp4"', confident: true },
        titles: ["Bath house"],
      }),
    )
    expect(parsed.titles[0]).toBe("Spirited Away")
  })

  it("treats an article-stripped repeat as the same answer", () => {
    // The model really does return both of these together.
    const parsed = parseTitleResponse(
      JSON.stringify({
        work: { kind: "movie", title: "The Dark Knight", confident: true },
        titles: ["Batman", "Joker", "Dark Knight"],
      }),
    )
    expect(parsed.titles).toEqual(["The Dark Knight", "Batman", "Joker"])
  })

  it("does not repeat the work title as a label", () => {
    const parsed = parseTitleResponse(
      JSON.stringify({
        work: { kind: "movie", title: "Alien", confident: true },
        titles: ["Alien", "Nostromo"],
      }),
    )
    expect(parsed.titles).toEqual(["Alien", "Nostromo"])
  })

  it("survives a reply with no usable work block", () => {
    expect(parseTitleResponse("garbage")).toEqual({ work: null, titles: [] })
    expect(
      parseTitleResponse(JSON.stringify({ work: "not an object", titles: ["Coffee"] })),
    ).toEqual({ work: null, titles: ["Coffee"] })
    expect(
      parseTitleResponse(JSON.stringify({ work: { kind: "movie", confident: true }, titles: [] })),
    ).toEqual({ work: null, titles: [] })
  })
})

describe("video summary metadata", () => {
  it("asks for about / topics so movie explainers surface the film", () => {
    const prompt = buildSummaryPrompt("Today we break down the ending of Inception.")
    expect(prompt).toMatch(/about/i)
    expect(prompt).toMatch(/movie/i)
    expect(prompt).toMatch(/topics/i)
  })

  it("parses a movie about block and lifts title into keywords", () => {
    const parsed = parseSummaryPayload(
      JSON.stringify({
        summary: "A recap of the heist layers in Inception.",
        keywords: ["dream", "heist"],
        links: [],
        topics: ["movie explanation"],
        about: { kind: "movie", title: "Inception", note: "2010 · Christopher Nolan" },
      }),
    )
    expect(parsed.about).toEqual({
      kind: "movie",
      title: "Inception",
      note: "2010 · Christopher Nolan",
    })
    expect(parsed.topics).toEqual(["movie explanation"])
    expect(parsed.keywords[0]).toBe("Inception")
    expect(parsed.keywords).toContain("movie")
  })

  it("returns null about when the model is unsure", () => {
    const parsed = parseSummaryPayload(
      JSON.stringify({
        summary: "Casual chat.",
        keywords: ["chat"],
        links: [],
        topics: ["conversation"],
      }),
    )
    expect(parsed.about).toBeNull()
  })
})

describe("applying a title to a filename", () => {
  it("keeps the original extension", () => {
    expect(titleToFilename("Classroom chat", "7492908407147073536.mp4")).toBe("Classroom chat.mp4")
    expect(titleToFilename("Quiet morning", "IMG_9274920381.mov")).toBe("Quiet morning.mov")
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
