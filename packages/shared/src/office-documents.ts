/**
 * Office document identification.
 *
 * `file-type` reports OOXML files as the container it sees — `application/zip`
 * — so a `.docx` was stored with MIME `application/zip` and extension `zip`.
 * It still routed to Documents (the filename extension rescued that), but the
 * download served the wrong content type and previews had nothing to work with.
 *
 * Detection is layered so a renamed archive is never blindly trusted:
 *   1. container detection says "this is a ZIP" (or a legacy CFB compound file)
 *   2. the entry names inside the ZIP say which OOXML format it actually is
 *   3. the original filename extension is used only to *corroborate*
 *
 * Pure and synchronous: the caller lists the container entries, so the same
 * rules apply in the API, the worker, and the repair script.
 */

export type OfficeFormat = {
  extension: string
  mimeType: string
  /** OOXML (zip-based) or legacy CFB (compound file binary). */
  container: "ooxml" | "cfb" | "opendocument"
}

const OFFICE_FORMATS: Record<string, OfficeFormat> = {
  docx: {
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    container: "ooxml",
  },
  xlsx: {
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    container: "ooxml",
  },
  pptx: {
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    container: "ooxml",
  },
  doc: { extension: "doc", mimeType: "application/msword", container: "cfb" },
  xls: { extension: "xls", mimeType: "application/vnd.ms-excel", container: "cfb" },
  ppt: { extension: "ppt", mimeType: "application/vnd.ms-powerpoint", container: "cfb" },
  odt: {
    extension: "odt",
    mimeType: "application/vnd.oasis.opendocument.text",
    container: "opendocument",
  },
  ods: {
    extension: "ods",
    mimeType: "application/vnd.oasis.opendocument.spreadsheet",
    container: "opendocument",
  },
  odp: {
    extension: "odp",
    mimeType: "application/vnd.oasis.opendocument.presentation",
    container: "opendocument",
  },
  epub: { extension: "epub", mimeType: "application/epub+zip", container: "opendocument" },
}

export function officeFormatByExtension(extension: string): OfficeFormat | null {
  return OFFICE_FORMATS[extension.toLowerCase().replace(/^\./, "")] ?? null
}

/** Container MIMEs that hide a possible Office document. */
export function isOfficeContainerMime(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase()
  return mime === "application/zip" || mime === "application/x-cfb"
}

/**
 * Identify an OOXML/OpenDocument format from the container's entry names.
 *
 * OOXML parts live under a fixed top-level directory (`word/`, `xl/`, `ppt/`),
 * and OpenDocument stores its type verbatim in the `mimetype` entry. Both are
 * properties of the file's own contents, so a ZIP renamed `.docx` cannot fake
 * them without actually being that format.
 */
export function officeFormatFromZipEntries(
  entries: string[],
  openDocumentMimetype?: string | null,
): OfficeFormat | null {
  const declared = openDocumentMimetype?.trim().toLowerCase()
  if (declared) {
    const match = Object.values(OFFICE_FORMATS).find((f) => f.mimeType === declared)
    if (match) return match
  }

  const normalized = entries.map((entry) => entry.toLowerCase())
  const hasContentTypes = normalized.some((e) => e === "[content_types].xml")

  // Require the OOXML marker before trusting a directory prefix, so an
  // ordinary archive that happens to contain a "word/" folder is not promoted.
  if (!hasContentTypes) return null

  if (normalized.some((e) => e.startsWith("word/"))) return OFFICE_FORMATS.docx
  if (normalized.some((e) => e.startsWith("xl/"))) return OFFICE_FORMATS.xlsx
  if (normalized.some((e) => e.startsWith("ppt/"))) return OFFICE_FORMATS.pptx

  return null
}

export type OfficeRefinement = {
  mimeType: string
  extension: string
  /** True when the stored metadata was corrected. */
  changed: boolean
  /** Set when the content and the filename extension disagree. */
  mismatch?: { claimedExtension: string; actualExtension: string }
}

/**
 * Correct the stored MIME and extension for a detected Office document.
 *
 * Content wins. When the filename claims one Office format and the contents
 * are another, the contents decide and the disagreement is reported so the
 * caller can log it — a renamed file is not silently trusted, and it is also
 * not rejected, since the bytes are still a valid document.
 */
export function refineOfficeClassification(input: {
  mimeType: string
  extension: string
  originalFilename?: string | null
  /** Entry names inside the container; null when it could not be read. */
  zipEntries?: string[] | null
  openDocumentMimetype?: string | null
}): OfficeRefinement {
  const unchanged: OfficeRefinement = {
    mimeType: input.mimeType,
    extension: input.extension,
    changed: false,
  }

  if (!isOfficeContainerMime(input.mimeType)) return unchanged

  const nameExtension = (input.originalFilename ?? "")
    .split(".")
    .slice(1)
    .pop()
    ?.toLowerCase()
  const claimed = nameExtension ? officeFormatByExtension(nameExtension) : null

  // ZIP-based: the entries are authoritative.
  if (input.mimeType.toLowerCase() === "application/zip") {
    const detected = input.zipEntries
      ? officeFormatFromZipEntries(input.zipEntries, input.openDocumentMimetype)
      : null

    // Not an Office document — a plain archive stays an archive, even if it
    // was renamed .docx.
    if (!detected) return unchanged

    return {
      mimeType: detected.mimeType,
      extension: detected.extension,
      changed: true,
      ...(claimed && claimed.extension !== detected.extension
        ? { mismatch: { claimedExtension: claimed.extension, actualExtension: detected.extension } }
        : {}),
    }
  }

  // Legacy CFB: the compound-file header is shared by doc/xls/ppt (and other
  // formats entirely), so the container alone cannot say which. Only the
  // filename can, and only when it names a legacy Office format.
  if (claimed && claimed.container === "cfb") {
    return { mimeType: claimed.mimeType, extension: claimed.extension, changed: true }
  }

  return unchanged
}
