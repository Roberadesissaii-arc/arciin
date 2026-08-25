import { describe, expect, it } from "vitest"

import { finalizeAssistantContent } from "@/components/chat/chat-intent-helpers"
import {
  extractListedTitles,
  matchAssetsToTitles,
  titleMatchesAsset,
} from "@/lib/chat/listed-assets"

/**
 * Cards must show the files the answer named, not the newest files.
 *
 * Fixtures are real filenames from the library where this was reported —
 * z-lib suffixes, bracketed series numbers, a misplaced apostrophe in
 * "Sorcerers", three near-identical copies of one Atlantis book. A matcher
 * that only works on tidy titles would not have fixed anything.
 */

const LIBRARY = [
  "(Book 2) Harry Potter and the Chamber of Secrets (Rowling J. K) (z-lib.org).pdf",
  "Hamlet (William Shakespeare) (z-lib.org).pdf",
  "Harry Potter and The Cursed Child [Harry Potter 8] (J.k. Rowling, John Tiffany, Jack Thorne) (z-lib.org).pdf",
  "Harry Potter and the Goblet of Fire (J. K. Rowling) (z-lib.org).pdf",
  "Harry Potter and the Half-Blood Prince (J.K. Rowling) (z-lib.org).pdf",
  "Harry Potter and the Prisoner of Azkaban [Harry Potter 3] (Rowling J. K) (z-lib.org).pdf",
  "Harry Potter and the Sorcerers Stone [Harry Potter 1] (J.K. Rowling) (z-lib.org).pdf",
  "Harry Potter The Complete Collection (1-7) (J.K. Rowling) (z-lib.org).pdf",
  "Mythology 101_From Gods and Goddesses to Monsters and Mortals, Your Guide to Ancient Mythology (Kathleen Sears) (z-lib.org).pdf",
  "Mythology  Timeless Tales of Gods and Heroes, Deluxe Illustrated Edition. (Edith Hamilton) (z-lib.org).pdf",
  "Pumpkinheads (Rainbow Rowell, Faith Erin Hicks) (z-lib.org).pdf",
  "The Atlantis Gene A Thriller (The Origin Mystery, Book 1) (Riddle, A.G.) (z-lib.org).pdf",
  "The Atlantis Gene (Riddle, A G) (z-lib.org).pdf",
  "The Atlantis Plague A Thriller (Riddle, A G) (z-lib.org).pdf",
  "The Atlantis Plague A Thriller (The Origin Mystery, Book 2) (Riddle, A.G.) (z-lib.org).pdf",
  "The Atlantis World (A.G. Riddle) (z-lib.org) (1).pdf",
  "The Atlantis World (A.G. Riddle) (z-lib.org).pdf",
  "The Atlantis World (The Origin Mystery, Book 3) (Riddle, A.G.) (z-lib.org).pdf",
  "The Bell Under Wintermere.pdf",
  "The Sunken Signal.pdf",
  "The Last Signal.pdf",
  "Departure (Riddle, A G) (z-lib.org).pdf",
  // Non-fiction that must never ride along on a fiction answer.
  "TensorFlow in 1 Day Make your own Neural Network (Krishna Rungta) (Z-Library).pdf",
  "Spacetime and Geometry An Introduction to General Relativity (Sean M. Carroll) (z-lib.org).pdf",
  "The Code Book How to Make It, Break It, Hack It, Crack It (Simon Singh) (z-lib.org).pdf",
  "The Complete Book of Spaceflight From Apollo 1 to Zero Gravity (David Darling) (z-lib.org).pdf",
  "Succeed in IELTS - Speaking and Vocabulary (Student's Book) (Andrew Betsis) (Z-Library).pdf",
  "The Lost Journals of Nikola Tesla Time Travel - Alternative Energy (Tim R. Swartz) (z-lib.org).pdf",
  "Black Holes — A Study Note.pdf",
  "The Modern Web Multi-Device Web Development with HTML5, CSS3, and JavaScript (Peter Gasston) (Z-Library).pdf",
]

