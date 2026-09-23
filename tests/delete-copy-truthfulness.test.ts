import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Deleting a file said "You can't undo this from the UI". It is not true: the
 * file goes to Trash and Settings → Trash restores it for thirty days.
 *
 * Telling someone a recoverable action is final makes them hesitate over
 * something safe, and teaches them to discount the same warning where it is
 * accurate. The warnings that are accurate are asserted here too, so this
 * cannot be "fixed" by softening all of them.
 */

const read = (p: string) => readFileSync(p, "utf8")

const RECOVERABLE = [
  "apps/web/components/libraries/asset-side-panel.tsx",
  "apps/web/components/libraries/asset-bulk-actions-bar.tsx",
]

const IRREVERSIBLE = [
  "apps/web/components/settings/trash-panel.tsx",
  "apps/web/components/settings/api-keys-table.tsx",
  "apps/web/components/settings/clear-data-panel.tsx",
]

describe("a recoverable delete is not described as final", () => {
  it.each(RECOVERABLE)("%s says where the file goes", (file) => {
    const source = read(file)
    expect(source).toMatch(/to Trash/)
    expect(source).toMatch(/30 days/)
  })

  it.each(RECOVERABLE)("%s no longer claims it cannot be undone", (file) => {
    // The phrase survives only inside the comment explaining why it went.
    const source = read(file)
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/|\{\/\*)/.test(line))
      .join("\n")
    expect(source).not.toMatch(/can(no|')t undo this/i)
  })
})

describe("the warnings that are true stay true", () => {
  it.each(IRREVERSIBLE)("%s still warns plainly", (file) => {
    // Permanent removal from Trash, revoking a key and clearing data really
    // are irreversible. Softening these would be the opposite mistake.
    expect(read(file)).toMatch(/cannot be undone|removed from this server forever/i)
  })
})
