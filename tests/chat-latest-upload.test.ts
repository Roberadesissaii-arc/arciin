import { describe, expect, it } from "vitest"

import { finalizeAssistantContent } from "@/components/chat/chat-intent-helpers"
import type { Message } from "@/components/chat/chat-message-model"

/**
 * "What is the latest upload" must render the file, not just talk about it.
 *
 * `finalizeAssistantContent` strips `[[ASSETS:…]]` tags the user did not ask
 * for. Its gallery gate only recognised requests that named a library
 * ("show me my videos"), so every generic file question fell through as small
 * talk and had its tag removed — the reply said "here's the most recent file:"
 * and then showed nothing at all. Follow-ups ("yes", "show me the preview",
 * "my files") lost their cards the same way.
 */

let seq = 0
const msg = (role: "user" | "assistant", content: string): Message =>
  ({ id: `m${seq++}`, role, content }) as Message

describe("latest-upload questions keep their file card", () => {
  it("keeps a tag the model emitted", () => {
    const out = finalizeAssistantContent(
      "Your last upload was about 20 minutes ago — here's the most recent file:\n\n[[ASSETS:all:1]]",
      "what is the latest upload",
      [],
    )
    expect(out).toContain("[[ASSETS:all:1]]")
  })

  it("injects one when the model only wrote prose", () => {
    const out = finalizeAssistantContent(
      "Your last upload was about 20 minutes ago — here's the most recent file:",
      "what is the latest upload",
      [],
    )
    expect(out).toMatch(/\[\[ASSETS:all:1\]\]/i)
  })

  it("narrows a whole-library tag to the one file that was asked for", () => {
    const out = finalizeAssistantContent(
      "Here's your most recent file:\n\n[[ASSETS:all]]",
      "what is the latest upload",
      [],
    )
    expect(out).toContain("[[ASSETS:all:1]]")
  })

  it("does not narrow a plural request to a single card", () => {
    const out = finalizeAssistantContent(
      "Here are your most recent uploads:",
      "show me my recent uploads",
      [],
    )
    expect(out).toMatch(/\[\[ASSETS:all\]\]/i)
  })
})

describe("follow-ups after a latest-upload answer", () => {
  const prior = [
    msg("user", "what is the latest upload"),
    msg(
      "assistant",
      "Your last upload was about 20 minutes ago — here's the most recent file:\n\n[[ASSETS:all:1]]\n\nWant me to show more recent uploads or move it somewhere?",
    ),
  ]

  it('"yes" to an offer to show files still shows files', () => {
    const out = finalizeAssistantContent(
      "Here are your most recent uploads across all libraries:",
      "yes",
      prior,
    )
    expect(out).toMatch(/\[\[ASSETS:all/i)
  })

  it('"show me the preview" re-shows the same single file', () => {
    const out = finalizeAssistantContent("Here's the preview of your latest upload:", "show me the preview", [
      ...prior,
      msg("user", "I did see it"),
      msg("assistant", "Great — glad you spotted it!"),
    ])
    expect(out).toContain("[[ASSETS:all:1]]")
  })

  it('"my files" shows the cross-library gallery', () => {
    const out = finalizeAssistantContent(
      "Here's an overview of your recent files across all libraries:",
      "my files",
      prior,
    )
    expect(out).toMatch(/\[\[ASSETS:all\]\]/i)
  })
})

describe("existing intent rules still hold", () => {
  it("greetings get no asset cards", () => {
    const out = finalizeAssistantContent("Hey! How can I help?", "hello", [])
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("a bare yes with no file offer behind it gets no cards", () => {
    const out = finalizeAssistantContent("Done.", "yes", [
      msg("user", "can you delete the empty folder?"),
      msg("assistant", "Do you want me to remove the empty Drafts folder?"),
    ])
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("code-file questions stay a filename list, never a gallery", () => {
    const out = finalizeAssistantContent(
      "Here are your Python files:\n\n[[ASSETS:images]]",
      "list my python files",
      [],
    )
    expect(out).not.toMatch(/\[\[ASSETS:images/i)
    expect(out).toMatch(/\[\[ASSET_LIST:code\]\]/i)
  })

  it("count questions answer with a number, not a gallery", () => {
    const out = finalizeAssistantContent("You have 42 files.", "how many files do I have?", [])
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("an instruction about the last upload is not a browse request", () => {
    const out = finalizeAssistantContent("Moved it to Trash.", "delete my last upload", [])
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("still injects nothing mid-stream", () => {
    const out = finalizeAssistantContent("Your last upload was", "what is the latest upload", [], {
      streaming: true,
    })
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })
})