/** The reply that was reported, trimmed to its two lists. */
const FICTION_REPLY = `Here's every fictional story book in your Documents library — all 22 are in the Fiction and Sci-Fi & Fantasy folders.

📚 Fiction (7)

1. Hamlet (William Shakespeare)
2. Mythology — Timeless Tales of Gods and Heroes (Edith Hamilton)
3. Mythology 101 (Kathleen Sears)
4. Pumpkinheads (Rainbow Rowell & Faith Erin Hicks)
5. The Bell Under Wintermere
6. The Sunken Signal
7. The Last Signal

🚀 Sci-Fi & Fantasy (15)

1. Harry Potter and the Sorcerer's Stone (Book 1)
2. Harry Potter and the Chamber of Secrets (Book 2)
3. Harry Potter and the Prisoner of Azkaban (Book 3)
4. Harry Potter and the Goblet of Fire
5. Harry Potter and the Half-Blood Prince
6. Harry Potter and the Cursed Child (Book 8)
7. Harry Potter — The Complete Collection (1–7)
8. Departure (A.G. Riddle)
9. The Atlantis Gene (2 copies)
10. The Atlantis Plague (2 copies)
11. The Atlantis World (3 copies — two identical, one "Book 3" edition)

⚠️ Worth noting: you have duplicates in the Atlantis series.`

describe("pulling titles out of an answer", () => {
  const titles = extractListedTitles(FICTION_REPLY)

  it("finds every enumerated book", () => {
    expect(titles).toHaveLength(18)
    expect(titles[0]).toBe("Hamlet")
    expect(titles).toContain("The Sunken Signal")
  })

  it("drops the model's parenthetical annotations", () => {
    expect(titles).toContain("The Atlantis World")
    expect(titles.join(" ")).not.toMatch(/copies|identical/i)
  })

  it("keeps a subtitle that is not parenthesised", () => {
    expect(titles).toContain("Mythology — Timeless Tales of Gods and Heroes")
  })

  it("ignores follow-up actions offered as a list", () => {
    const offered = extractListedTitles("Want me to:\n1. Clean up the duplicates\n2. Show the covers")
    expect(offered).toEqual([])
  })

  it("finds nothing in prose", () => {
    expect(extractListedTitles("Here are your books. You have 247 of them.")).toEqual([])
  })
})

describe("matching titles to real filenames", () => {
  const matched = matchAssetsToTitles(LIBRARY, extractListedTitles(FICTION_REPLY), (f) => f)

  it("shows only the books the answer listed", () => {
    expect(matched).toContain("Hamlet (William Shakespeare) (z-lib.org).pdf")
    expect(matched).toContain("The Sunken Signal.pdf")
    expect(matched).toContain("Departure (Riddle, A G) (z-lib.org).pdf")
  })

  it("never lets the educational books ride along", () => {
    for (const nonFiction of [
      "TensorFlow in 1 Day Make your own Neural Network (Krishna Rungta) (Z-Library).pdf",
      "Spacetime and Geometry An Introduction to General Relativity (Sean M. Carroll) (z-lib.org).pdf",
      "Succeed in IELTS - Speaking and Vocabulary (Student's Book) (Andrew Betsis) (Z-Library).pdf",
      "Black Holes — A Study Note.pdf",
      "The Modern Web Multi-Device Web Development with HTML5, CSS3, and JavaScript (Peter Gasston) (Z-Library).pdf",
      "The Lost Journals of Nikola Tesla Time Travel - Alternative Energy (Tim R. Swartz) (z-lib.org).pdf",
    ]) {
      expect(matched, `${nonFiction} must not appear`).not.toContain(nonFiction)
    }
  })

  it("matches all 22 fiction files and nothing else", () => {
    expect(matched).toHaveLength(22)
  })

  it("survives the apostrophe the model adds to Sorcerer's Stone", () => {
    expect(
      titleMatchesAsset(
        "Harry Potter and the Sorcerer's Stone",
        "Harry Potter and the Sorcerers Stone [Harry Potter 1] (J.K. Rowling) (z-lib.org).pdf",
      ),
    ).toBe(true)
  })

  it("shows every copy when one title has duplicates", () => {
    const worlds = matched.filter((f) => f.startsWith("The Atlantis World"))
    expect(worlds).toHaveLength(3)
  })

  it("keeps the answer's order", () => {
    expect(matched[0]).toContain("Hamlet")
  })

  it("does not confuse two books that share a first word", () => {
    expect(
      titleMatchesAsset(
        "Mythology — Timeless Tales of Gods and Heroes",
        "Mythology 101_From Gods and Goddesses to Monsters and Mortals, Your Guide to Ancient Mythology (Kathleen Sears) (z-lib.org).pdf",
      ),
    ).toBe(false)
  })

  it("does not let the complete collection swallow the single volumes", () => {
    expect(
      titleMatchesAsset(
        "Harry Potter — The Complete Collection",
        "Harry Potter and the Goblet of Fire (J. K. Rowling) (z-lib.org).pdf",
      ),
    ).toBe(false)
  })

  it("does not match a one-word title on a prefix", () => {
    expect(titleMatchesAsset("Gene", "The Atlantis Gene (Riddle, A G) (z-lib.org).pdf")).toBe(true)
    expect(titleMatchesAsset("Gene", "General Relativity for Beginners.pdf")).toBe(false)
  })

  it("returns nothing when no titles were listed", () => {
    expect(matchAssetsToTitles(LIBRARY, [], (f) => f)).toEqual([])
  })
})

