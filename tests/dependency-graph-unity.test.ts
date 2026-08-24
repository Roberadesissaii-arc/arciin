import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

/**
 * One version of the packages that matter, across the whole workspace.
 *
 * @google/genai was upgraded at the root to close a subtree of advisories —
 * and packages/media-ai, which is what the API and worker actually import for
 * transcription and chat, kept its own `^2.10.0`. pnpm honoured both, so the
 * running AI path loaded the version that had *not* been upgraded while the
 * report said otherwise. A fresh install is what exposed it: the working tree
 * had the old copy already built, so nothing complained.
 *
 * The lockfile is the thing to assert against. Two entries for one package
 * name is the signal, whatever the reason.
 */

const root = path.resolve(__dirname, "..")
const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8")

/** Distinct versions the lockfile resolves for a package name. */
function resolvedVersions(pkg: string): string[] {
  const escaped = pkg.replace(/[/@]/g, (c) => `\\${c}`)
  const pattern = new RegExp(`^  '?${escaped}@([0-9][^'():\\s]*)'?[(:]`, "gm")
  return [...new Set([...lock.matchAll(pattern)].map((m) => m[1]!))]
}

/** Every workspace manifest that declares the package, with its range. */
function declaredRanges(pkg: string): Record<string, string> {
  const out: Record<string, string> = {}
  const manifests = [
    "package.json",
    ...readdirSync(path.join(root, "apps")).map((d) => `apps/${d}/package.json`),
    ...readdirSync(path.join(root, "packages")).map((d) => `packages/${d}/package.json`),
  ]
  for (const rel of manifests) {
    let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    try {
      json = JSON.parse(readFileSync(path.join(root, rel), "utf8"))
    } catch {
      continue
    }
    const range = json.dependencies?.[pkg] ?? json.devDependencies?.[pkg]
    if (range) out[rel] = range
  }
  return out
}

describe("no package is resolved at two versions at once", () => {
  // Each of these is either a security-sensitive upgrade or a large native
  // dependency where a second copy is both a hazard and a hundred megabytes.
  it.each([
    "@google/genai",
    "next",
    "fastify",
    "sharp",
    "pdfjs-dist",
    "@prisma/client",
    "prisma",
    "socket.io",
    "lucide-react",
  ])("%s resolves to exactly one version", (pkg) => {
    const versions = resolvedVersions(pkg)
    expect(versions.length, `${pkg} resolved to ${versions.join(", ")}`).toBe(1)
  })
})

describe("every workspace member asks for the same thing", () => {
  it("declares @google/genai identically wherever it appears", () => {
    const declared = declaredRanges("@google/genai")
    // It must appear in at least the root and media-ai, or this proves nothing.
    expect(Object.keys(declared).length).toBeGreaterThanOrEqual(2)
    expect(new Set(Object.values(declared)).size, JSON.stringify(declared)).toBe(1)
  })

  it("declares Prisma identically wherever it appears", () => {
    const declared = declaredRanges("@prisma/client")
    expect(Object.keys(declared).length).toBeGreaterThanOrEqual(2)
    expect(new Set(Object.values(declared)).size, JSON.stringify(declared)).toBe(1)
  })
})
