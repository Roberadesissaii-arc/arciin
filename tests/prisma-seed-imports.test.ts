import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import * as shared from "@arciin/shared"

/**
 * prisma/seed.ts runs on every install and repair. It once imported a symbol
 * that had been deleted (COMPUTERS_LIBRARY_DEFINITION), got `undefined`, and
 * crashed with "Cannot read properties of undefined (reading 'slug')" on any
 * instance that had been claimed — so every native repair failed. tsx does
 * not type-check, so only a test sees this.
 */
describe("prisma/seed.ts", () => {
  const seed = readFileSync(path.resolve(import.meta.dirname, "../prisma/seed.ts"), "utf8")

  it("imports only symbols @arciin/shared still exports", () => {
    const names = /import \{([^}]+)\} from "@arciin\/shared"/.exec(seed)?.[1] ?? ""
    for (const name of names.split(",").map((n) => n.trim()).filter(Boolean)) {
      expect(shared, name).toHaveProperty(name)
      expect((shared as Record<string, unknown>)[name], name).toBeDefined()
    }
  })

  it("every default library has a slug", () => {
    for (const library of shared.DEFAULT_LIBRARY_DEFINITIONS) expect(library.slug).toBeTruthy()
  })
})
