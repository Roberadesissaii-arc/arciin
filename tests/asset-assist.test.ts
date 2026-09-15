import { describe, expect, it } from "vitest"

import { assetOffersAssist, assetOffersMediaAssist } from "@/lib/utils/asset-assist"
import type { AssetSummary } from "@/lib/types/models"

function asset(partial: Partial<AssetSummary> & Pick<AssetSummary, "id" | "originalFilename" | "mediaType">): AssetSummary {
  return {
    libraryId: "lib",
    storageObjectId: "obj",
    ownerId: "user",
    filename: partial.originalFilename,
    mimeType: "application/octet-stream",
    extension: "bin",
    sizeBytes: 1,
    checksumSha256: "abc",
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("assetOffersAssist", () => {
  it("offers Assist on video, music, images, PDFs, and source files", () => {
    expect(assetOffersAssist(asset({ id: "v", originalFilename: "a.mp4", mediaType: "VIDEO" }))).toBe(true)
    expect(assetOffersAssist(asset({ id: "a", originalFilename: "a.mp3", mediaType: "AUDIO" }))).toBe(true)
    expect(assetOffersAssist(asset({ id: "i", originalFilename: "a.png", mediaType: "IMAGE" }))).toBe(true)
    expect(
      assetOffersAssist(
        asset({
          id: "p",
          originalFilename: "a.pdf",
          mediaType: "DOCUMENT",
          mimeType: "application/pdf",
        }),
      ),
    ).toBe(true)
    expect(
      assetOffersAssist(
        asset({
          id: "py",
          originalFilename: "sort.py",
          mediaType: "CODE",
          mimeType: "text/x-python",
          extension: "py",
        }),
      ),
    ).toBe(true)
  })

  it("does not offer Assist on archives or plain notes", () => {
    expect(assetOffersAssist(asset({ id: "z", originalFilename: "a.zip", mediaType: "ARCHIVE" }))).toBe(false)
    expect(
      assetOffersAssist(
        asset({
          id: "t",
          originalFilename: "notes.txt",
          mediaType: "DOCUMENT",
          mimeType: "text/plain",
        }),
      ),
    ).toBe(false)
  })

  it("uses the same media Assist workspace for video and music", () => {
    expect(assetOffersMediaAssist(asset({ id: "v", originalFilename: "a.mp4", mediaType: "VIDEO" }))).toBe(true)
    expect(assetOffersMediaAssist(asset({ id: "a", originalFilename: "a.mp3", mediaType: "AUDIO" }))).toBe(true)
    expect(assetOffersMediaAssist(asset({ id: "i", originalFilename: "a.png", mediaType: "IMAGE" }))).toBe(false)
  })
})
