export type PdfPageBookmark = {
  assetId: string
  page: number
  createdAt: number
}

const STORAGE_KEY = "arciin-pdf-page-bookmarks"

function readAll(): PdfPageBookmark[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PdfPageBookmark[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: PdfPageBookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* private mode / quota */
  }
}

export function listPdfBookmarks(assetId: string): PdfPageBookmark[] {
  return readAll()
    .filter((b) => b.assetId === assetId)
    .sort((a, b) => a.page - b.page || b.createdAt - a.createdAt)
}

export function isPdfPageBookmarked(assetId: string, page: number): boolean {
  return readAll().some((b) => b.assetId === assetId && b.page === page)
}

export function togglePdfPageBookmark(assetId: string, page: number): boolean {
  const all = readAll()
  const idx = all.findIndex((b) => b.assetId === assetId && b.page === page)
  if (idx >= 0) {
    all.splice(idx, 1)
    writeAll(all)
    return false
  }
  all.push({ assetId, page, createdAt: Date.now() })
  writeAll(all)
  return true
}
