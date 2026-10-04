import { describe, expect, it } from "vitest"

import {
  IMPORT_FALLBACK_STEM,
  IMPORT_FILENAME_STEM_MAX_BYTES,
  canonicalImportTitle,
  cleanImportTitle,
  htmlTitleText,
  isGenericImportTitle,
  sanitizeImportFilename,
} from "@arciin/shared"

const bytes = (s: string) => new TextEncoder().encode(s).length

describe("canonicalImportTitle — source order", () => {
  const all = {
    candidateTitle: "Candidate title",
    ytDlpTitle: "yt-dlp title",
    ogTitle: "OG title",
    jsonLdName: "JSON-LD name",
    htmlTitle: "HTML title",
    contentDispositionName: "disposition.mp4",
    urlFilename: "url-name.mp4",
  }

  it("takes the first trustworthy source", () => {
    expect(canonicalImportTitle(all)).toMatchObject({ title: "Candidate title", source: "candidateTitle", descriptive: true })
    expect(canonicalImportTitle({ ...all, candidateTitle: null })?.source).toBe("ytDlpTitle")
    expect(canonicalImportTitle({ ...all, candidateTitle: null, ytDlpTitle: null })?.source).toBe("ogTitle")
    expect(canonicalImportTitle({ jsonLdName: "Name", htmlTitle: "Html" })?.source).toBe("jsonLdName")
    expect(canonicalImportTitle({ htmlTitle: "Html page" })?.source).toBe("htmlTitle")
  })

  it("filename sources lose their extension and are not 'descriptive'", () => {
    expect(canonicalImportTitle({ contentDispositionName: "Quarterly Report.pdf" })).toEqual({
      title: "Quarterly Report",
      source: "contentDispositionName",
      descriptive: false,
    })
    expect(canonicalImportTitle({ urlFilename: "Annual%20Report%202026.pdf" })?.title).toBe("Annual Report 2026")
  })

  it("a candidate 'title' that is really a filename is used as a name, not a title", () => {
    expect(canonicalImportTitle({ candidateTitle: "Annual Report.pdf" })).toEqual({
      title: "Annual Report",
      source: "candidateTitle",
      descriptive: false,
    })
  })

  it("skips generic and opaque names: preview, a YouTube id, a hash, a host, placeholders", () => {
    expect(canonicalImportTitle({ candidateTitle: "YouTube video 1", ytDlpTitle: "Real Title" })?.title).toBe("Real Title")
    expect(canonicalImportTitle({ ytDlpTitle: "dQw4w9WgXcQ", ogTitle: "Never Gonna Give You Up" })?.title).toBe("Never Gonna Give You Up")
    expect(canonicalImportTitle({ urlFilename: "preview.mp4" })).toBeNull()
    expect(canonicalImportTitle({ urlFilename: "e3b0c44298fc1c149afbf4c8996fb924.mp4" })).toBeNull()
    expect(canonicalImportTitle({ urlFilename: "www.example.com" })).toBeNull()
    expect(canonicalImportTitle({ candidateTitle: "Item 3" })).toBeNull()
    expect(canonicalImportTitle({})).toBeNull()
  })

  it("keeps ordinary words that merely look short", () => {
    expect(isGenericImportTitle("Redundancy")).toBe(false)
    expect(isGenericImportTitle("Video Essay on Rome")).toBe(false)
    expect(isGenericImportTitle("2001: A Space Odyssey")).toBe(false)
  })
})

