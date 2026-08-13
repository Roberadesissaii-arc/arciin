import { describe, expect, it } from "vitest"

import {
  CHAT_SLASH_COMMANDS,
  CLIENT_SLASH_COMMANDS,
  expandSlashMessage,
} from "@/components/chat/chat-slash-commands"

/**
 * `/font` — the Canvas draft in the assistant's handwriting.
 *
 * It changes how the draft is drawn, not what it says, so it is carried out by
 * the client. Sending it to a model would spend tokens and a wait on a decision
 * already made, and give the model a chance to rewrite the prose on the way
 * past.
 */

describe("the /font command", () => {
  const command = CHAT_SLASH_COMMANDS.find((c) => c.name === "font")

  it("is offered in the command list", () => {
    expect(command).toBeDefined()
    expect(command!.label).toBe("Handwriting")
  })

  it("is marked as handled by the client", () => {
    expect(CLIENT_SLASH_COMMANDS.has("font")).toBe(true)
  })

  it("expands to nothing, because it never reaches a model", () => {
    expect(command!.expand("")).toBe("")
  })

  it("is recognised as a command rather than plain text", () => {
    expect(expandSlashMessage("/font")).not.toBeNull()
  })

  it("does not collide with another command name", () => {
    const names = CHAT_SLASH_COMMANDS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("the commands that still go to the model", () => {
  it.each(["modify", "humanize", "summarize"])("%s is not client-only", (name) => {
    expect(CLIENT_SLASH_COMMANDS.has(name)).toBe(false)
  })

  it("every other command expands to a real prompt", () => {
    for (const c of CHAT_SLASH_COMMANDS) {
      if (CLIENT_SLASH_COMMANDS.has(c.name)) continue
      expect(c.expand("something").length).toBeGreaterThan(0)
    }
  })
})
