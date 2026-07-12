/** Paths we skip when uploading a dragged project folder (.venv, node_modules, etc.). */

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
])

const SKIP_FILE_EXTENSIONS = new Set([
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".obj",
  ".dll",
  ".exe",
])

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** True if this relative path should not be uploaded. */
export function shouldSkipUploadPath(relativePath: string): boolean {
  const norm = normalizePath(relativePath).toLowerCase()
  if (!norm) return true

  const segments = norm.split("/").filter(Boolean)
  for (const seg of segments) {
    if (SKIP_DIR_NAMES.has(seg)) return true
    if (seg.startsWith(".") && seg !== "." && seg !== "..") {
      // .env.example etc. — skip hidden segments except we allow none for now
      if (seg !== ".env") return true
    }
  }

  const base = segments[segments.length - 1] ?? ""
  const dot = base.lastIndexOf(".")
  if (dot >= 0) {
    const ext = base.slice(dot)
    if (SKIP_FILE_EXTENSIONS.has(ext)) return true
  }

  return false
}

/** Drop 0-byte folder placeholders some browsers put in `dataTransfer.files`. */
export function isLikelyDirectoryPlaceholder(file: File): boolean {
  if (file.size > 0) return false
  const name = file.name
  if (!name || name.includes(".")) return false
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (rel && rel.replace(/\\/g, "/").split("/").filter(Boolean).length > 1) {
    return false
  }
  return true
}
