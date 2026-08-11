import { describe, expect, it } from "vitest"

import { finalizeAssistantContent } from "@/components/chat/chat-intent-helpers"

/**
 * Asset galleries must not appear before the sentence introducing them.
 *
 * `finalizeAssistantContent` runs on every streamed chunk. Its gallery helpers
 * append a `[[ASSETS:…]]` tag to whatever text exists so far — so on the first
 * chunk, when there is no prose yet, the message became *only* the tag. The
 * grid rendered instantly and the model's "Here are your PDFs…" line then
 * appeared above it, shoving a finished-looking grid down the page.
 */

const ASK = "list all my pdfs"

describe("streaming chunks never inject a gallery", () => {
  it("does not add a gallery tag to an empty first chunk", () => {
    const out = finalizeAssistantContent("", ASK, [], { streaming: true })
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("does not add a gallery tag to a partial sentence", () => {
    const out = finalizeAssistantContent("Here are your P", ASK, [], { streaming: true })
    expect(out).not.toMatch(/\[\[ASSETS:/i)
  })

  it("still strips leaked tool markup while streaming", () => {
    // Suppressing injection must not suppress cleaning.
    const out = finalizeAssistantContent(
      "<tool_call>{}</tool_call>Here are your PDFs",
      ASK,
      [],
      { streaming: true },
    )
    expect(out).not.toContain("tool_call")
    expect(out).toContain("Here are your PDFs")
  })
})

describe("the completed answer still gets its gallery", () => {
  const finished = finalizeAssistantContent(
    "Here are your PDFs — you have 15 documents total in your library:",
    ASK,
    [],
  )

  it("adds the gallery tag once the reply is complete", () => {
    expect(finished).toMatch(/\[\[ASSETS:/i)
  })

  it("puts the gallery after the sentence, never before it", () => {
    const prose = finished.indexOf("Here are your PDFs")
    const tag = finished.search(/\[\[ASSETS:/i)
    expect(prose).toBeGreaterThanOrEqual(0)
    expect(tag).toBeGreaterThan(prose)
  })

  it("does not duplicate a gallery the model already emitted", () => {
    const withTag = finalizeAssistantContent(
      "Here are your PDFs:\n\n[[ASSETS:documents]]",
      ASK,
      [],
    )
    expect(withTag.match(/\[\[ASSETS:/gi) ?? []).toHaveLength(1)
  })
})
