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

function filterCollected(files: File[]): File[] {
  return files.filter((file) => {
    if (isLikelyDirectoryPlaceholder(file)) return false
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    return !shouldSkipUploadPath(rel)
  })
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

async function collectViaWebkitEntries(dataTransfer: DataTransfer): Promise<File[]> {
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

  return filterCollected(collected)
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
