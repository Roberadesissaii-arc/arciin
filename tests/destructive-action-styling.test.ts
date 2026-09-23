import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Destructive actions were styled three different ways, and one of them did
 * not work.
 *
 * AlertDialogAction renders <Button variant="default" asChild>, so a dialog
 * that asked for red with className="bg-destructive text-white" emitted the
 * primary classes too — Radix's Slot concatenates the two className strings
 * rather than running them through tailwind-merge. Both bg-primary (#ff4b33,
 * orange) and bg-destructive (#ef4444, red) ended up on the element and the
 * winner came down to stylesheet order. That is why "Delete file" looked
 * orange while the source said destructive.
 *
 * Elsewhere the red was hardcoded as bg-[#EF4444] — the same colour as the
 * token today, but a literal does not follow the theme and carries no focus or
 * dark handling of its own.
 *
 * Asserted at the source, because this is about which variant a component asks
 * for rather than what a pixel ends up being.
 */

const read = (p: string) => readFileSync(p, "utf8")

const DESTRUCTIVE_SURFACES = [
  "apps/web/components/libraries/asset-side-panel.tsx",
  "apps/web/components/libraries/asset-bulk-actions-bar.tsx",
  "apps/web/components/settings/trash-panel.tsx",
  "apps/web/components/settings/api-keys-table.tsx",
  "apps/web/components/passwords/password-vault-page.tsx",
  "apps/web/components/database/app-database-list-grid.tsx",
  "apps/web/components/database/app-database-list-table.tsx",
]

describe("one destructive language, and it is the token", () => {
  it.each(DESTRUCTIVE_SURFACES)("%s asks for the variant", (file) => {
    expect(read(file)).toContain('variant="destructive"')
  })

  it.each(DESTRUCTIVE_SURFACES)("%s hardcodes no red", (file) => {
    const source = read(file)
    // A literal cannot follow a theme change and has no focus or dark state.
    expect(source).not.toMatch(/bg-\[#(EF4444|DC2626|ef4444|dc2626)\]/)
    // The pairing that produced the orange button.
    expect(source).not.toContain('className="bg-destructive text-white hover:bg-destructive/90"')
  })
})

describe("the API key row", () => {
  const source = read("apps/web/components/settings/api-keys-table.tsx")

  it("gives both actions one width so the column does not shift", () => {
    expect(source).toContain("API_KEY_ACTION_WIDTH")
    const applied = source.match(/API_KEY_ACTION_WIDTH/g) ?? []
    // Declared once, applied to Rotate and to Revoke.
    expect(applied.length).toBeGreaterThanOrEqual(3)
  })

  it("keeps Rotate neutral and makes Revoke destructive", () => {
    /**
     * Anchored on the handler rather than the label: "Rotate" also appears as
     * the RotateCw icon import and as rotateMutation, and slicing backwards
     * from the first match landed on the import block.
     */
    const buttonFor = (kind: "rotate" | "revoke") => {
      const at = source.indexOf(`setConfirm({ kind: "${kind}"`)
      expect(at, `no ${kind} handler found`).toBeGreaterThan(-1)
      return source.slice(Math.max(0, at - 500), at)
    }
    expect(buttonFor("rotate")).toContain('variant="outline"')
    expect(buttonFor("rotate")).not.toContain('variant="destructive"')
    expect(buttonFor("revoke")).toContain('variant="destructive"')
  })

  it("still shows which keys never expire", () => {
    expect(source).toContain("No expiration")
  })
})

describe("what is recoverable is not dressed up as final", () => {
  const panels = [
    "apps/web/components/libraries/asset-side-panel.tsx",
    "apps/web/components/libraries/asset-bulk-actions-bar.tsx",
  ]

  it.each(panels)("%s still says where the file goes", (file) => {
    const source = read(file)
    expect(source).toMatch(/to Trash/)
    expect(source).toMatch(/30 days/)
  })

  it.each(panels)("%s has not regained the old untrue line", (file) => {
    const source = read(file)
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/|\{\/\*)/.test(line))
      .join("\n")
    expect(source).not.toMatch(/can(no|')t undo this/i)
  })
})

describe("archiving is not deleting", () => {
  it("no archive control borrows the destructive variant", () => {
    // Archive is reversible and belongs in the neutral language. Turning it red
    // because it sits next to Delete would be the same mistake in reverse.
    for (const file of [
      "apps/web/components/libraries/asset-side-panel.tsx",
      "apps/web/components/libraries/asset-bulk-actions-bar.tsx",
    ]) {
      const source = read(file)
      const archiveAt = source.indexOf("Archive")
      if (archiveAt === -1) continue
      const around = source.slice(Math.max(0, archiveAt - 400), archiveAt)
      expect(around).not.toContain('variant="destructive"')
    }
  })
})