describe("a single named book", () => {
  it("shows just that book", () => {
    const matched = matchAssetsToTitles(
      LIBRARY,
      extractListedTitles("- Harry Potter and the Goblet of Fire"),
      (f) => f,
    )
    expect(matched).toEqual(["Harry Potter and the Goblet of Fire (J. K. Rowling) (z-lib.org).pdf"])
  })
})

describe("the tag a filtered answer ends up with", () => {
  const ASK = "list all book which is Fictional story"

  it("scopes an injected gallery to the listed books", () => {
    const out = finalizeAssistantContent(FICTION_REPLY, ASK, [])
    expect(out).toContain("[[ASSETS:listed:documents]]")
    expect(out).not.toMatch(/\[\[ASSETS:documents(?::\d+)?\]\]/i)
  })

  it("scopes a gallery the model emitted itself", () => {
    const out = finalizeAssistantContent(`${FICTION_REPLY}\n\n[[ASSETS:documents:24]]`, ASK, [])
    expect(out).toContain("[[ASSETS:listed:documents]]")
    expect(out).not.toContain("[[ASSETS:documents:24]]")
  })

  it("scopes a plain filename list of documents too", () => {
    const out = finalizeAssistantContent(`${FICTION_REPLY}\n\n[[ASSET_LIST:documents]]`, ASK, [])
    expect(out).not.toContain("[[ASSET_LIST:documents]]")
    expect(out).toContain("[[ASSETS:listed:documents]]")
  })

  it("keeps the recency gallery when the answer names nothing", () => {
    const out = finalizeAssistantContent(
      "Here are your books — 247 documents in the library.",
      "show me my books",
      [],
    )
    expect(out).toMatch(/\[\[ASSETS:documents/i)
    expect(out).not.toContain("listed")
  })

  it("leaves tool-resolved id galleries alone", () => {
    const out = finalizeAssistantContent(
      "Found these:\n\n1. Hamlet\n\n[[ASSETS:ids:abc123,def456]]",
      "find hamlet in my library",
      [],
    )
    expect(out).toContain("[[ASSETS:ids:abc123,def456]]")
  })

  it("does not turn a code filename list into cards", () => {
    const out = finalizeAssistantContent(
      "Your scripts:\n\n1. main.py\n2. train.py\n\n[[ASSET_LIST:code]]",
      "list my python files",
      [],
    )
    expect(out).toContain("[[ASSET_LIST:code]]")
  })

  it("carries the media type through for an image answer", () => {
    const out = finalizeAssistantContent(
      "Here they are:\n\n1. sunset.png\n2. beach.png\n\n[[ASSETS:images]]",
      "show me the sunset and beach photos",
      [],
    )
    expect(out).toContain("[[ASSETS:listed:images]]")
  })
})

/**
 * The reply the live instance actually produced, verbatim from chat history.
 *
 * Two defects in one message: the model compressed each series onto a single
 * slash-joined line, so 22 named books matched only 8 files; and it emitted
 * its own [[ASSETS:listed]] while a second tag was injected beside it, so the
 * same eight covers rendered twice.
 */
const LIVE_REPLY = `Here are the fictional story books in your Documents library — 22 in total across the **Fiction** (7) and **Sci-Fi & Fantasy** (15) folders:

**Fiction**
- Hamlet (William Shakespeare)
- Mythology: Timeless Tales of Gods and Heroes (Edith Hamilton)
- Mythology 101 (Kathleen Sears)
- Pumpkinheads (Rainbow Rowell)
- The Bell Under Wintermere
- The Sunken Signal
- The Last Signal

**Sci-Fi & Fantasy**
- Harry Potter and the Sorcerer's Stone / Chamber of Secrets / Prisoner of Azkaban / Goblet of Fire / Half-Blood Prince / Cursed Child / The Complete Collection (1–7)
- Departure (A.G. Riddle)
- The Atlantis Gene / Plague / World (A.G. Riddle)

> Note: the Atlantis series has duplicate copies.`

/** Titles that share a word with a series segment but are different books. */
const DECOYS = [
  "Learning Java - An Introduction to Real-World Programming with Java (Daniel Leuck) (z-lib.org).pdf",
  "Physics of the Impossible A Scientific Exploration into the World of Phasers (Michio Kaku) (z-lib.org).pdf",
  "Prayer secrets (Kenneth E Hagin) (z-lib.org).pdf",
  "Secrets of Antigravity Propulsion Tesla, UFOs (Paul A. LaViolette) (Z-Library).pdf",
  "DIY Drone and Quadcopter Projects A Collection of Drone-Based Essays (Make Magazine Editors) (Z-Library).pdf",
]

describe("a series compressed onto one line", () => {
  const titles = extractListedTitles(LIVE_REPLY)

  it("splits each slash-joined series into its books", () => {
    expect(titles).toContain("Harry Potter and the Sorcerer's Stone")
    expect(titles).toContain("Chamber of Secrets")
    expect(titles).toContain("Goblet of Fire")
    expect(titles).toContain("The Complete Collection")
  })

  it("gives a bare segment the head's context so it means something", () => {
    // "World" alone matches six unrelated books; "Atlantis World" matches three.
    expect(titles).toContain("The Atlantis World")
    expect(titles).toContain("The Atlantis Plague")
    expect(titles).not.toContain("World")
    expect(titles).not.toContain("Plague")
  })

  it("does not split a slash inside a single word", () => {
    expect(extractListedTitles("- TCP/IP Illustrated Volume 1")).toEqual([
      "TCP/IP Illustrated Volume 1",
    ])
  })

  it("matches all 22 books this time, not 8", () => {
    const matched = matchAssetsToTitles(LIBRARY, titles, (f) => f)
    expect(matched).toHaveLength(22)
  })

  it("still refuses the books that merely share a word", () => {
    const matched = matchAssetsToTitles([...LIBRARY, ...DECOYS], titles, (f) => f)
    for (const decoy of DECOYS) {
      expect(matched, `${decoy} must not appear`).not.toContain(decoy)
    }
  })
})

describe("one list, one grid", () => {
  const ASK = "list all book which is Fictional story"

  it("does not add a second gallery beside the model's own", () => {
    const out = finalizeAssistantContent(`${LIVE_REPLY}\n\n[[ASSETS:listed]]`, ASK, [])
    expect(out.match(/\[\[ASSETS:listed/gi) ?? []).toHaveLength(1)
  })

  it("collapses two galleries the model emitted itself", () => {
    const out = finalizeAssistantContent(
      `${LIVE_REPLY}\n\n[[ASSETS:listed]]\n\nTap any cover.\n\n[[ASSETS:listed:documents]]`,
      ASK,
      [],
    )
    expect(out.match(/\[\[ASSETS:listed/gi) ?? []).toHaveLength(1)
    // The prose between them survives — only the repeat goes.
    expect(out).toContain("Tap any cover.")
  })

  it("still renders exactly one when nothing was emitted at all", () => {
    const out = finalizeAssistantContent(LIVE_REPLY, ASK, [])
    expect(out.match(/\[\[ASSETS:listed/gi) ?? []).toHaveLength(1)
  })
})

/** The Atlantis reply from the live run, where every book carried a "— Book N" note. */
const ANNOTATED_REPLY = `Here are all **8 Atlantis books** (A.G. Riddle's *Origin Mystery* series) in your Sci-Fi & Fantasy folder:

1. **Departure** — the series opener
2. **The Atlantis Gene** — Book 1 (×2 copies)
3. **The Atlantis Plague** — Book 2 (×2 copies)
4. **The Atlantis World** — Book 3 (×3 copies)`

describe("a note after the title", () => {
  const titles = extractListedTitles(ANNOTATED_REPLY)

  it("does not let the note bury the title", () => {
    expect(titles).toContain("Departure")
    expect(titles).toContain("The Atlantis Gene")
  })

  it("finds every copy, not just the one whose filename echoes the note", () => {
    const matched = matchAssetsToTitles(LIBRARY, titles, (f) => f)
    // Departure + Gene x2 + Plague x2 + World x3.
    expect(matched).toHaveLength(8)
  })

  it("keeps a real subtitle intact, so it stays precise", () => {
    const subtitled = extractListedTitles("- Mythology — Timeless Tales of Gods and Heroes")
    expect(subtitled).toEqual(["Mythology — Timeless Tales of Gods and Heroes"])
    const matched = matchAssetsToTitles(LIBRARY, subtitled, (f) => f)
    expect(matched).toHaveLength(1)
    expect(matched[0]).toContain("Edith Hamilton")
  })

  it("does not offer a head when the dash carries the title onward", () => {
    // "Harry Potter" alone would drag in all seven volumes for one named file.
    const titles = extractListedTitles("- Harry Potter — The Complete Collection (1–7)")
    expect(titles).toEqual(["Harry Potter — The Complete Collection"])
    expect(matchAssetsToTitles(LIBRARY, titles, (f) => f)).toHaveLength(1)
  })

  it("does not split a hyphenated word", () => {
    expect(extractListedTitles("- Harry Potter and the Half-Blood Prince")).toEqual([
      "Harry Potter and the Half-Blood Prince",
    ])
  })
})

describe("a one-file answer written as a sentence", () => {
  it("reads the bold title when there is no list", () => {
    const titles = extractListedTitles(
      "Here's **Harry Potter and the Goblet of Fire** from your Sci-Fi & Fantasy folder.",
    )
    const matched = matchAssetsToTitles(LIBRARY, titles, (f) => f)
    expect(matched).toHaveLength(1)
    expect(matched[0]).toContain("Goblet of Fire")
  })

  it("ignores bold text once a list exists — headings name no files", () => {
    // "**8 Atlantis books**" would otherwise match the whole series.
    const titles = extractListedTitles(ANNOTATED_REPLY)
    expect(titles).not.toContain("8 Atlantis books")
  })

  it("renders a card for the request that promised one", () => {
    const out = finalizeAssistantContent(
      "Here's **Harry Potter and the Goblet of Fire** from your Sci-Fi & Fantasy folder.",
      "show me Harry Potter and the Goblet of Fire",
      [],
    )
    expect(out).toMatch(/\[\[ASSETS:listed/i)
    const titles = extractListedTitles(out)
    expect(matchAssetsToTitles(LIBRARY, titles, (f) => f)).toHaveLength(1)
  })
})
