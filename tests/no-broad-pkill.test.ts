import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * No script in this repository may kill processes by matching their name.
 *
 * `pkill -f arciin` matches anything whose command line contains that string —
 * an editor, a grep, a test runner, another developer's shell. It has already
 * gone wrong twice here: once it killed a watcher mid-run, and it would happily
 * take a production worker on a machine that also runs the dev stack.
 *
 * Killing a process requires knowing which process. Track the PID, use the
 * process group, or ask the service manager. This test exists because the habit
 * is easy to fall back into and impossible to notice in review.
 *
 * Repo-wide, where `e2e-fixture-seed.test.ts` guards only the E2E setup that
 * first got this wrong. Comments are stripped before matching, because the files
 * most likely to mention `pkill` are the ones explaining why they do not use it.
 */

const ROOT = path.resolve(__dirname, "..")

const SEARCHED = ["scripts", "apps", "packages", "tests", ".github"]

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-dev",
  ".next-e2e",
  "test-results",
  "reports",
  "coverage",
])

const EXTENSIONS = new Set([".sh", ".bash", ".mjs", ".cjs", ".js", ".ts", ".tsx", ".yml", ".yaml"])

/** Matching by command line rather than by identity. */
const BROAD_KILL = /\b(pkill|killall)\b[^\n]*-f/

/** `pkill` at all, even without -f, is name matching. */
const ANY_PKILL = /\bpkill\b/

/** Prose is not behaviour. Only executable text counts. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*#(?!!).*$/gm, "")
}

function walk(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue
    const full = path.join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      walk(full, found)
    } else if (EXTENSIONS.has(path.extname(entry))) {
      found.push(full)
    }
  }
  return found
}

describe("process cleanup never matches on names", () => {
  const files = SEARCHED.flatMap((dir) => walk(path.join(ROOT, dir)))

  it("finds files to check, so a passing result means something", () => {
    // Without this the suite would pass just as happily on an empty list.
    expect(files.length).toBeGreaterThan(50)
  })

  it("contains no pkill or killall anywhere", () => {
    const offenders: string[] = []
    for (const file of files) {
      // These two necessarily contain the pattern they forbid, as string
      // literals in their own assertions.
      if (file.endsWith("no-broad-pkill.test.ts")) continue
      if (file.endsWith("e2e-fixture-seed.test.ts")) continue
      const contents = codeOnly(readFileSync(file, "utf8"))
      if (ANY_PKILL.test(contents) || BROAD_KILL.test(contents)) {
        offenders.push(path.relative(ROOT, file))
      }
    }

    expect(
      offenders,
      "kill by PID or process group, or use the service manager — never by name",
    ).toEqual([])
  })
})
