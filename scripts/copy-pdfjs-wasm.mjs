/**
 * Cross-platform copy of pdfjs-dist WASM assets into apps/web/public.
 * Avoids Unix-only `mkdir -p` / `cp -r` which fail on Windows CMD.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const src = path.join(root, "node_modules", "pdfjs-dist", "wasm")
const dest = path.join(root, "apps", "web", "public", "pdfjs-wasm")

if (!fs.existsSync(src)) {
  console.warn(`[pdfjs:copy-wasm] Skip — source not found: ${src}`)
  process.exit(0)
}

fs.mkdirSync(dest, { recursive: true })
fs.cpSync(src, dest, { recursive: true })
console.log(`[pdfjs:copy-wasm] Copied wasm → ${path.relative(root, dest)}`)
