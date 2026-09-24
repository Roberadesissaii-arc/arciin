import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * No window.confirm / alert / prompt in the web app.
 *
 * In the Windows desktop client's WebView, in embedded browsers, and in tabs
 * where dialogs were suppressed, these return immediately without showing
 * anything — confirm() returns false — so App Data deletes, user removal and
 * vault clearing were buttons that silently did nothing. Use
 * ConfirmDestructiveButton or useConfirmDialog instead.
 */
const WEB = path.resolve(__dirname, "../apps/web")
const SKIP = new Set(["node_modules", ".next", ".next-dev", ".next-build", ".next-e2e", ".next-prev", "public"])

function files(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/**
 * `window.confirm(`, `window.alert(`, `window.prompt(`, and the bare globals —
 * but not `confirm({ ... })`, which is useConfirmDialog's promise API.
 */
export const NATIVE_DIALOG =
  /window\.(confirm|alert|prompt)\s*\(|(?<![.\w])(alert|prompt)\s*\(|(?<![.\w])confirm\s*\(\s*(?!\{)/

function stripComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("no blocking native dialogs", () => {
  it("the matcher itself", () => {
    expect(NATIVE_DIALOG.test('if (window.confirm("Delete?")) go()')).toBe(true)
    expect(NATIVE_DIALOG.test('alert("x")')).toBe(true)
    expect(NATIVE_DIALOG.test('confirm("x")')).toBe(true)
    expect(NATIVE_DIALOG.test("await confirm({ title })")).toBe(false)
    expect(NATIVE_DIALOG.test("props.onConfirm()")).toBe(false)
    expect(NATIVE_DIALOG.test("toast.alert(x)")).toBe(false)
  })

  it("web source never calls window.confirm/alert/prompt", () => {
    const offenders: string[] = []
    for (const file of files(WEB)) {
      const code = stripComments(readFileSync(file, "utf8"))
      if (NATIVE_DIALOG.test(code)) offenders.push(path.relative(WEB, file))
    }
    expect(offenders).toEqual([])
  })
})
