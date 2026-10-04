import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { importNaming, readYtDlpInfo } from "../apps/worker/src/services/import-naming"
import { extractJsonLdName } from "../apps/worker/src/services/link-extraction"

/**
 * What an imported file is called, per source. The object on disk stays
 * `<sha256>.<ext>` (url-import.ts); only the asset's title and
 * originalFilename are decided here.
 */

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function infoDir(info: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), "arciin-ytdlp-"))
  dirs.push(dir)
  await writeFile(path.join(dir, "abc123XYZ_0.mp4"), "x")
  await writeFile(path.join(dir, "abc123XYZ_0.info.json"), JSON.stringify(info))
  return dir
}

describe("yt-dlp structured metadata", () => {
  it("reads title, id, uploader, duration, page, thumbnail and extension from the info JSON", async () => {
    const dir = await infoDir({
      id: "abc123XYZ_0",
      title: "Building a Data Center — Redundancy Explained",
      uploader: "Server Room",
      duration: 754.2,
      webpage_url: "https://www.youtube.com/watch?v=abc123XYZ_0",
      thumbnail: "https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg",
      ext: "mp4",
      extractor_key: "Youtube",
      formats: [{ format_id: "18" }],
    })
    expect(await readYtDlpInfo(dir)).toEqual({
      id: "abc123XYZ_0",
      title: "Building a Data Center — Redundancy Explained",
      uploader: "Server Room",
      durationSeconds: 754.2,
      webpageUrl: "https://www.youtube.com/watch?v=abc123XYZ_0",
      thumbnail: "https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg",
      extension: "mp4",
      extractor: "Youtube",
    })
  })

  it("no info file, or a broken one, is simply no metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arciin-ytdlp-"))
    dirs.push(dir)
    expect(await readYtDlpInfo(dir)).toBeNull()
    await writeFile(path.join(dir, "x.info.json"), "{not json")
    expect(await readYtDlpInfo(dir)).toBeNull()
  })
})

describe("importNaming", () => {
  const download = (extra: Record<string, unknown> = {}) => ({ filename: "abc123XYZ_0.mp4", ...extra })

  it("YouTube video: yt-dlp's title, not the id", () => {
    expect(importNaming(download({ sourceTitle: "Building a Data Center — Redundancy Explained" }), { candidateTitle: null, extension: "mp4" })).toEqual({
      title: "Building a Data Center — Redundancy Explained",
      originalFilename: "Building a Data Center — Redundancy Explained.mp4",
    })
  })

  it("playlist candidate: the server-stored candidate title comes first", () => {
    expect(
      importNaming(download({ sourceTitle: "yt title" }), { candidateTitle: "Episode 4: The Return", extension: "mp4" }),
    ).toEqual({ title: "Episode 4: The Return", originalFilename: "Episode 4 - The Return.mp4" })
  })

  it("YouTube audio (MP3 / M4A) keeps the source title", () => {
    const d = download({ filename: "abc123XYZ_0.mp3", sourceTitle: "My Podcast Episode" })
    expect(importNaming(d, { candidateTitle: null, extension: "mp3" }).originalFilename).toBe("My Podcast Episode.mp3")
    expect(importNaming({ ...d, filename: "abc123XYZ_0.m4a" }, { candidateTitle: null, extension: "m4a" }).originalFilename).toBe(
      "My Podcast Episode.m4a",
    )
  })

  it("Vimeo / TikTok: a numeric id is not a name; the page's og:title is", () => {
    expect(
      importNaming(
        { filename: "76979871.mp4", sourceTitle: null, page: { ogTitle: "The Mountain", jsonLdName: null, htmlTitle: "The Mountain on Vimeo" } },
        { candidateTitle: null, extension: "mp4" },
      ),
    ).toEqual({ title: "The Mountain", originalFilename: "The Mountain.mp4" })
    expect(
      importNaming({ filename: "7301234567890123456.mp4", sourceTitle: "dance challenge 🔥 #fyp" }, { candidateTitle: null, extension: "mp4" })
        .originalFilename,
    ).toBe("dance challenge 🔥 #fyp.mp4")
  })

  it("OpenGraph page, JSON-LD, then <title>", () => {
    const page = (p: Partial<{ ogTitle: string; jsonLdName: string; htmlTitle: string }>) => ({
      filename: "preview.mp4",
      page: { ogTitle: null, jsonLdName: null, htmlTitle: null, ...p },
    })
    const opts = { candidateTitle: null, extension: "mp4" }
    expect(importNaming(page({ ogTitle: "OG Name", jsonLdName: "LD", htmlTitle: "Html" }), opts).title).toBe("OG Name")
    expect(importNaming(page({ jsonLdName: "LD Name", htmlTitle: "Html" }), opts).title).toBe("LD Name")
    expect(importNaming(page({ htmlTitle: "Page Title" }), opts).title).toBe("Page Title")
  })

  it("direct file: Content-Disposition, then the URL — as a name, not a title", () => {
    expect(
      importNaming({ filename: "direct-1.pdf", contentDispositionName: "Quarterly Report Q3.pdf", urlFilename: "dl.pdf" }, { candidateTitle: null, extension: "pdf" }),
    ).toEqual({ title: null, originalFilename: "Quarterly Report Q3.pdf" })
    expect(importNaming({ filename: "x.pdf", urlFilename: "Annual%20Report.pdf" }, { candidateTitle: null, extension: "pdf" })).toEqual({
      title: null,
      originalFilename: "Annual Report.pdf",
    })
  })

  it("Unicode, emoji, slash, colon, a very long title", () => {
    const opts = { candidateTitle: null, extension: "mp4" }
    expect(importNaming(download({ sourceTitle: "東京 🌃: night/day" }), opts)).toEqual({
      title: "東京 🌃: night/day",
      originalFilename: "東京 🌃 - night - day.mp4",
    })
    const long = importNaming(download({ sourceTitle: "word ".repeat(200) }), opts)
    expect(new TextEncoder().encode(long.originalFilename).length).toBeLessThanOrEqual(200)
    expect(long.originalFilename.endsWith(".mp4")).toBe(true)
  })

  it("duplicate titles name two files the same; the assets stay distinct by id", () => {
    const a = importNaming(download({ sourceTitle: "Same Title" }), { candidateTitle: null, extension: "mp4" })
    const b = importNaming(download({ sourceTitle: "Same Title" }), { candidateTitle: null, extension: "mp4" })
    expect(a).toEqual(b)
  })

  it("no title anywhere: a safe fallback from the downloaded name, never empty", () => {
    expect(importNaming({ filename: "preview.mp4" }, { candidateTitle: null, extension: "mp4" })).toEqual({
      title: null,
      originalFilename: "preview.mp4",
    })
    expect(importNaming({ filename: "" }, { candidateTitle: null, extension: "mp4" }).originalFilename).toBe("Imported media.mp4")
    expect(importNaming({ filename: "../../x" }, { candidateTitle: null, extension: "" }).originalFilename).not.toMatch(/\.\.|\//)
  })
})

describe("extractJsonLdName", () => {
  it("prefers a media node, falls back to a top-level name, ignores broken blocks", () => {
    const html = `
      <script type="application/ld+json">{broken</script>
      <script type="application/ld+json">{"@type":"WebSite","name":"Site"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"VideoObject","name":"Talk &amp; Demo"}]}</script>`
    expect(extractJsonLdName(html)).toBe("Talk & Demo")
    expect(extractJsonLdName(`<script type="application/ld+json">{"@type":"WebSite","name":"Only Site"}</script>`)).toBe("Only Site")
    expect(extractJsonLdName("<p>nothing</p>")).toBeNull()
  })
})
