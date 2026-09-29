#!/usr/bin/env node
/**
 * Refuse to serve a Next.js build made by a different Next.js or React.
 *
 *   node scripts/next-build-stamp.mjs stamp   # after `next build`
 *   node scripts/next-build-stamp.mjs check   # before `next start`
 *
 * Run from the app's directory. Reads NEXT_DIST_DIR (default .next).
 *
 * A build carries its Next version's own server runtime and bundled React. The
 * account portal's build was made with next@16.2.6 in August; the dependency
 * was then raised to 16.3.3 and the portal was never rebuilt, so `next start`
 * served a 16.2.6 build with 16.3.3's runtime and every dynamic page failed
 * with "renderToPipeableStream is not implemented" — while the process stayed
 * up and looked healthy. `stamp` records the versions a build was made with;
 * `check` compares them with what is installed and stops with an explanation
 * instead of serving 500s.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const STAMP = "arciin-build.json"
const distDir = path.resolve(process.cwd(), process.env.NEXT_DIST_DIR || ".next")

function installed() {
  const require = createRequire(path.join(process.cwd(), "package.json"))
  const version = (name) => {
    try {
      return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version
    } catch {
      return null
    }
  }
  return { next: version("next"), react: version("react"), reactDom: version("react-dom") }
}

const mode = process.argv[2]
const now = installed()

if (mode === "stamp") {
  if (!existsSync(path.join(distDir, "BUILD_ID"))) {
    console.error(`[next-build-stamp] no finished build in ${path.basename(distDir)}; nothing stamped`)
    process.exit(1)
  }
  writeFileSync(path.join(distDir, STAMP), `${JSON.stringify({ ...now, builtAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`[next-build-stamp] ${path.basename(distDir)} built with next ${now.next}, react ${now.react}`)
  process.exit(0)
}

if (mode === "check") {
  const file = path.join(distDir, STAMP)
  if (!existsSync(file)) {
    console.error(
      `[next-build-stamp] ${path.basename(distDir)} has no build stamp: it was made by an older release and may not match next ${now.next}. ` +
        "Rebuild it (pnpm deploy:account) before starting.",
    )
    process.exit(1)
  }
  const built = JSON.parse(readFileSync(file, "utf8"))
  const drift = ["next", "react", "reactDom"].filter((k) => built[k] !== now[k])
  if (drift.length) {
    console.error(
      `[next-build-stamp] build/runtime mismatch: built with ${drift.map((k) => `${k} ${built[k]}`).join(", ")}; ` +
        `installed ${drift.map((k) => `${k} ${now[k]}`).join(", ")}. Rebuild it (pnpm deploy:account) before starting.`,
    )
    process.exit(1)
  }
  process.exit(0)
}

console.error("usage: next-build-stamp.mjs stamp|check")
process.exit(2)
