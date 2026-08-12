import { describe, expect, it } from "vitest"

import {
  resolveUploadRoute,
  inferMediaType,
  isIsoMediaContainerMime,
  refineIsoMediaClassification,
  summarizeMediaStreams,
} from "@arciin/shared"

/**
 * UP-002 — audio-only MP4/M4A containers must not be filed as video.
 *
 * `file-type` reports the *container*, and an audio-only .m4a with an `ftyp`
 * brand of `dash`/`isom`/`mp42` sniffs as `video/mp4`. A real production asset
 * carrying exactly that shape (one AAC stream, no video stream, ftyp `dash`)
 * was filed under Videos, which is what these cases pin down.
 */

const audioOnly = { hasVideoStream: false, hasAudioStream: true }
const videoWithAudio = { hasVideoStream: true, hasAudioStream: true }
const videoOnly = { hasVideoStream: true, hasAudioStream: false }

describe("isIsoMediaContainerMime", () => {
  it("recognises the ISO media containers that need stream inspection", () => {
    for (const mime of [
      "video/mp4",
      "video/quicktime",
      "video/x-m4v",
      "video/3gpp",
      "audio/mp4",
      "audio/x-m4a",
    ]) {
      expect(isIsoMediaContainerMime(mime)).toBe(true)
    }
  })

  it("leaves unambiguous formats alone", () => {
    for (const mime of ["video/webm", "video/matroska", "audio/mpeg", "image/png", ""]) {
      expect(isIsoMediaContainerMime(mime)).toBe(false)
    }
  })
})

describe("summarizeMediaStreams", () => {
  it("reports both stream kinds for a normal video", () => {
    expect(
      summarizeMediaStreams([
        { codec_type: "video", codec_name: "h264" },
        { codec_type: "audio", codec_name: "aac" },
      ]),
    ).toEqual(videoWithAudio)
  })

  it("reports audio-only for a track with no video stream", () => {
    expect(summarizeMediaStreams([{ codec_type: "audio", codec_name: "aac" }])).toEqual(
      audioOnly,
    )
  })

  it("ignores embedded cover art, which is carried as a still video stream", () => {
    const summary = summarizeMediaStreams([
      { codec_type: "audio", codec_name: "aac" },
      { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
    ])
    expect(summary).toEqual(audioOnly)
  })

  it("returns null when inspection produced nothing", () => {
    expect(summarizeMediaStreams(undefined)).toBeNull()
    expect(summarizeMediaStreams(null)).toBeNull()
  })
})

describe("refineIsoMediaClassification", () => {
  it("reclassifies an audio-only container that sniffed as video/mp4", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "podcast-episode.m4a",
      streams: audioOnly,
    })

    expect(result.mediaType).toBe("AUDIO")
    expect(result.mimeType).toBe("audio/mp4")
    // The meaningful extension from the filename survives the relabel.
    expect(result.extension).toBe("m4a")
  })

  it("keeps a real video with an audio track as VIDEO", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "holiday.mp4",
      streams: videoWithAudio,
    })

    expect(result).toEqual({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
    })
  })

  it("keeps a silent video as VIDEO", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "timelapse.mp4",
      streams: videoOnly,
    })

    expect(result.mediaType).toBe("VIDEO")
  })

  it("upgrades an audio-labelled container that actually holds video", () => {
    const result = refineIsoMediaClassification({
      mediaType: "AUDIO",
      mimeType: "audio/x-m4a",
      extension: "m4a",
      originalFilename: "clip.m4a",
      streams: videoWithAudio,
    })

    expect(result.mediaType).toBe("VIDEO")
  })

  it("handles an uppercase extension", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "TRACK.M4A",
      streams: audioOnly,
    })

    expect(result.mediaType).toBe("AUDIO")
    expect(result.extension).toBe("m4a")
  })

  it("still reclassifies when the filename extension is wrong or missing", () => {
    const wrongExtension = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "mislabelled.mp4",
      streams: audioOnly,
    })
    // Content is authoritative; the filename says mp4 but there is no video.
    expect(wrongExtension.mediaType).toBe("AUDIO")
    expect(wrongExtension.extension).toBe("m4a")

    const noExtension = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "recording",
      streams: audioOnly,
    })
    expect(noExtension.mediaType).toBe("AUDIO")
    expect(noExtension.extension).toBe("m4a")
  })

  it("leaves the verdict untouched when ffprobe failed", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "corrupt.mp4",
      streams: null,
    })

    // A probe failure must never silently reclassify — fall back, do not guess.
    expect(result).toEqual({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
    })
  })

  it("leaves a corrupt container with no readable streams untouched", () => {
    const result = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      extension: "mp4",
      originalFilename: "corrupt.mp4",
      streams: { hasVideoStream: false, hasAudioStream: false },
    })

    expect(result.mediaType).toBe("VIDEO")
  })

  it("does not touch non-ISO containers", () => {
    const webm = refineIsoMediaClassification({
      mediaType: "VIDEO",
      mimeType: "video/webm",
      extension: "webm",
      originalFilename: "clip.webm",
      streams: audioOnly,
    })

    expect(webm.mediaType).toBe("VIDEO")
  })
})

