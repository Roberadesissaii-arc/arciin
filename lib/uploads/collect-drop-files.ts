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

/** Expand folder drag-and-drop into real files (fixes Windows sending only the folder name). */
export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): Promise<File[]> {
  if (!dataTransfer) return []

  const items = dataTransfer.items
  if (items?.length && typeof items[0]?.webkitGetAsEntry === "function") {
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
    const filtered = filterCollected(collected)
    if (filtered.length > 0) return filtered
  }

  return filterCollected(Array.from(dataTransfer.files || []))
}
