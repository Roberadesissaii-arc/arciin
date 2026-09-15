#!/usr/bin/env node
/**
 * Release guard for the Next.js web build.
 *
 * Two independent checks, because each catches a failure the other misses:
 *
 * 1. `--dist <dir>`  Structural completeness of a build directory. A `next
 *    build` that is killed after the compile step leaves `static/` and
 *    `server/` populated but never writes BUILD_ID, the manifests, or the
 *    `pages/500.html` fallback. The result looks like a build and starts like a
 *    build, but every asset the previous build's HTML points at has already
 *    been deleted — which is exactly how production served HTML referencing
 *    chunks that 500'd.
 *
 * 2. `--url <origin>` Smoke-test a running server: fetch each route, extract
 *    every `/_next/static/*.{js,css}` the HTML references, and request it.
 *    Turbopack keeps App Router client references inside the server chunks
 *    rather than an `app-build-manifest.json`, so fetching real HTML is the
 *    only way to prove the served page and the served assets agree.
 *
 * Exit code is non-zero on any failure so a deploy script can gate on it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
function flag(name, fallback = null) {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

const DEFAULT_ROUTES = ["/login", "/dashboard", "/settings", "/chat"]

/** Files a complete `next build` always writes. Missing any one means a partial build. */
const REQUIRED = [
  "BUILD_ID",
  "build-manifest.json",
  "routes-manifest.json",
  "prerender-manifest.json",
  "required-server-files.json",
  "app-path-routes-manifest.json",
  "server/pages/500.html",
  "server/pages/404.html",
]

function fail(msg) {
  console.error(`  ✗ ${msg}`)
  return 1
}
function ok(msg) {
  console.log(`  ✓ ${msg}`)
  return 0
}

function verifyDist(distDir) {
  console.log(`\nBuild completeness: ${distDir}`)
  let failures = 0

  if (!existsSync(distDir)) {
    return fail(`build directory does not exist: ${distDir}`)
  }

  for (const rel of REQUIRED) {
    if (existsSync(path.join(distDir, rel))) continue
    failures += fail(`missing required build output: ${rel}`)
  }

  const staticDir = path.join(distDir, "static")
  if (!existsSync(staticDir)) {
    failures += fail("missing static/ directory")
  } else {
    const count = countFiles(staticDir)
    if (count === 0) failures += fail("static/ contains no files")
    else ok(`static/ contains ${count} files`)
  }

  // Every `static/...` path named by the build manifests must exist on disk.
  for (const manifest of ["build-manifest.json", "fallback-build-manifest.json"]) {
    const file = path.join(distDir, manifest)
    if (!existsSync(file)) continue
    let refs
    try {
      refs = collectStaticRefs(JSON.parse(readFileSync(file, "utf8")))
    } catch (err) {
      failures += fail(`${manifest} is not readable JSON: ${err.message}`)
      continue
    }
    const missing = refs.filter((ref) => !existsSync(path.join(distDir, ref)))
    if (missing.length) {
      for (const ref of missing) failures += fail(`${manifest} references missing ${ref}`)
    } else {
      ok(`${manifest}: all ${refs.length} referenced assets exist`)
    }
  }

  // Turbopack records each route's client chunks in
  // `<route>/page_client-reference-manifest.js` rather than a single
  // app-build-manifest. Scanning them covers every route — including the
  // authenticated ones a logged-out smoke test can never reach.
  const serverDir = path.join(distDir, "server")
  if (existsSync(serverDir)) {
    const manifests = findFiles(serverDir, (name) =>
      name.endsWith("_client-reference-manifest.js") || name === "middleware-build-manifest.js"
    )
    const refs = new Set()
    for (const file of manifests) {
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(/static\/[^"'`\\\s,\]),]+?\.(?:js|css)/g)) refs.add(match[0])
    }
    const missing = [...refs].filter((ref) => !existsSync(path.join(distDir, ref)))
    if (missing.length) {
      for (const ref of missing) failures += fail(`route manifest references missing ${ref}`)
    } else {
      ok(`${manifests.length} route manifests: all ${refs.size} client chunks exist`)
    }
  }

  if (failures === 0) ok(`build looks complete (BUILD_ID ${readFileSync(path.join(distDir, "BUILD_ID"), "utf8").trim()})`)
  return failures
}

function countFiles(dir) {
  let total = 0
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    total += statSync(full).isDirectory() ? countFiles(full) : 1
  }
  return total
}

function findFiles(dir, predicate, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) findFiles(full, predicate, found)
    else if (predicate(entry)) found.push(full)
  }
  return found
}

/** Pull every "static/..." string out of an arbitrarily shaped manifest. */
function collectStaticRefs(node, found = new Set()) {
  if (typeof node === "string") {
    if (node.startsWith("static/")) found.add(node)
  } else if (Array.isArray(node)) {
    for (const item of node) collectStaticRefs(item, found)
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStaticRefs(value, found)
  }
  return [...found]
}

const ASSET_RE = /\/_next\/static\/[^"'`\\\s)>]+?\.(?:js|css)/g

async function verifyUrl(origin, routes) {
  console.log(`\nServed-asset smoke test: ${origin}`)
  let failures = 0
  const assets = new Set()

  for (const route of routes) {
    let res
    try {
      res = await fetch(`${origin}${route}`, { redirect: "manual" })
    } catch (err) {
      failures += fail(`${route} request failed: ${err.message}`)
      continue
    }
    // 200 renders; 3xx is a legitimate auth redirect and still carries no assets to check.
    if (res.status >= 400) {
      failures += fail(`${route} returned HTTP ${res.status}`)
      continue
    }
    const html = await res.text()
    const found = html.match(ASSET_RE) ?? []
    for (const asset of found) assets.add(asset)
    ok(`${route} HTTP ${res.status} (${found.length} asset refs)`)
  }

  let okCount = 0
  const bad = []
  for (const asset of assets) {
    let res
    try {
      res = await fetch(`${origin}${asset}`)
    } catch (err) {
      bad.push(`${asset} — request failed: ${err.message}`)
      continue
    }
    if (res.status === 200) okCount += 1
    else bad.push(`${asset} — HTTP ${res.status}`)
  }

  console.log(`\n  HTML-referenced assets: ${assets.size}`)
  console.log(`  HTTP 200:  ${okCount}`)
  console.log(`  non-200:   ${bad.length}`)
  for (const entry of bad) failures += fail(entry)

  return failures
}

const dist = flag("--dist")
const url = flag("--url")
const routes = (flag("--routes") ?? DEFAULT_ROUTES.join(",")).split(",").filter(Boolean)

if (!dist && !url) {
  console.error("usage: verify-web-assets.mjs [--dist <buildDir>] [--url <origin> [--routes /a,/b]]")
  process.exit(2)
}

let failures = 0
if (dist) failures += verifyDist(path.resolve(dist))
if (url) failures += await verifyUrl(url.replace(/\/$/, ""), routes)

if (failures > 0) {
  console.error(`\nFAILED — ${failures} problem(s). Do not release this build.\n`)
  process.exit(1)
}
console.log("\nPASSED — served HTML and static assets agree.\n")
