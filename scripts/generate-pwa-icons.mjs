#!/usr/bin/env node
/**
 * Generate PWA / browser icons from public/arciin-icon.svg
 * Usage: node scripts/generate-pwa-icons.mjs [outputDir]
 * Default outputDir: ./public (desktop). Pass ../arciin-app/public for mobile.
 */
import { readFileSync, copyFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const outDir = resolve(process.argv[2] ?? join(root, "public"))
const svgPath = join(root, "public", "arciin-icon.svg")

const PNG_SIZES = [
  { file: "favicon-32.png", size: 32 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
]

mkdirSync(outDir, { recursive: true })

const svg = readFileSync(svgPath)

for (const { file, size } of PNG_SIZES) {
  const dest = join(outDir, file)
  await sharp(svg, { density: 300 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toFile(dest)
  console.log(`Wrote ${dest}`)
}

const svgDest = join(outDir, "favicon.svg")
copyFileSync(svgPath, svgDest)
console.log(`Wrote ${svgDest}`)

// Multi-size ICO substitute: 32px PNG is enough for legacy tab icons
await sharp(svg, { density: 300 })
  .resize(32, 32)
  .png()
  .toFile(join(outDir, "favicon.ico"))
console.log(`Wrote ${join(outDir, "favicon.ico")} (32×32 PNG, browsers accept as shortcut icon)`)