describe("cleanImportTitle", () => {
  it("keeps punctuation, Unicode and emoji; removes control and bidi-override characters", () => {
    expect(cleanImportTitle("Building a Data Center — Redundancy Explained")).toBe("Building a Data Center — Redundancy Explained")
    expect(cleanImportTitle("  Ça va?  ¿Qué tal? 🎉  ")).toBe("Ça va? ¿Qué tal? 🎉")
    expect(cleanImportTitle("evil‮gnp.exe")).toBe("evil gnp.exe")
    expect(cleanImportTitle("line\nbreak\ttab\u0000nul")).toBe("line break tab nul")
  })

  it("bounds length without splitting an emoji", () => {
    const long = "🎉".repeat(400)
    const out = cleanImportTitle(long)!
    expect(Array.from(out).length).toBeLessThanOrEqual(300)
    expect(out.endsWith("…")).toBe(true)
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe("sanitizeImportFilename", () => {
  it("the data-center example", () => {
    expect(sanitizeImportFilename("Building a Data Center — Redundancy Explained", "mp4")).toBe(
      "Building a Data Center — Redundancy Explained.mp4",
    )
  })

  it("audio keeps the source title", () => {
    expect(sanitizeImportFilename("My Podcast Episode", "mp3")).toBe("My Podcast Episode.mp3")
    expect(sanitizeImportFilename("My Podcast Episode", "m4a")).toBe("My Podcast Episode.m4a")
  })

  it("slashes and colons cannot name a directory or a stream", () => {
    expect(sanitizeImportFilename("AC/DC: Live", "mp4")).toBe("AC - DC - Live.mp4")
    expect(sanitizeImportFilename("a\\b", "mp4")).toBe("a - b.mp4")
    expect(sanitizeImportFilename("../../etc/passwd", "txt")).toBe("etc - passwd.txt")
    expect(sanitizeImportFilename("..", "mp4")).toBe(`${IMPORT_FALLBACK_STEM}.mp4`)
    const out = sanitizeImportFilename("../x/../../y", "mp4")
    expect(out).not.toContain("..")
    expect(out).not.toMatch(/[\\/]/)
  })

  it("Windows-reserved characters and device names", () => {
    expect(sanitizeImportFilename('What? "Really" <yes> | *no*', "mp4")).toBe("What Really yes no.mp4")
    expect(sanitizeImportFilename("CON", "txt")).toBe("CON_.txt")
    expect(sanitizeImportFilename("nul", "mp3")).toBe("nul_.mp3")
  })

  it("trims trailing dots and spaces, never starts with a dot, never empty", () => {
    expect(sanitizeImportFilename("Title...  ", "mp4")).toBe("Title.mp4")
    expect(sanitizeImportFilename(".hidden", "mp4")).toBe("hidden.mp4")
    expect(sanitizeImportFilename("", "mp4")).toBe(`${IMPORT_FALLBACK_STEM}.mp4`)
    expect(sanitizeImportFilename(null, "")).toBe(IMPORT_FALLBACK_STEM)
    expect(sanitizeImportFilename("\u0000\u0001", "mp4")).toBe(`${IMPORT_FALLBACK_STEM}.mp4`)
  })

  it("keeps Unicode and emoji, bounds the stem in bytes, keeps the real extension", () => {
    expect(sanitizeImportFilename("東京の夜 🌃", "mp4")).toBe("東京の夜 🌃.mp4")
    const long = sanitizeImportFilename("日本語".repeat(200), "mp4")
    expect(long.endsWith(".mp4")).toBe(true)
    expect(bytes(long.slice(0, -4))).toBeLessThanOrEqual(IMPORT_FILENAME_STEM_MAX_BYTES)
    expect(sanitizeImportFilename("Clip", "MP4")).toBe("Clip.mp4")
    expect(sanitizeImportFilename("Clip", "mp4;rm -rf")).toBe("Clip")
  })

  it("does not double an extension the title already has", () => {
    expect(sanitizeImportFilename("clip.mp4", "mp4")).toBe("clip.mp4")
    expect(sanitizeImportFilename("Season 1.5 recap", "mp4")).toBe("Season 1.5 recap.mp4")
  })

  it("duplicate titles give the same name (the asset id keeps them apart)", () => {
    expect(sanitizeImportFilename("Same", "mp4")).toBe(sanitizeImportFilename("Same", "mp4"))
  })
})

describe("htmlTitleText", () => {
  it("reads <title> and drops a trailing site name", () => {
    expect(htmlTitleText("<html><title>Great Talk | Conference Site</title>")).toBe("Great Talk")
    expect(htmlTitleText("<title>Just this</title>")).toBe("Just this")
    expect(htmlTitleText("<p>no title</p>")).toBeNull()
  })
})
