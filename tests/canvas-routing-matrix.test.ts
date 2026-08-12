import { describe, expect, it } from "vitest"

import {
  isCanvasWritingIntent,
  shouldAutoOpenCanvas,
} from "@/components/chat/chat-canvas-helpers"

/**
 * Forty prompts, ten per category, run through the routing decision the chat
 * page actually makes — with the chip off and with the chip on.
 *
 * The decision has to hold in both states. The chip is a preference, not a
 * different product: turning it on may not turn a question into a document, and
 * leaving it off may not strand a document in the chat log.
 */

type Want = "chat" | "canvas"

/** The exact expression from chat-page.tsx. */
function route(text: string, chipOn: boolean): Want {
  const force = shouldAutoOpenCanvas(text) || (chipOn && isCanvasWritingIntent(text))
  return force ? "canvas" : "chat"
}

/** Ten explanations and questions. None of these are a document request. */
const EXPLANATIONS: string[] = [
  "Explain how ionic bonding works",
  "How does photosynthesis work?",
  "Tell me about the periodic table",
  "Teach me about electron shells",
  "Why do metals conduct electricity",
  "What is the octet rule",
  "Walk me through how covalent bonds form",
  "Describe the difference between an atom and an ion",
  "Help me understand valence electrons",
  "Explain the essay structure my professor wants",
]

/** Ten unambiguous document requests. */
const DOCUMENTS: string[] = [
  "Create a study note about how electron shells work",
  "Write me a short essay on why self-hosting matters",
  "Make a cheat sheet for the periodic table groups",
  "Prepare a 10-question quiz on photosynthesis",
  "Generate documentation for how uploads work in Arciin",
  "Draft a report on our storage usage",
  "Write a story about a server that gained self-awareness",
  "Put together a study guide for organic chemistry",
  "Create an outline for my dissertation chapter",
  "Give me a worksheet on balancing equations",
]

/** Ten library and file operations. All stay in chat. */
const LIBRARY: string[] = [
  "List all the pdf",
  "How many videos do I have?",
  "Show my documents",
  "Search my library for anything about chemistry",
  "Find the tax report from last year",
  "Which libraries do I have and how full are they?",
  "Summarize chapter 2",
  "What is this about?",
  "Email me the newest PDF in my documents",
  "Add three sample orders to a table called orders in swift-store",
]

/** Ten that name the canvas, or edit what is already in it. */
const CANVAS_NAMED: string[] = [
  "OK now add that one into my canvas as a beautiful note",
  "Put it in the canvas",
  "Write this in canvas",
  "Save that to my canvas",
  "Open the canvas and write it there",
  "Canvas this",
  "Move that into the canvas please",
  "Can you put this in my canvas instead",
  "List all my books in the canvas",
  "Redo it inside the canvas",
]

describe("explanations stay in chat", () => {
  it.each(EXPLANATIONS)("%s", (text) => {
    expect(route(text, false)).toBe("chat")
    expect(route(text, true)).toBe("chat")
  })
})

describe("document requests open canvas", () => {
  it.each(DOCUMENTS)("%s", (text) => {
    expect(route(text, false)).toBe("canvas")
    expect(route(text, true)).toBe("canvas")
  })
})

describe("library work stays in chat", () => {
  it.each(LIBRARY)("%s", (text) => {
    expect(route(text, false)).toBe("chat")
    expect(route(text, true)).toBe("chat")
  })
})

describe("naming the canvas opens canvas", () => {
  it.each(CANVAS_NAMED)("%s", (text) => {
    expect(route(text, false)).toBe("canvas")
    expect(route(text, true)).toBe("canvas")
  })
})

describe("the chip changes nothing on its own", () => {
  // The complaint that started this: routing drifted as a conversation went on,
  // because an auto-routed turn latched the chip and the chip loosened the test.
  it("routes every prompt identically chip-on and chip-off", () => {
    const drift = [...EXPLANATIONS, ...DOCUMENTS, ...LIBRARY, ...CANVAS_NAMED].filter(
      (t) => route(t, false) !== route(t, true),
    )
    expect(drift).toEqual([])
  })
})

describe("a file left in the attachment tray", () => {
  // chat-page appends this block whenever a file sits in the tray. It contains
  // the words "essay, summary, exam", so classifying the *augmented* text made
  // every message — including "hey how are you" — read as a document request.
  // Routing must therefore read the typed text only.
  const ATTACH_BLOCK =
    "\n\n[USER ATTACHED FILE(S) — REQUIRED CONTEXT]\n" +
    'The user selected these library file(s) for this message: "chemistry.pdf" (id=abc).\n' +
    "Arciin will load the file text automatically for this turn. " +
    "Write the full answer (essay, summary, exam, etc.) from that source. " +
    "Do NOT ask which book — it is already attached."

  it("the injected block alone is not a document request", () => {
    expect(shouldAutoOpenCanvas(ATTACH_BLOCK)).toBe(false)
  })

  it.each(["Explain how ionic bonding works", "What is this about?", "Hey how are you"])(
    "%s does not become a document because a file is attached",
    (text) => {
      expect(route(text, true)).toBe("chat")
    },
  )
})
