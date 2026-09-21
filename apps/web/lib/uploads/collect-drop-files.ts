import { isLikelyDirectoryPlaceholder, shouldSkipUploadPath } from "@/lib/uploads/skip-upload-path"

function withRelativePath(file: File, relativePath: string): File {
  if ((file as File & { webkitRelativePath?: string }).webkitRelativePath === relativePath) {
    return file
  }
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    })
  } catch {
    // ignore — still upload with basename only
  }
  return file
}

function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries)
            return
          }
          entries.push(...batch)
          readBatch()
        },
        reject,
      )
    }
    readBatch()
  })
}

async function readEntry(entry: FileSystemEntry, basePath: string): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => {
          const rel = basePath ? `${basePath}/${file.name}` : file.name
          resolve([withRelativePath(file, rel)])
        },
        () => reject(new Error(`Could not read ${entry.name}`)),
      )
    })
  }

  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry
    const childPath = basePath ? `${basePath}/${dir.name}` : dir.name
    if (shouldSkipUploadPath(`${childPath}/`)) {
      return []
    }
    const reader = dir.createReader()
    const children = await readAllDirectoryEntries(reader)
    const nested = await Promise.all(
      children.map((child) => readEntry(child, childPath)),
    )
    return nested.flat()
  }

  return []
}

/**
 * True when this file arrived as part of a dragged folder rather than on its
 * own — it has a relative path with a directory in front of it.
 */
function cameFromDraggedFolder(file: File): boolean {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (!rel) return false
  return rel.replace(/\\/g, "/").split("/").filter(Boolean).length > 1
}

/**
 * Which of the dropped files to actually upload.
 *
 * The skip list is for the contents of a dragged project folder: nobody
 * dropping a repository wants node_modules or .pyc files. It must not apply to
 * a file dropped on its own, which is a deliberate choice — dragging an
 * installer in did nothing at all, no upload and no error, because `.exe` is
 * on that list and the file was filtered away before anything could report it.
 */
export function partitionDroppedFiles(files: File[]): { upload: File[]; skipped: File[] } {
  const upload: File[] = []
  const skipped: File[] = []
  for (const file of files) {
    if (isLikelyDirectoryPlaceholder(file)) continue
    if (!cameFromDraggedFolder(file)) {
      upload.push(file)
      continue
    }
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath!
    if (shouldSkipUploadPath(rel)) skipped.push(file)
    else upload.push(file)
  }
  return { upload, skipped }
}

function filterCollected(files: File[]): File[] {
  return partitionDroppedFiles(files).upload
}

/**
 * Windows/macOS often expose every dragged file on `dataTransfer.files`, while
 * `webkitGetAsEntry()` may only resolve the first item when many loose files are dropped.
 */
export function shouldPreferDataTransferFileList(
  dataTransfer: DataTransfer,
  filteredFiles: File[],
): boolean {
  const rawFiles = Array.from(dataTransfer.files || [])
  const itemCount = dataTransfer.items?.length ?? 0

  const folderOnlyPlaceholder =
    itemCount <= 1 &&
    rawFiles.length === 1 &&
    isLikelyDirectoryPlaceholder(rawFiles[0]!)

  if (filteredFiles.length > 1) return true
  if (filteredFiles.length === 1 && !folderOnlyPlaceholder) return true
  if (filteredFiles.length >= itemCount && itemCount > 1) return true

  return false
}

/** Everything the entries API can see, unfiltered — callers decide what to skip. */
async function collectRawWebkitEntries(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items
  if (!items?.length || typeof items[0]?.webkitGetAsEntry !== "function") {
    return []
  }

  const collected: File[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || item.kind !== "file") continue
    const entry = item.webkitGetAsEntry()
    if (!entry) continue
    try {
      const files = await readEntry(entry, "")
      collected.push(...files)
    } catch {
      const fallback = item.getAsFile()
      if (fallback) collected.push(fallback)
    }
  }

  return collected
}

async function collectViaWebkitEntries(dataTransfer: DataTransfer): Promise<File[]> {
  return filterCollected(await collectRawWebkitEntries(dataTransfer))
}

/** Expand folder drag-and-drop into real files (fixes Windows sending only the folder name). */
export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): Promise<File[]> {
  if (!dataTransfer) return []

  const fromFileList = filterCollected(Array.from(dataTransfer.files || []))

  if (shouldPreferDataTransferFileList(dataTransfer, fromFileList)) {
    return fromFileList
  }

  const fromWebkit = await collectViaWebkitEntries(dataTransfer)
  if (fromWebkit.length > 0) {
    if (
      fromFileList.length > fromWebkit.length &&
      shouldPreferDataTransferFileList(dataTransfer, fromFileList)
    ) {
      return fromFileList
    }
    return fromWebkit
  }

  return fromFileList
}

/**
 * The same expansion, but saying what it left behind.
 *
 * `collectFilesFromDataTransfer` returns only what will upload, which is what
 * the caller needs — but a drop where some files were filtered out of a
 * dragged folder used to look identical to one where nothing was. The caller
 * can now tell the difference and say so.
 */
export async function collectDropResult(
  dataTransfer: DataTransfer | null,
): Promise<{ upload: File[]; skipped: File[] }> {
  if (!dataTransfer) return { upload: [], skipped: [] }

  const rawFileList = Array.from(dataTransfer.files || [])
  const fromFileList = filterCollected(rawFileList)

  if (shouldPreferDataTransferFileList(dataTransfer, fromFileList)) {
    return partitionDroppedFiles(rawFileList)
  }

  const expanded = await collectRawWebkitEntries(dataTransfer)
  if (expanded.length > 0) return partitionDroppedFiles(expanded)

  return partitionDroppedFiles(rawFileList)
}
