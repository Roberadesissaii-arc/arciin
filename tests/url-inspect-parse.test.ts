import { Readable } from "node:stream"

import { describe, expect, it } from "vitest"

import {
  canonicalMediaKey,
  extractPageCandidates,
  importableMediaUrl,
  isoDurationSeconds,
  outcomeFromPage,
  outcomeFromYtDlp,
  readTextCapped,
} from "../apps/worker/src/services/url-inspect-parse"

/**
 * Link inspection's discovery: what one page or one yt-dlp answer amounts to.
 * At most five items, duplicates merged, nothing private, nothing DRM.
 */

const PAGE = "https://videos.example.com/gallery"

const html = (body: string, head = "") => `<html><head>${head}</head><body>${body}</body></html>`

describe("page discovery", () => {
  it("finds <video> and <source> elements, with the poster as thumbnail", () => {
    const items = extractPageCandidates(
      html(`
        <video src="/clips/one.mp4" poster="/p/one.jpg" title="First clip"></video>
        <video poster="/p/two.jpg"><source src="https://cdn.example.com/two.webm" type="video/webm"></video>`),
      PAGE,
    )
    expect(items.map((i) => i.url)).toEqual(["https://videos.example.com/clips/one.mp4", "https://cdn.example.com/two.webm"])
    expect(items[0]).toMatchObject({ title: "First clip", thumbnail: "https://videos.example.com/p/one.jpg", category: "video" })
  })

  it("reads Open Graph video", () => {
    const out = outcomeFromPage(
      html("", `<meta property="og:video" content="https://cdn.example.com/og.mp4"><meta property="og:title" content="A trailer">`),
      PAGE,
    )
    expect(out.kind).toBe("single")
    expect(out.title).toBe("A trailer")
    expect(out.items).toHaveLength(1)
  })

  it("reads embedded players and JSON-LD VideoObject metadata", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "Launch talk",
      embedUrl: "https://www.youtube.com/embed/abcDEF12345",
      thumbnailUrl: "https://i.example.com/t.jpg",
      duration: "PT1H2M3S",
    })
    const items = extractPageCandidates(
      html(`
        <script type="application/ld+json">${ld}</script>
        <iframe src="https://player.vimeo.com/video/76979871"></iframe>`),
      PAGE,
    )
    const yt = items.find((i) => i.source === "YouTube")!
    expect(yt).toMatchObject({ url: "https://www.youtube.com/watch?v=abcDEF12345", title: "Launch talk", durationSeconds: 3723 })
    expect(items.find((i) => i.source === "Vimeo")?.url).toBe("https://vimeo.com/76979871")
  })

  it("merges equivalent links: an embed and a watch link of one video are one item", () => {
    const items = extractPageCandidates(
      html(`
        <iframe src="https://www.youtube.com/embed/abcDEF12345"></iframe>
        <iframe src="https://www.youtube-nocookie.com/embed/abcDEF12345?rel=0"></iframe>
        <a href="https://youtu.be/abcDEF12345">x</a>
        <video src="https://cdn.example.com/a.mp4"></video><video src="https://cdn.example.com/a.mp4#t=5"></video>`),
      PAGE,
    )
    expect(items).toHaveLength(2)
    expect(canonicalMediaKey("https://youtu.be/abcDEF12345")).toBe(canonicalMediaKey("https://www.youtube.com/watch?v=abcDEF12345"))
  })

  it("returns at most five", () => {
    const body = Array.from({ length: 12 }, (_, i) => `<video src="https://cdn.example.com/v${i}.mp4"></video>`).join("")
    const out = outcomeFromPage(html(body), PAGE)
    expect(out.kind).toBe("collection")
    expect(out.items).toHaveLength(5)
  })

  it("never lists private addresses, non-web links or DRM hosts", () => {
    const items = extractPageCandidates(
      html(`
        <video src="http://127.0.0.1/secret.mp4"></video>
        <video src="http://10.0.0.8/a.mp4"></video>
        <video src="http://169.254.169.254/latest/meta-data.mp4"></video>
        <video src="javascript:alert(1)"></video>
        <iframe src="https://open.spotify.com/embed/track/1"></iframe>
        <video src="https://cdn.example.com/ok.mp4"></video>`),
      PAGE,
    )
    expect(items.map((i) => i.url)).toEqual(["https://cdn.example.com/ok.mp4"])
  })

  it("with no media: nothing to import — unless the page has an Open Graph image, as today", () => {
    expect(outcomeFromPage(html("<p>Hello</p>"), PAGE).kind).toBe("none")
    const product = outcomeFromPage(html("", `<meta property="og:image" content="/shoe.jpg">`), PAGE)
    expect(product.kind).toBe("single")
    expect(product.items[0]?.category).toBe("image")
  })

  it("survives bad metadata: broken JSON-LD, junk attributes, missing titles", () => {
    const out = outcomeFromPage(
      html(`
        <script type="application/ld+json">{ not json</script>
        <video src="https://cdn.example.com/x.mp4" title=""></video>
        <video src="https://cdn.example.com/y.mp4"></video>`),
      PAGE,
    )
    expect(out.kind).toBe("collection")
    expect(out.items.every((i) => i.title && i.title.length > 0)).toBe(true)
  })

  it("does not list the page itself or a platform's home page", () => {
    const items = extractPageCandidates(html(`<iframe src="${PAGE}"></iframe><iframe src="https://www.youtube.com/"></iframe>`), PAGE)
    expect(items).toEqual([])
  })
})