describe("classification agrees regardless of the client-supplied MIME", () => {
  /** The API and worker both feed the magic-byte MIME through this same path. */
  const classify = (magicMime: string, filename: string, streams: typeof audioOnly | null) =>
    refineIsoMediaClassification({
      mediaType: inferMediaType(magicMime, filename),
      mimeType: magicMime,
      extension: "mp4",
      originalFilename: filename,
      streams,
    }).mediaType

  it("routes an audio-only m4a to AUDIO whatever the browser claimed", () => {
    // Browsers variously send audio/x-m4a, video/mp4, or nothing at all; the
    // stored bytes decide, so all three must agree.
    expect(classify("video/mp4", "song.m4a", audioOnly)).toBe("AUDIO")
    expect(classify("audio/x-m4a", "song.m4a", audioOnly)).toBe("AUDIO")
    expect(classify("audio/mp4", "song.m4a", audioOnly)).toBe("AUDIO")
  })

  it("routes a genuine mp4 video to VIDEO", () => {
    expect(classify("video/mp4", "movie.mp4", videoWithAudio)).toBe("VIDEO")
  })
})

describe("upload routing when the target library disagrees with the file", () => {
  // An .apk dropped while the Videos page was open was filed under Videos: the
  // explicit target won outright and nothing checked that a VIDEO library has
  // no business holding an Android package.

  it("classifies an Android package as an application, not a video", () => {
    for (const mime of [
      "application/vnd.android.package-archive",
      "application/java-archive",
      "application/zip",
      "application/octet-stream",
    ]) {
      expect(inferMediaType(mime, "Joyhub.apk")).toBe("APPLICATION")
    }
  })

  it("reroutes an application away from the Videos library", () => {
    const route = resolveUploadRoute({
      mediaType: "APPLICATION",
      requestedLibraryKind: "VIDEO",
      hasRequestedFolder: true,
    })
    expect(route).toEqual({ libraryKind: "INBOX", rerouted: true, dropFolder: true })
  })

  it("drops the requested folder only when it actually reroutes", () => {
    // A folder belongs to exactly one library, so keeping it after a reroute
    // would file the asset somewhere unreachable from both library views.
    expect(
      resolveUploadRoute({
        mediaType: "VIDEO",
        requestedLibraryKind: "VIDEO",
        hasRequestedFolder: true,
      }).dropFolder,
    ).toBe(false)
  })

  it("leaves a matching upload exactly where it was asked to go", () => {
    for (const [mediaType, kind] of [
      ["VIDEO", "VIDEO"],
      ["IMAGE", "IMAGE"],
      ["AUDIO", "AUDIO"],
      ["DOCUMENT", "DOCUMENT"],
    ] as const) {
      expect(
        resolveUploadRoute({ mediaType, requestedLibraryKind: kind }),
      ).toMatchObject({ libraryKind: kind, rerouted: false })
    }
  })

  it("never second-guesses Inbox or a custom library", () => {
    // Those accept anything by design, so dropping a file there is deliberate.
    for (const kind of ["INBOX", "CUSTOM"]) {
      expect(
        resolveUploadRoute({ mediaType: "APPLICATION", requestedLibraryKind: kind }).rerouted,
      ).toBe(false)
      expect(
        resolveUploadRoute({ mediaType: "VIDEO", requestedLibraryKind: kind }).rerouted,
      ).toBe(false)
    }
  })

  it("routes typeless media to Inbox when nothing is requested", () => {
    for (const mediaType of ["APPLICATION", "ARCHIVE", "CODE", "OTHER"]) {
      expect(resolveUploadRoute({ mediaType }).libraryKind).toBe("INBOX")
    }
  })

  it("does not reroute on an unrecognised library kind", () => {
    // Better to honour the request than to guess wrong about a kind we do not
    // model yet.
    expect(
      resolveUploadRoute({ mediaType: "APPLICATION", requestedLibraryKind: "SOMETHING_NEW" })
        .rerouted,
    ).toBe(false)
  })

  it("reroutes a mismatched media file too, not just applications", () => {
    expect(
      resolveUploadRoute({ mediaType: "AUDIO", requestedLibraryKind: "VIDEO" }),
    ).toMatchObject({ libraryKind: "AUDIO", rerouted: true })
  })
})
