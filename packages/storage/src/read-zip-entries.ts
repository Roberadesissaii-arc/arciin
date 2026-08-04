import { open } from "node:fs/promises"

/**
 * List the entry names inside a ZIP container without unpacking it.
 *
 * Used to tell a real `.docx`/`.xlsx`/`.pptx` from a plain archive: OOXML
 * parts live under fixed top-level directories, so the entry names identify
 * the format from the file's own contents rather than its filename.
 *
 * Implemented directly against the ZIP central directory — no new dependency,
 * and it never inflates entry data, so a decompression bomb cannot be
 * triggered by classification. Reads only the tail of the file plus the
 * central directory.
 */

/** ZIP structural signatures. */
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_FILE_SIGNATURE = 0x02014b50

/** EOCD is 22 bytes plus a comment of up to 64 KiB. */
const MAX_EOCD_SEARCH = 22 + 0xffff

/** Refuse absurd directories rather than allocating for a hostile file. */
const MAX_ENTRIES = 5_000

export type ZipListing = {
  entries: string[]
  /** Verbatim contents of an uncompressed `mimetype` entry (OpenDocument). */
  openDocumentMimetype: string | null
}

function findEocdOffset(tail: Buffer): number {
  // Scan backwards: the comment may itself contain the signature bytes, and
  // the real EOCD is the last one.
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === EOCD_SIGNATURE) return index
  }
  return -1
}

export async function readZipEntries(filePath: string): Promise<ZipListing | null> {
  let handle
  try {
    handle = await open(filePath, "r")
    const { size } = await handle.stat()
    if (size < 22) return null

    const tailLength = Math.min(size, MAX_EOCD_SEARCH)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, size - tailLength)

    const eocd = findEocdOffset(tail)
    if (eocd < 0) return null

    const entryCount = tail.readUInt16LE(eocd + 10)
    const directorySize = tail.readUInt32LE(eocd + 12)
    const directoryOffset = tail.readUInt32LE(eocd + 16)

    if (
      entryCount === 0 ||
      entryCount > MAX_ENTRIES ||
      directorySize === 0 ||
      directoryOffset + directorySize > size
    ) {
      return null
    }

    const directory = Buffer.alloc(directorySize)
    await handle.read(directory, 0, directorySize, directoryOffset)

    const entries: string[] = []
    let cursor = 0
    let openDocumentMimetypeEntry: { offset: number; compressed: number; size: number } | null =
      null

    for (let index = 0; index < entryCount; index += 1) {
      // 46 bytes is the fixed part of a central-directory record.
      if (cursor + 46 > directory.length) break
      if (directory.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) break

      const compressionMethod = directory.readUInt16LE(cursor + 10)
      const compressedSize = directory.readUInt32LE(cursor + 20)
      const nameLength = directory.readUInt16LE(cursor + 28)
      const extraLength = directory.readUInt16LE(cursor + 30)
      const commentLength = directory.readUInt16LE(cursor + 32)
      const localHeaderOffset = directory.readUInt32LE(cursor + 42)

      const name = directory
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .toString("utf8")
      entries.push(name)

      // OpenDocument stores its type in an uncompressed first entry.
      if (name === "mimetype" && compressionMethod === 0 && compressedSize > 0 && compressedSize < 256) {
        openDocumentMimetypeEntry = {
          offset: localHeaderOffset,
          compressed: compressedSize,
          size: compressedSize,
        }
      }

      cursor += 46 + nameLength + extraLength + commentLength
    }

    let openDocumentMimetype: string | null = null
    if (openDocumentMimetypeEntry) {
      // Local header: 30 fixed bytes + name + extra, then the stored data.
      const header = Buffer.alloc(30)
      await handle.read(header, 0, 30, openDocumentMimetypeEntry.offset)
      const localNameLength = header.readUInt16LE(26)
      const localExtraLength = header.readUInt16LE(28)
      const dataOffset =
        openDocumentMimetypeEntry.offset + 30 + localNameLength + localExtraLength
      const data = Buffer.alloc(openDocumentMimetypeEntry.size)
      await handle.read(data, 0, openDocumentMimetypeEntry.size, dataOffset)
      openDocumentMimetype = data.toString("utf8").trim()
    }

    return { entries, openDocumentMimetype }
  } catch {
    // A corrupt or unreadable container is not an error here — the caller
    // falls back to its existing classification.
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}
