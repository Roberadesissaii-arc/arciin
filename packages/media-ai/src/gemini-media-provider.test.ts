import { describe, expect, it } from "vitest"

import {
  GeminiUnsupportedMediaError,
  INLINE_UPLOAD_LIMIT_BYTES,
  planGeminiMediaTransport,
} from "./gemini-media-provider"

describe("planGeminiMediaTransport", () => {
  const audio = "audio/mp4"
  const video = "video/mp4"

  it("routes just below the inline limit to inline", () => {
    const plan = planGeminiMediaTransport({
      sizeBytes: INLINE_UPLOAD_LIMIT_BYTES - 1,
      filePath: "/tmp/clip.m4a",
      mimeType: audio,
    })
    expect(plan.mode).toBe("inline")
    expect(plan.sizeBytes).toBe(INLINE_UPLOAD_LIMIT_BYTES - 1)
  })

  it("keeps a file exactly at the limit on the inline path", () => {
    const plan = planGeminiMediaTransport({
      sizeBytes: INLINE_UPLOAD_LIMIT_BYTES,
      filePath: "/tmp/clip.m4a",
      mimeType: audio,
    })
    expect(plan.mode).toBe("inline")
  })

  it("routes just above the limit to the Files API with a path, not a stream", () => {
    const plan = planGeminiMediaTransport({
      sizeBytes: INLINE_UPLOAD_LIMIT_BYTES + 1,
      filePath: "/data/arciin/objects/large.mp4",
      mimeType: video,
    })
    expect(plan).toEqual({
      mode: "filesApi",
      sizeBytes: INLINE_UPLOAD_LIMIT_BYTES + 1,
      mimeType: video,
      file: "/data/arciin/objects/large.mp4",
      displayName: "large.mp4",
    })
    expect(typeof plan.mode === "string" && plan.mode === "filesApi" ? plan.file : null).toBe(
      "/data/arciin/objects/large.mp4",
    )
  })

  it("routes a substantially larger file the same way", () => {
    const plan = planGeminiMediaTransport({
      sizeBytes: 80 * 1024 * 1024,
      filePath: "/tmp/feature.mov",
      mimeType: "video/quicktime",
    })
    expect(plan.mode).toBe("filesApi")
    if (plan.mode === "filesApi") {
      expect(typeof plan.file).toBe("string")
      expect(plan.file).not.toMatch(/ReadStream/)
      expect(plan.displayName).toBe("feature.mov")
    }
  })

  it("accepts audio and video MIME types", () => {
    expect(
      planGeminiMediaTransport({
        sizeBytes: 1,
        filePath: "/tmp/a.mp3",
        mimeType: "audio/mpeg",
      }).mode,
    ).toBe("inline")
    expect(
      planGeminiMediaTransport({
        sizeBytes: INLINE_UPLOAD_LIMIT_BYTES + 10,
        filePath: "/tmp/v.webm",
        mimeType: "video/webm",
      }).mode,
    ).toBe("filesApi")
  })

  it("rejects an unsupported MIME type with a controlled error", () => {
    expect(() =>
      planGeminiMediaTransport({
        sizeBytes: 100,
        filePath: "/tmp/notes.txt",
        mimeType: "text/plain",
      }),
    ).toThrow(GeminiUnsupportedMediaError)
    expect(() =>
      planGeminiMediaTransport({
        sizeBytes: INLINE_UPLOAD_LIMIT_BYTES + 1,
        filePath: "/tmp/notes.pdf",
        mimeType: "application/pdf",
      }),
    ).toThrow(/does not accept MIME type/)
  })

  it("refuses an unknown size rather than uploading without metadata", () => {
    expect(() =>
      planGeminiMediaTransport({
        sizeBytes: Number.NaN,
        filePath: "/tmp/clip.m4a",
        mimeType: audio,
      }),
    ).toThrow(/size is unknown/)
  })
})
