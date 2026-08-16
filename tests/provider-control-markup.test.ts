import { describe, expect, it } from "vitest"

import {
  hasProviderControlMarkup,
  parseDsmlToolCalls,
  splitStreamableText,
  stripAssistantStreamMarkup,
  stripProviderControlMarkup,
} from "@arciin/shared"

/**
 * Provider protocol markup must never reach a reader — and ordinary writing
 * must never be damaged in the process.
 *
 * The bug: DeepSeek wrote its tool call into the reply as content, and the
 * existing stripper walked straight past it because every pattern started
 * `<\s*tool_calls?` while the real tag starts with U+FF5C. The user saw raw
 * `<｜｜DSML｜｜tool_calls>` in their transcript, and it was saved there too.
 *
 * The second half of this file is the more important half. It would be trivial
 * to fix the leak by deleting everything between `<` and `>`, and that would
 * silently corrupt every HTML answer, every generic type and every `a < b` the
 * assistant ever writes. These cases exist so nobody is tempted.
 */

/** Exactly what a real DeepSeek turn produced. */
const DSML_BLOCK = `<｜｜DSML｜｜tool_calls>

<｜｜DSML｜｜invoke name="list_library_files">

<｜｜DSML｜｜parameter name="folder_id" string="true">cmssrkzrx000hto5aud75p5o0</｜｜DSML｜｜parameter>

<｜｜DSML｜｜parameter name="library_slug" string="true">documents</｜｜DSML｜｜parameter>

<｜｜DSML｜｜parameter name="limit" string="false">100</｜｜DSML｜｜parameter>

</｜｜DSML｜｜invoke>

</｜｜DSML｜｜tool_calls>`

describe("stripping DeepSeek DSML", () => {
  it("removes a complete block, arguments and all", () => {
    const reply = `Mostly moved — 239 of 240 succeeded.\n\n${DSML_BLOCK}\n\nLet me verify.`
    const out = stripProviderControlMarkup(reply)
    expect(out).not.toContain("DSML")
    expect(out).not.toContain("｜")
    expect(out).not.toContain("cmssrkzrx000hto5aud75p5o0")
    expect(out).toContain("Mostly moved — 239 of 240 succeeded.")
    expect(out).toContain("Let me verify.")
  })

  it("withholds a block that is still arriving", () => {
    // Mid-stream: the opening tag has landed, the close has not.
    const partial = `Here is the plan.\n\n<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="move_`
    const out = stripProviderControlMarkup(partial)
    expect(out).not.toContain("DSML")
    expect(out).toContain("Here is the plan.")
  })

  it("removes a stray closing tag on its own", () => {
    expect(stripProviderControlMarkup("done </｜｜DSML｜｜invoke> ok")).not.toContain("DSML")
  })

  it("catches the fullwidth special tokens of the same family", () => {
    const out = stripProviderControlMarkup("a <｜tool▁calls▁begin｜> b <｜tool▁call▁end｜> c")
    expect(out).not.toContain("tool")
    expect(out).toContain("a")
    expect(out).toContain("c")
  })

  it("catches ASCII special tokens too", () => {
    const out = stripProviderControlMarkup("x <|im_start|> y <|eot_id|> z <|tool_call_begin|> w")
    expect(out).not.toContain("im_start")
    expect(out).not.toContain("eot_id")
    expect(out).not.toContain("tool_call_begin")
  })

  it("reports whether markup is present", () => {
    expect(hasProviderControlMarkup(DSML_BLOCK)).toBe(true)
    expect(hasProviderControlMarkup("An ordinary reply about <div> tags.")).toBe(false)
  })

  it("is reached through the assistant stream stripper", () => {
    // The boundary that actually runs in production, on both the streaming and
    // the persistence paths.
    const out = stripAssistantStreamMarkup(`Done.\n\n${DSML_BLOCK}`)
    expect(out).not.toContain("DSML")
    expect(out).toContain("Done.")
  })
})

describe("ordinary writing survives untouched", () => {
  const untouched = [
    "Use `<div class=\"card\">` to wrap it.",
    "In TypeScript that is `Array<string>` or `Map<string, number>`.",
    "The condition is `a < b && c > d`.",
    "```html\n<section>\n  <p>Hello</p>\n</section>\n```",
    "Compare <b>bold</b> with <i>italic</i> in HTML.",
    "An XML document starts with <?xml version=\"1.0\"?>.",
    "Generics like Promise<void> are common.",
    "5 < 10 and 10 > 5.",
    "React: <Button onClick={fn}>Save</Button>",
    "A pipe in a table: | id | name |",
  ]

  for (const text of untouched) {
    it(`leaves alone: ${text.slice(0, 42)}…`, () => {
      expect(stripProviderControlMarkup(text)).toBe(text)
    })
  }

  it("keeps a document that merely mentions the word DSML", () => {
    const text = "The DSML format is a provider detail; you will not see it."
    expect(stripProviderControlMarkup(text)).toBe(text)
  })
})

