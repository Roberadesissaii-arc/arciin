/**
 * Book Mode structure tests, run against fixtures.
 *
 * The renderer is CSS over these blocks, so getting the blocks right is what
 * decides whether the page reads as a manuscript. Checking them here costs
 * nothing and covers both profiles without generating two books.
 *
 * Run with:  node_modules/.bin/tsx lib/chat/book/book-document.test.ts
 */

import {
  chapterNumberWord,
  inferFormatProfile,
  parseBookDocument,
  type BookBlock,
} from "./book-document"
import { countChaptersWritten, parseBookOutline, parseBookTitle } from "./book-parser"

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}
const section = (n: string) => console.log(`\n${n}`)

const FICTION = `# The Bell Under Wintermere

A story about a school that keeps a secret under its lake.

## Contents

1. The Train That Ran on Light — Mara arrives and misreads the school
2. The Bell in the Lake — the sound nobody will explain

## Chapter 1: The Train That Ran on Light

The train arrived shortly after midnight.

Mara had seen the station before, but never like this.

"You heard it too?" Mara asked.

* * *

By morning the lake was flat again.

## Chapter 2: The Bell in the Lake

The second chapter opens here.
`

const NONFICTION = `# Why Memory Fails

## Contents

1. The Shape of Forgetting — what decay actually describes

## Chapter 1: The Shape of Forgetting

Memory is not a recording.

### Why Decay Is the Wrong Word

Decay implies a passive process.

- first point
- second point
`

const kinds = (blocks: BookBlock[]) => blocks.map((b) => b.kind)

function main() {
  section("Structure — fiction")
  {
    const doc = parseBookDocument(FICTION)
    const k = kinds(doc.blocks)

    check("title is the first block", k[0] === "title", k[0])
    check("book title is read", doc.title === "The Bell Under Wintermere", doc.title)
    check("the premise becomes an epigraph, not body prose", k[1] === "epigraph", k[1])
    check("contents is its own block", k.includes("contents"))
    check("two chapter openings", k.filter((x) => x === "chapter").length === 2)
    check("a scene break is recognised", k.includes("scene-break"))
    check("no author invented", doc.author === undefined)
    check("no subtitle invented", doc.subtitle === undefined)

    const contents = doc.blocks.find((b) => b.kind === "contents")
    check(
      "Contents drops the planning remit",
      contents?.kind === "contents" && contents.entries[0]?.title === "The Train That Ran on Light",
      contents?.kind === "contents" ? contents.entries[0]?.title : "missing",
    )
    check(
      "Contents keeps chapter numbers",
      contents?.kind === "contents" && contents.entries[1]?.number === 2,
    )

    const paras = doc.blocks.filter((b) => b.kind === "paragraph")
    check("first paragraph of a chapter is flush", paras[0]?.kind === "paragraph" && paras[0].opening)
    check(
      "the next paragraph indents",
      paras[1]?.kind === "paragraph" && !paras[1].opening,
    )
    check(
      "dialogue stays an ordinary paragraph",
      paras.some((p) => p.kind === "paragraph" && p.text.startsWith('"You heard it too?"')),
    )

    const breakIndex = doc.blocks.findIndex((b) => b.kind === "scene-break")
    const after = doc.blocks[breakIndex + 1]
    check(
      "the paragraph after a scene break is flush again",
      after?.kind === "paragraph" && after.opening,
    )

    const ch2 = doc.blocks.findIndex((b) => b.kind === "chapter" && b.number === 2)
    const ch2First = doc.blocks[ch2 + 1]
    check(
      "a new chapter opens flush",
      ch2First?.kind === "paragraph" && ch2First.opening,
    )
  }

  section("Structure — nonfiction")
  {
    const doc = parseBookDocument(NONFICTION)
    const k = kinds(doc.blocks)
    check("subheadings are semantic", k.includes("subheading"))
    check(
      "the subheading is level 3",
      doc.blocks.some((b) => b.kind === "subheading" && b.level === 3),
    )
    check("lists survive", k.includes("list"))
    check("chapter opening still parsed", k.includes("chapter"))
  }

  section("Metadata carried in, never invented")
  {
    const doc = parseBookDocument(FICTION, { subtitle: "A Novel", author: "R. Adesissa" })
    const k = kinds(doc.blocks)
    check("subtitle renders when supplied", k[1] === "subtitle", k[1])
    check("author renders when supplied", k[2] === "author", k[2])
    check("supplied metadata reaches the doc", doc.author === "R. Adesissa")
  }

  section("The parser contract is untouched")
  {
    // The whole point of rendering rather than rewriting: the same manuscript
    // that Book Mode lays out is still the one the engine reads.
    check("parseBookTitle still works", parseBookTitle(FICTION, "x") === "The Bell Under Wintermere")
    check("parseBookOutline still finds 2", parseBookOutline(FICTION).length === 2)
    check("countChaptersWritten still counts 2", countChaptersWritten(FICTION) === 2)
    check(
      "the manuscript carries no layout characters",
      !/^[ \t]+\S/m.test(FICTION) && !/\n{3,}/.test(FICTION),
    )
  }

  section("Streaming — a half-written chapter")
  {
    const partial = `${FICTION.split("## Chapter 2")[0]}## Chapter 2: The Bell in the Lake\n\nThe sec`
    const doc = parseBookDocument(partial)
    const k = kinds(doc.blocks)
    check("the new chapter heading is already a chapter block", k.filter((x) => x === "chapter").length === 2)
    check("its partial prose is a paragraph", doc.blocks.at(-1)?.kind === "paragraph")
  }

  section("Chapter numerals and profile inference")
  {
    check("1 → ONE", chapterNumberWord(1) === "ONE")
    check("4 → FOUR", chapterNumberWord(4) === "FOUR")
    check("12 → TWELVE", chapterNumberWord(12) === "TWELVE")
    check("21 → TWENTY-ONE", chapterNumberWord(21) === "TWENTY-ONE", chapterNumberWord(21))
    check("140 falls back to the numeral", chapterNumberWord(140) === "140")

    check("a novel is fiction", inferFormatProfile("a short novel about a lake") === "fiction")
    check("a textbook is a textbook", inferFormatProfile("a textbook on optics") === "textbook")
    check(
      "an explanatory book is nonfiction",
      inferFormatProfile("a book about why memory fails") === "nonfiction",
    )
  }

  section("Book Mode is not inferred from the word Chapter")
  {
    // Detection lives on the project, not the text. This asserts the shape the
    // panel relies on: an ordinary document parses fine but nothing here turns
    // it into a book — only `bookRun.project` does that.
    const report = `# Quarterly Report\n\n## Chapter of Incidents\n\nBody text.`
    const doc = parseBookDocument(report)
    check(
      "a report's pseudo-chapter is a subheading, not a chapter opening",
      !kinds(doc.blocks).includes("chapter"),
      kinds(doc.blocks).join(","),
    )
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
