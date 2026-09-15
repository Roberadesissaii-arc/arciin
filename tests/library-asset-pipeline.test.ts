import { describe, expect, it } from "vitest"

import { KIND_CHIP_OPTIONS } from "@/hooks/use-library-browser-filters"
import type { AssetSummary } from "@/lib/types/models"
import {
  SOURCE_ALL,
  SOURCE_COMPUTER,
  SOURCE_MANUAL,
  collectSourceFilterOptions,
  computerBrowseCrumbs,
  computerSourceValue,
  filesSourceHref,
  filterAssetsBySource,
  parseComputerSourceDeviceId,
  pipelineLibraryAssets,
} from "@/lib/utils/library-asset-pipeline"

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

const desktopPhoto = asset({
  id: "photo",
  originalFilename: "photo.jpg",
  mediaType: "IMAGE",
  sourceContext: {
    deviceId: "dev-desktop",
    deviceName: "DESKTOP-S8FBLDB",
    rootDisplayName: "TestBackup",
    relativePath: "photo.jpg",
    breadcrumbs: ["DESKTOP-S8FBLDB", "TestBackup", "photo.jpg"],
  },
})

const laptopDoc = asset({
  id: "doc",
  originalFilename: "invoice.pdf",
  mediaType: "DOCUMENT",
  sourceContext: {
    deviceId: "dev-laptop",
    deviceName: "Office Laptop",
    rootDisplayName: "Documents",
    relativePath: "invoice.pdf",
    breadcrumbs: ["Office Laptop", "Documents", "invoice.pdf"],
  },
})

const manualImage = asset({
  id: "manual",
  originalFilename: "upload.png",
  mediaType: "IMAGE",
})

describe("All Files source filter", () => {
  it("lists All sources, Manual uploads, and computers when backups exist", () => {
    expect(collectSourceFilterOptions([manualImage])).toEqual([
      { value: SOURCE_ALL, label: "All sources" },
      { value: SOURCE_MANUAL, label: "Manual uploads", group: "Manual uploads" },
    ])
    expect(collectSourceFilterOptions([desktopPhoto, laptopDoc, manualImage])).toEqual([
      { value: SOURCE_ALL, label: "All sources" },
      { value: SOURCE_MANUAL, label: "Manual uploads", group: "Manual uploads" },
      { value: SOURCE_COMPUTER, label: "Computer backups", group: "Computer backups" },
      {
        value: computerSourceValue("dev-desktop"),
        label: "DESKTOP-S8FBLDB",
        group: "Computer backups",
        child: true,
      },
      {
        value: computerSourceValue("dev-laptop"),
        label: "Office Laptop",
        group: "Computer backups",
        child: true,
      },
    ])
  })

  it("keeps computer names from the computers list even without assets yet", () => {
    const options = collectSourceFilterOptions([], [{ deviceId: "dev-desktop", name: "DESKTOP-S8FBLDB" }])
    expect(options.some((option) => option.value === SOURCE_COMPUTER)).toBe(true)
    expect(options.some((option) => option.value === computerSourceValue("dev-desktop"))).toBe(true)
  })

  it("uses live computers for named options and keeps revoked backups under the group", () => {
    const leftover = asset({
      id: "old",
      originalFilename: "old.jpg",
      mediaType: "IMAGE",
      sourceContext: {
        deviceId: "revoked-device",
        deviceName: "DESKTOP-S8FBLDB",
        rootDisplayName: "TestBackup",
        relativePath: "old.jpg",
        breadcrumbs: ["DESKTOP-S8FBLDB", "TestBackup", "old.jpg"],
      },
    })
    const options = collectSourceFilterOptions(
      [desktopPhoto, leftover, laptopDoc],
      [{ deviceId: "dev-desktop", name: "DESKTOP-S8FBLDB" }],
    )
    expect(options.filter((option) => option.label === "DESKTOP-S8FBLDB")).toHaveLength(1)
    expect(options.some((option) => option.label === "Office Laptop")).toBe(false)
    expect(options.some((option) => option.value === SOURCE_COMPUTER)).toBe(true)
    expect(
      collectSourceFilterOptions([leftover], []).some((option) => option.value === SOURCE_COMPUTER),
    ).toBe(true)
  })

  it("filters manual uploads, all computers, and a specific computer", () => {
    const assets = [desktopPhoto, laptopDoc, manualImage]
    expect(filterAssetsBySource(assets, SOURCE_ALL).map((item) => item.id)).toEqual([
      "photo",
      "doc",
      "manual",
    ])
    expect(filterAssetsBySource(assets, SOURCE_MANUAL).map((item) => item.id)).toEqual(["manual"])
    expect(filterAssetsBySource(assets, SOURCE_COMPUTER).map((item) => item.id)).toEqual(["photo", "doc"])
    expect(
      filterAssetsBySource(assets, computerSourceValue("dev-desktop")).map((item) => item.id),
    ).toEqual(["photo"])
  })

  it("combines Images type with a specific computer", () => {
    const mixed = [
      desktopPhoto,
      asset({
        id: "desktop-video",
        originalFilename: "clip.mp4",
        mediaType: "VIDEO",
        sourceContext: desktopPhoto.sourceContext,
      }),
      manualImage,
    ]
    const filtered = pipelineLibraryAssets(mixed, {
      kindFilter: "IMAGE",
      sourceFilter: computerSourceValue("dev-desktop"),
    })
    expect(filtered.map((item) => item.id)).toEqual(["photo"])
  })

  it("does not treat computer as a content type and ignores spoofed source ids", () => {
    expect(KIND_CHIP_OPTIONS.map((chip) => chip.label)).toEqual([
      "All",
      "Images",
      "Videos",
      "Documents",
      "Audio",
      "Archives",
      "Other",
    ])
    expect(parseComputerSourceDeviceId("computer:dev-desktop")).toBe("dev-desktop")
    expect(parseComputerSourceDeviceId("all")).toBeNull()
    expect(parseComputerSourceDeviceId("manual")).toBeNull()
    expect(filterAssetsBySource([desktopPhoto], "This PC")).toEqual([desktopPhoto])
  })

  it("builds All Files computer source URLs and folder crumbs", () => {
    expect(filesSourceHref(SOURCE_ALL)).toBe("/files")
    expect(filesSourceHref(SOURCE_MANUAL)).toBe("/files?source=manual")
    expect(filesSourceHref(computerSourceValue("dev-desktop"))).toBe(
      "/files?source=computer:dev-desktop",
    )
    expect(filesSourceHref(computerSourceValue("dev-desktop"), "folder-1")).toBe(
      "/files?source=computer:dev-desktop&folder=folder-1",
    )
    expect(
      computerBrowseCrumbs({
        computerName: "DESKTOP-S8FBLDB",
        folderPathCache: "device-abc",
        atRoot: true,
      }),
    ).toEqual(["DESKTOP-S8FBLDB"])
    expect(
      computerBrowseCrumbs({
        computerName: "DESKTOP-S8FBLDB",
        folderPathCache: "device-abc/TestBackup/WebProject",
        atRoot: false,
      }),
    ).toEqual(["DESKTOP-S8FBLDB", "TestBackup", "WebProject"])
    expect(
      computerBrowseCrumbs({
        computerName: "DESKTOP-S8FBLDB",
        folderPathCache: "device-abc/desktop/webproject",
        currentFolderName: "WebProject",
        atRoot: false,
      }),
    ).toEqual(["DESKTOP-S8FBLDB", "desktop", "WebProject"])
  })
})
