import { closeSync, openSync, ftruncateSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const uploads: unknown[] = []
const deletes: string[] = []

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    files = {
      upload: async (params: unknown) => {
        uploads.push(params)
        return { name: "files/test", uri: "https://example.invalid/files/test", state: "ACTIVE" }
      },
      get: async () => ({
        name: "files/test",
        uri: "https://example.invalid/files/test",
        state: "ACTIVE",
      }),
      delete: async ({ name }: { name: string }) => {
        deletes.push(name)
      },
    }
    models = {
      generateContent: async () => ({ text: '{"ok":true}' }),
    }
  },
}))

import {
  INLINE_UPLOAD_LIMIT_BYTES,
  runGeminiMediaUnderstanding,
} from "./gemini-media-provider"

describe("Gemini Files API upload shape", () => {
  let dir: string

  beforeEach(() => {
    uploads.length = 0
    deletes.length = 0
    dir = mkdtempSync(path.join(tmpdir(), "arciin-gemini-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function sparseMedia(name: string, size: number) {
    const filePath = path.join(dir, name)
    const fd = openSync(filePath, "w")
    ftruncateSync(fd, size)
    closeSync(fd)
    return filePath
  }

  it("uploads a large file as a filesystem path with size and MIME", async () => {
    const filePath = sparseMedia("lecture.mp4", INLINE_UPLOAD_LIMIT_BYTES + 1)
    await runGeminiMediaUnderstanding({
      config: { apiKey: "test-key", model: "gemini-2.5-flash", profileId: "p1" },
      filePath,
      mimeType: "video/mp4",
      prompt: "transcribe",
    })

    expect(uploads).toHaveLength(1)
    const params = uploads[0] as {
      file: unknown
      config: { mimeType?: string; displayName?: string }
    }
    expect(typeof params.file).toBe("string")
    expect(params.file).toBe(filePath)
    expect(params.config.mimeType).toBe("video/mp4")
    expect(params.config.displayName).toBe("lecture.mp4")
    expect(deletes).toEqual(["files/test"])
  })

  it("does not send a ReadStream or Buffer as the Files API body", async () => {
    const filePath = sparseMedia("wide.m4a", 40 * 1024 * 1024)
    await runGeminiMediaUnderstanding({
      config: { apiKey: "test-key", model: "gemini-2.5-flash", profileId: "p1" },
      filePath,
      mimeType: "audio/mp4",
      prompt: "transcribe",
    })
    const params = uploads[0] as { file: unknown }
    expect(params.file).not.toBeInstanceOf(Buffer)
    expect(typeof params.file).toBe("string")
  })

  it("keeps a small file on the inline path (no Files API upload)", async () => {
    const filePath = path.join(dir, "short.m4a")
    writeFileSync(filePath, Buffer.alloc(128, 1))
    await runGeminiMediaUnderstanding({
      config: { apiKey: "test-key", model: "gemini-2.5-flash", profileId: "p1" },
      filePath,
      mimeType: "audio/mp4",
      prompt: "transcribe",
    })
    expect(uploads).toHaveLength(0)
    expect(deletes).toHaveLength(0)
  })
})