describe("holding a half-arrived token while streaming", () => {
  it("withholds a fragment that could still become a control token", () => {
    const { safe, held } = splitStreamableText("Writing the chapter now <｜｜DSM")
    expect(safe).toBe("Writing the chapter now ")
    expect(held).toBe("<｜｜DSM")
  })

  it("withholds a bare opening angle at the very end", () => {
    const { safe } = splitStreamableText("almost there <")
    expect(safe).toBe("almost there ")
  })

  it("does not withhold ordinary markup being written", () => {
    const text = 'Use <div class="card'
    expect(splitStreamableText(text)).toEqual({ safe: text, held: "" })
  })

  it("does not withhold once the tag is complete", () => {
    const text = "Use <div> here"
    expect(splitStreamableText(text)).toEqual({ safe: text, held: "" })
  })

  it("passes plain prose straight through", () => {
    const text = "No angle brackets at all."
    expect(splitStreamableText(text)).toEqual({ safe: text, held: "" })
  })
})

describe("recovering a tool call the model wrote as prose", () => {
  it("parses the invocation, so the call still runs", () => {
    const calls = parseDsmlToolCalls(DSML_BLOCK)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe("list_library_files")
    expect(calls[0]!.arguments).toMatchObject({
      folder_id: "cmssrkzrx000hto5aud75p5o0",
      library_slug: "documents",
      limit: 100,
    })
  })

  it("keeps ids exactly as written — they are opaque", () => {
    const calls = parseDsmlToolCalls(DSML_BLOCK)
    expect(calls[0]!.arguments.folder_id).toBe("cmssrkzrx000hto5aud75p5o0")
  })

  it("parses JSON arguments such as a batch of moves", () => {
    const text = `<｜｜DSML｜｜invoke name="move_library_files">
<｜｜DSML｜｜parameter name="moves" string="false">[{"asset_id":"cmA","destination_folder_id":"cmB"}]</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>`
    const calls = parseDsmlToolCalls(text)
    expect(calls[0]!.name).toBe("move_library_files")
    expect(calls[0]!.arguments.moves).toEqual([
      { asset_id: "cmA", destination_folder_id: "cmB" },
    ])
  })

  it("finds nothing in an ordinary reply", () => {
    expect(parseDsmlToolCalls("I moved 239 files into their folders.")).toEqual([])
    expect(parseDsmlToolCalls("<div>not a tool call</div>")).toEqual([])
  })
})

describe("every path that reaches a reader is sanitised", () => {
  /**
   * The leak was not in the stripper — it was in a write that skipped it.
   *
   * Two branches in the tool loop call `writeSseEvent` with the model's raw
   * text instead of going through `writeSseDelta`, where the stripper lives. A
   * reply that took either branch went out exactly as written. This pins the
   * shape of what those branches must now emit.
   */
  const RAW_TURN = `Both folders are created. Now moving the three books.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="move_library_files">
<｜｜DSML｜｜parameter name="moves" string="false">[{"asset_id":"cmA","target_folder_id":"cmB"}]</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`

  it("leaves prose intact and the protocol gone", () => {
    const visible = stripAssistantStreamMarkup(RAW_TURN)
    expect(visible).toBe("Both folders are created. Now moving the three books.")
    expect(visible).not.toMatch(/DSML|｜/)
  })

  it("is what gets persisted, not just what gets displayed", () => {
    // The persisted message is built from the same helper, so a reload cannot
    // resurrect markup the live view hid.
    const persisted = stripAssistantStreamMarkup(RAW_TURN)
    expect(persisted).not.toMatch(/DSML|｜/)
    expect(persisted.length).toBeGreaterThan(0)
  })

  it("still yields the tool call, so the work is not silently dropped", () => {
    // Sanitising must not mean discarding: the model asked for a move.
    const calls = parseDsmlToolCalls(RAW_TURN)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe("move_library_files")
  })

  it("recovers a call that arrived in the reasoning channel", () => {
    // Where the observed leak actually came from: content empty, everything in
    // `thinking`.
    const content = ""
    const thinking = RAW_TURN
    const source = `${content}\n${thinking}`
    expect(parseDsmlToolCalls(source)).toHaveLength(1)
    expect(stripAssistantStreamMarkup(thinking)).not.toMatch(/DSML/)
  })
})
