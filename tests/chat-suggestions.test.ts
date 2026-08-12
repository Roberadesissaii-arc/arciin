import { describe, expect, it } from "vitest"

import {
  attachmentKindFor,
  attachmentSuggestions,
  canvasSectionTitles,
  describeCanvasDraft,
  followUpSuggestions,
} from "@arciin/shared"

describe("attachmentKindFor", () => {
  it("uses the media type when present", () => {
    expect(attachmentKindFor({ mediaType: "DOCUMENT" })).toBe("document")
    expect(attachmentKindFor({ mediaType: "IMAGE" })).toBe("image")
  })

  it("falls back to the extension", () => {
    expect(attachmentKindFor({ filename: "book.pdf" })).toBe("document")
    expect(attachmentKindFor({ filename: "clip.mp4" })).toBe("video")
    expect(attachmentKindFor({ extension: "py" })).toBe("code")
  })

  it("does not guess when it cannot tell", () => {
    expect(attachmentKindFor({ filename: "archive.bin" })).toBe("other")
    expect(attachmentKindFor({})).toBe("other")
  })
})

describe("attachmentSuggestions", () => {
  it("offers writing templates for a document", () => {
    const ids = attachmentSuggestions({ kind: "document", filename: "book.pdf" }).map((s) => s.id)
    expect(ids).toContain("summarize")
    expect(ids).toContain("essay")
    expect(ids).toContain("research")
  })

  it("puts the filename into the summarize prompt so it is ready to send", () => {
    const summarize = attachmentSuggestions({ kind: "document", filename: "book.pdf" }).find(
      (s) => s.id === "summarize",
    )
    expect(summarize?.prompt).toContain("book.pdf")
  })

  it("offers different templates per kind", () => {
    expect(attachmentSuggestions({ kind: "image" }).map((s) => s.id)).toContain("describe")
    expect(attachmentSuggestions({ kind: "code" }).map((s) => s.id)).toContain("review")
  })

  it("keeps every list short enough to scan", () => {
    // A dozen options is a menu to read, not a shortcut.
    for (const kind of ["document", "image", "code", "video", "audio", "other"] as const) {
      expect(attachmentSuggestions({ kind }).length).toBeLessThanOrEqual(5)
    }
  })
})

describe("followUpSuggestions", () => {
  it("offers targeted edits when a draft exists", () => {
    const suggestions = followUpSuggestions({
      hasCanvasDraft: true,
      sectionTitles: ["Overview", "The Ramanujan Code", "Conclusion"],
    })
    // The named section proves the edit is targeted rather than a rewrite.
    expect(suggestions[0]!.label).toContain("Overview")
    expect(suggestions[0]!.prompt).toContain("/modify")
  })

  it("routes every draft edit through /modify, never a fresh generation", () => {
    const suggestions = followUpSuggestions({ hasCanvasDraft: true, sectionTitles: ["Intro"] })
    const edits = suggestions.filter((s) => s.id !== "save")
    expect(edits.every((s) => s.prompt.startsWith("/modify"))).toBe(true)
  })

  it("offers to save an unsaved draft", () => {
    expect(
      followUpSuggestions({ hasCanvasDraft: true, canvasUnsaved: true }).map((s) => s.id),
    ).toContain("save")
  })

  it("offers to open one file after a listing", () => {
    expect(followUpSuggestions({ listedAssets: true }).map((s) => s.id)).toContain("summarize")
  })

  it("suggests nothing after a one-line answer", () => {
    // "Go deeper" on a fifteen-word reply is noise.
    expect(followUpSuggestions({ replyWordCount: 8 })).toEqual([])
  })

  it("suggests depth after a substantial answer", () => {
    expect(followUpSuggestions({ replyWordCount: 200 }).map((s) => s.id)).toContain("deeper")
  })

  it("never shows more than four chips", () => {
    const many = followUpSuggestions({
      hasCanvasDraft: true,
      canvasUnsaved: true,
      sectionTitles: ["A", "B", "C", "D", "E"],
    })
    expect(many.length).toBeLessThanOrEqual(4)
  })
})

describe("canvasSectionTitles", () => {
  it("reads headings in order", () => {
    expect(
      canvasSectionTitles("# Title\n\n## Overview\n\ntext\n\n### Detail\n\n## Conclusion"),
    ).toEqual(["Overview", "Detail", "Conclusion"])
  })

  it("ignores headings inside code fences", () => {
    expect(canvasSectionTitles("```\n## not a heading\n```\n\n## Real")).toEqual(["Real"])
  })

  it("strips emphasis markers from the label", () => {
    expect(canvasSectionTitles("## **Bold** section")).toEqual(["Bold section"])
  })
})

describe("describeCanvasDraft", () => {
  it("names the shape of the document rather than praising it", () => {
    // "A compelling, comprehensive piece" says nothing and is exactly the
    // filler the reader is trying to get away from.
    const line = describeCanvasDraft({
      content: "# T\n\n## Overview\n\nx\n\n## Conclusion\n\ny",
      words: 1777,
    })
    expect(line).toContain("1,777 words")
    expect(line).toContain("Overview")
    expect(line).toContain("Conclusion")
    expect(line).toMatch(/2 sections/)
  })

  it("handles a draft with no headings", () => {
    expect(describeCanvasDraft({ content: "just prose", words: 12 })).toContain("about 12 words")
  })

  it("handles a single section", () => {
    expect(describeCanvasDraft({ content: "## Only\n\nx", words: 5 })).toContain("“Only”")
  })

  it("counts words itself when not given a count", () => {
    expect(describeCanvasDraft({ content: "one two three" })).toContain("3 words")
  })
})
