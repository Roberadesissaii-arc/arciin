import { describe, expect, it } from "vitest"

import {
  inferMediaType,
  isOfficeContainerMime,
  officeFormatByExtension,
  officeFormatFromZipEntries,
  refineOfficeClassification,
} from "@arciin/shared"

/**
 * UP-004 — Office documents stored as generic ZIP.
 *
 * `file-type` reports OOXML as `application/zip`, so a `.docx` was saved with
 * MIME `application/zip` and extension `zip`. Routing was rescued by the
 * filename, but downloads served the wrong content type.
 *
 * The rule these pin down: the container's *entry names* decide, so a renamed
 * archive is never promoted to a document.
 */

const DOCX_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
const XLSX_ENTRIES = ["[Content_Types].xml", "xl/workbook.xml"]
const PPTX_ENTRIES = ["[Content_Types].xml", "ppt/presentation.xml"]

describe("isOfficeContainerMime", () => {
  it("flags the containers that can hide an Office document", () => {
    expect(isOfficeContainerMime("application/zip")).toBe(true)
    expect(isOfficeContainerMime("application/x-cfb")).toBe(true)
  })

  it("ignores everything else", () => {
    for (const mime of ["application/pdf", "image/png", "text/plain", "", null, undefined]) {
      expect(isOfficeContainerMime(mime)).toBe(false)
    }
  })
})

describe("officeFormatFromZipEntries", () => {
  it("identifies docx, xlsx and pptx from their part directories", () => {
    expect(officeFormatFromZipEntries(DOCX_ENTRIES)?.extension).toBe("docx")
    expect(officeFormatFromZipEntries(XLSX_ENTRIES)?.extension).toBe("xlsx")
    expect(officeFormatFromZipEntries(PPTX_ENTRIES)?.extension).toBe("pptx")
  })

  it("is case-insensitive about entry names", () => {
    expect(officeFormatFromZipEntries(["[CONTENT_TYPES].XML", "WORD/DOCUMENT.XML"])?.extension)
      .toBe("docx")
  })

  it("refuses a plain archive", () => {
    expect(officeFormatFromZipEntries(["a.txt", "b/c.bin"])).toBeNull()
  })

  it("refuses an archive that merely contains a word/ folder", () => {
    // Without the OOXML marker this is just a zip with a folder called word.
    expect(officeFormatFromZipEntries(["word/notes.txt", "readme.md"])).toBeNull()
  })

  it("reads the OpenDocument type from its mimetype entry", () => {
    expect(
      officeFormatFromZipEntries(["mimetype"], "application/vnd.oasis.opendocument.text")
        ?.extension,
    ).toBe("odt")
    expect(
      officeFormatFromZipEntries(["mimetype"], "application/epub+zip")?.extension,
    ).toBe("epub")
  })
})

describe("refineOfficeClassification", () => {
  it("corrects a docx stored as application/zip", () => {
    const result = refineOfficeClassification({
      mimeType: "application/zip",
      extension: "zip",
      originalFilename: "contract.docx",
      zipEntries: DOCX_ENTRIES,
    })

    expect(result.changed).toBe(true)
    expect(result.extension).toBe("docx")
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    // And it still routes to Documents.
    expect(inferMediaType(result.mimeType, "contract.docx")).toBe("DOCUMENT")
  })

  it("corrects xlsx and pptx", () => {
    expect(
      refineOfficeClassification({
        mimeType: "application/zip",
        extension: "zip",
        originalFilename: "budget.xlsx",
        zipEntries: XLSX_ENTRIES,
      }).extension,
    ).toBe("xlsx")

    expect(
      refineOfficeClassification({
        mimeType: "application/zip",
        extension: "zip",
        originalFilename: "deck.pptx",
        zipEntries: PPTX_ENTRIES,
      }).extension,
    ).toBe("pptx")
  })

  it("leaves a generic ZIP alone even when renamed .docx", () => {
    // The security-relevant case: the filename claims Office, the bytes do not.
    const result = refineOfficeClassification({
      mimeType: "application/zip",
      extension: "zip",
      originalFilename: "malicious.docx",
      zipEntries: ["payload.exe", "readme.txt"],
    })

    expect(result.changed).toBe(false)
    expect(result.mimeType).toBe("application/zip")
    expect(result.extension).toBe("zip")
    expect(inferMediaType(result.mimeType, "x.zip")).toBe("ARCHIVE")
  })

  it("trusts contents over a misleading Office extension, and reports it", () => {
    const result = refineOfficeClassification({
      mimeType: "application/zip",
      extension: "zip",
      originalFilename: "spreadsheet.xlsx",
      zipEntries: DOCX_ENTRIES, // actually a Word document
    })

    expect(result.extension).toBe("docx")
    expect(result.mismatch).toEqual({ claimedExtension: "xlsx", actualExtension: "docx" })
  })

  it("falls back safely when the container cannot be read", () => {
    const result = refineOfficeClassification({
      mimeType: "application/zip",
      extension: "zip",
      originalFilename: "corrupt.docx",
      zipEntries: null,
    })

    // A corrupt container is not promoted on the filename's word alone.
    expect(result.changed).toBe(false)
    expect(result.extension).toBe("zip")
  })

  it("handles uppercase extensions and multiple dots", () => {
    expect(
      refineOfficeClassification({
        mimeType: "application/zip",
        extension: "zip",
        originalFilename: "Q3.FINAL.DOCX",
        zipEntries: DOCX_ENTRIES,
      }).extension,
    ).toBe("docx")
  })

  it("still corrects a file with no extension when the contents are clear", () => {
    expect(
      refineOfficeClassification({
        mimeType: "application/zip",
        extension: "zip",
        originalFilename: "attachment",
        zipEntries: XLSX_ENTRIES,
      }).extension,
    ).toBe("xlsx")
  })

  it("names legacy CFB formats from the filename, since the header cannot", () => {
    // doc/xls/ppt share one compound-file header; only the name distinguishes.
    const result = refineOfficeClassification({
      mimeType: "application/x-cfb",
      extension: "cfb",
      originalFilename: "report.doc",
    })
    expect(result.changed).toBe(true)
    expect(result.extension).toBe("doc")
    expect(result.mimeType).toBe("application/msword")
  })

  it("leaves an unknown CFB file alone", () => {
    // A .msi is also CFB and must stay an application, not become a document.
    const result = refineOfficeClassification({
      mimeType: "application/x-cfb",
      extension: "cfb",
      originalFilename: "installer.msi",
    })
    expect(result.changed).toBe(false)
  })

  it("does not touch non-container MIMEs", () => {
    expect(
      refineOfficeClassification({
        mimeType: "application/pdf",
        extension: "pdf",
        originalFilename: "a.pdf",
        zipEntries: DOCX_ENTRIES,
      }).changed,
    ).toBe(false)
  })
})

describe("officeFormatByExtension", () => {
  it("covers the supported formats", () => {
    for (const ext of ["docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp", "epub"]) {
      expect(officeFormatByExtension(ext), ext).not.toBeNull()
    }
  })

  it("tolerates a leading dot and uppercase", () => {
    expect(officeFormatByExtension(".DOCX")?.extension).toBe("docx")
  })

  it("returns null for non-Office extensions", () => {
    expect(officeFormatByExtension("zip")).toBeNull()
    expect(officeFormatByExtension("png")).toBeNull()
  })
})