describe("more page shapes", () => {
  it("relative links straight to media files count; links to other pages do not", () => {
    const out = outcomeFromPage(
      html(`
        <a href="/files/bbb_360p_1mb.mp4">360p · 1 MB</a>
        <a href="files/bbb_720p_5mb.mp4"><b>720p</b> · 5 MB</a>
        <a href="/about">About</a><a href="/other-page.html">More videos</a>`),
      PAGE,
    )
    expect(out.kind).toBe("collection")
    expect(out.items.map((i) => i.url)).toEqual([
      "https://videos.example.com/files/bbb_360p_1mb.mp4",
      "https://videos.example.com/files/bbb_720p_5mb.mp4",
    ])
    expect(out.items[1]?.title).toBe("720p · 5 MB")
  })

  it("generic link text gives way to the file name", () => {
    const items = extractPageCandidates(html(`<a href="/v/Big_Buck_Bunny_10s_1MB.mp4">Download</a>`), PAGE)
    expect(items[0]?.title).toBe("Big_Buck_Bunny_10s_1MB.mp4")
  })

  it("a file inside <video> is video whatever its extension", () => {
    const items = extractPageCandidates(html(`<video><source src="/a.ogg"></video><audio src="/b.ogg"></audio>`), PAGE)
    expect(items.map((i) => i.category)).toEqual(["video", "audio"])
  })

  it("a video page with only a poster image is still a video single", () => {
    const out = outcomeFromPage(html("", `<meta property="og:type" content="video.other"><meta property="og:image" content="/poster.jpg">`), PAGE)
    expect(out.items[0]?.category).toBe("video")
  })
})

describe("yt-dlp answers", () => {
  it("one video is a single item", () => {
    const out = outcomeFromYtDlp(
      { title: "Clip", duration: 61, thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg", webpage_url: "https://www.youtube.com/watch?v=abcDEF12345" },
      "https://youtube.com/watch?v=abcDEF12345",
    )
    expect(out).toMatchObject({ kind: "single", title: "Clip" })
    expect(out.items[0]).toMatchObject({ durationSeconds: 61, source: "YouTube", category: "video" })
  })

  it("a playlist is a collection of at most five, de-duplicated", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      _type: "url",
      ie_key: "Youtube",
      id: `vid${i % 7}xxxxxxx`,
      url: `https://www.youtube.com/watch?v=vid${i % 7}xxxxxxx`,
      title: `Video ${i}`,
      duration: 100 + i,
    }))
    const out = outcomeFromYtDlp({ _type: "playlist", title: "Channel", entries }, "https://www.youtube.com/@x/videos")
    expect(out.kind).toBe("collection")
    expect(out.items).toHaveLength(5)
    expect(new Set(out.items.map((i) => i.url)).size).toBe(5)
  })

  it("a SoundCloud set is audio", () => {
    const out = outcomeFromYtDlp(
      { _type: "playlist", entries: [{ url: "https://soundcloud.com/a/one", title: "One" }, { url: "https://soundcloud.com/a/two", title: "Two" }] },
      "https://soundcloud.com/a/sets/b",
    )
    expect(out.items.every((i) => i.category === "audio" && i.source === "SoundCloud")).toBe(true)
  })

  it("an empty playlist has nothing to import; entries pointing at private hosts are dropped", () => {
    expect(outcomeFromYtDlp({ _type: "playlist", entries: [] }, "https://www.youtube.com/playlist?list=x").kind).toBe("none")
    const out = outcomeFromYtDlp(
      { _type: "playlist", entries: [{ url: "http://192.168.0.2/a.mp4" }, { url: "https://cdn.example.com/b.mp4", title: "B" }] },
      "https://www.youtube.com/playlist?list=x",
    )
    expect(out.items.map((i) => i.url)).toEqual(["https://cdn.example.com/b.mp4"])
  })
})

describe("helpers", () => {
  it("ISO 8601 durations", () => {
    expect(isoDurationSeconds("PT2M5S")).toBe(125)
    expect(isoDurationSeconds("PT1H")).toBe(3600)
    expect(isoDurationSeconds(42.4)).toBe(42)
    expect(isoDurationSeconds("soon")).toBeNull()
  })

  it("embed players become importable pages", () => {
    expect(importableMediaUrl("https://www.youtube.com/embed/abcDEF12345?start=3")).toBe("https://www.youtube.com/watch?v=abcDEF12345")
    expect(importableMediaUrl("https://player.vimeo.com/video/123")).toBe("https://vimeo.com/123")
    expect(importableMediaUrl("https://cdn.example.com/a.mp4")).toBe("https://cdn.example.com/a.mp4")
  })

  it("an oversized page is read only up to the cap", async () => {
    const huge = Readable.from((function* () {
      for (let i = 0; i < 64; i++) yield Buffer.alloc(128 * 1024, 0x61) // 8 MiB
    })())
    const text = await readTextCapped(huge, 1024 * 1024)
    expect(text.length).toBe(1024 * 1024)
  })
})
