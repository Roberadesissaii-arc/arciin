/**
 * Orchestration tests, run with a stub generator.
 *
 * Every rule that makes automatic writing safe — the lock, the read-back, the
 * recovery, the bounded repair — is verifiable without a model, and that is the
 * point: these are the cases where a real call would be both expensive and less
 * reproducible than a stub that fails on demand.
 *
 * Run with:  node --experimental-strip-types lib/chat/book/book.test.ts
 */

import {
  __resetBookOrchestratorForTests,
  useBookRun,
  type ChapterGenerator,
} from "./book-orchestrator"
import { countChaptersWritten, isBookContinueRequest, parseBookOutline } from "./book-parser"
import { applyChapterToMemory, renderMemoryForPrompt } from "./book-memory"
import { buildChapterPrompt } from "./book-prompts"
import { MemoryBookRepository, setBookRepository } from "./book-storage"
import { validateChapter } from "./book-validator"
import { bookActions, buildNextActions } from "../next-actions"
import { emptyBookMemory, type BookProject } from "./types"

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

function section(name: string) {
  console.log(`\n${name}`)
}

const PLAN = `# The Bell Under Wintermere

A book about a school that keeps a secret under its lake.

## Contents

1. The Train That Ran on Light — Mara arrives and misreads the school
2. The Bell in the Lake — the sound nobody will explain
3. The Salt Circle — the protective symbols are found

## Chapter 1: The Train That Ran on Light

${"The train ran on light and Mara counted the poles as they passed. ".repeat(40)}
`

/** A chapter body long enough to pass the length check. */
function chapterText(n: number, title: string) {
  return `## Chapter ${n}: ${title}\n\n${`Paragraph ${n} of the manuscript, written out at length. `.repeat(
    80,
  )}`
}

/** A generator whose behaviour each test controls. */
function makeGenerator(
  behaviour: (chapter: number, attempt: number) => { ok: true; raw: string } | { ok: false; error: string },
) {
  const calls: number[] = []
  const attempts = new Map<number, number>()
  const generator: ChapterGenerator = async (request) => {
    calls.push(request.chapter)
    const attempt = (attempts.get(request.chapter) ?? 0) + 1
    attempts.set(request.chapter, attempt)
    // A real generator streams; exercising that path keeps the stale-stream
    // guard honest.
    request.onToken("partial…")
    await new Promise((r) => setTimeout(r, 1))
    return behaviour(request.chapter, attempt)
  }
  return { generator, calls }
}

const titles = ["The Train That Ran on Light", "The Bell in the Lake", "The Salt Circle"]

/** Wait until the run stops moving, or give up. */
async function settle(maxMs = 3000): Promise<void> {
  const started = Date.now()
  for (;;) {
    const { project, streamingChapter } = useBookRun.getState()
    const busy =
      streamingChapter !== null ||
      project?.status === "writing" ||
      project?.status === "stopping" ||
      project?.status === "planning"
    if (!busy) return
    if (Date.now() - started > maxMs) throw new Error("run did not settle")
    await new Promise((r) => setTimeout(r, 5))
  }
}

function reset() {
  __resetBookOrchestratorForTests()
  setBookRepository(new MemoryBookRepository())
  useBookRun.setState({
    project: null,
    manuscript: "",
    streamingText: "",
    streamingChapter: null,
    operationId: null,
    lastRejection: null,
  })
}

async function main() {
  /* ------------------------------------------------------------ parsing */
  section("Parsing and guards")
  {
    const outline = parseBookOutline(PLAN)
    check("outline reads 3 chapters", outline.length === 3, `got ${outline.length}`)
    check("outline splits title from remit", outline[1]?.title === "The Bell in the Lake")
    check("plan counts as 1 chapter written", countChaptersWritten(PLAN) === 1)

    const gappy = `${chapterText(1, "a")}\n${chapterText(2, "b")}\n${chapterText(7, "g")}`
    check("a gap stops the count at the run", countChaptersWritten(gappy) === 2)

    check('"continue" is a book turn', isBookContinueRequest("continue"))
    check(
      '"continue the analysis in section three" is not',
      !isBookContinueRequest("continue the analysis in section three"),
    )
  }

  /* --------------------------------------------------------- validation */
  section("Test E — validation")
  {
    const good = validateChapter({ raw: chapterText(2, "The Bell in the Lake"), expected: 2 })
    check("a real chapter passes", good.ok)

    const two = validateChapter({
      raw: `${chapterText(2, "a")}\n\n${chapterText(3, "b")}`,
      expected: 2,
    })
    check(
      "a response running into chapter 3 is rejected",
      !two.ok && two.rejection.code === "extra-chapters",
      !two.ok ? two.rejection.code : "accepted",
    )

    const reprint = validateChapter({ raw: `${PLAN}\n\n${chapterText(2, "b")}`, expected: 2 })
    check(
      "a reprinted title page is rejected",
      !reprint.ok && reprint.rejection.code === "reprinted-front-matter",
      !reprint.ok ? reprint.rejection.code : "accepted",
    )

    const stub = validateChapter({ raw: "## Chapter 2: b\n\nIn this chapter we will explore.", expected: 2 })
    check("a 250-word summary is rejected", !stub.ok, "accepted")

    const wrong = validateChapter({ raw: chapterText(5, "e"), expected: 2 })
    check(
      "the wrong chapter number is rejected",
      !wrong.ok && wrong.rejection.code === "wrong-chapter",
    )
  }

  /* ------------------------------------------------- A: automatic writing */
  section("Test A — automatic writing")
  {
    reset()
    const { generator, calls } = makeGenerator((n) => ({
      ok: true,
      raw: `${chapterText(n, titles[n - 1] ?? `Chapter ${n}`)}\n[chapter-summary:"Chapter ${n} happened."]\n[carry:"Mara — is now suspicious"]`,
    }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c1", brief: "a school book", manuscript: PLAN })
    await settle()

    const state = useBookRun.getState()
    check("chapters 2 and 3 were generated without a manual continue", calls.join(",") === "2,3", calls.join(","))
    check("all 3 chapters are written", state.project?.written === 3, `${state.project?.written}`)
    check("manuscript holds 3 chapters", countChaptersWritten(state.manuscript) === 3)
    check("status is completed", state.project?.status === "completed", state.project?.status)
    check("chapter 1 survived", state.manuscript.includes("The train ran on light"))
    check("memory has 2 summaries", state.project?.memory.chapterSummaries.length === 2)
  }

  /* ------------------------------------------ F: no work after completion */
  section("Test F — completion is final")
  {
    const before = useBookRun.getState().manuscript
    useBookRun.getState().tick()
    await new Promise((r) => setTimeout(r, 50))
    check("a tick after completion generates nothing", useBookRun.getState().manuscript === before)
    check("status stays completed", useBookRun.getState().project?.status === "completed")
  }

  /* ------------------------------------------------------------ B: pause */
  section("Test B — pause and resume")
  {
    reset()
    const { generator, calls } = makeGenerator((n) => ({
      ok: true,
      raw: chapterText(n, titles[n - 1] ?? `Chapter ${n}`),
    }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c2", brief: "b", manuscript: PLAN })

    // Pause while chapter 2 is in flight.
    await new Promise((r) => setTimeout(r, 0))
    useBookRun.getState().stopAfterCurrent()
    await settle()

    const paused = useBookRun.getState()
    check("the chapter in flight finished", paused.project!.written === 2, `${paused.project?.written}`)
    check("no chapter 3 started", !calls.includes(3), calls.join(","))
    check("status is paused", paused.project?.status === "paused", paused.project?.status)
    check("autoContinue is off", paused.project?.autoContinue === false)

    const actions = bookActions(paused.project!)
    check("paused offers Resume with Chapter 3", actions[0]?.label === "Resume with Chapter 3", actions[0]?.label)

    useBookRun.getState().resume()
    await settle()
    check("resume finished the book", useBookRun.getState().project?.written === 3)
    check("resume did not rewrite chapter 2", calls.filter((c) => c === 2).length === 1, calls.join(","))
  }

  /* --------------------------------------------------------- C: recovery */
  section("Test C — refresh recovery")
  {
    reset()
    const manuscript = `${PLAN}\n\n${chapterText(2, "The Bell in the Lake")}`
    const crashed: BookProject = {
      conversationId: "c3",
      title: "The Bell Under Wintermere",
      brief: "b",
      chapters: parseBookOutline(PLAN),
      status: "writing",
      currentChapter: 3,
      written: 2,
      autoContinue: true,
      memory: emptyBookMemory(),
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setBookRepository(new MemoryBookRepository())
    const repo = new MemoryBookRepository()
    setBookRepository(repo)
    repo.save(crashed)

    const { generator, calls } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, "x") }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().attach("c3", manuscript)
    await new Promise((r) => setTimeout(r, 60))

    const state = useBookRun.getState()
    check("a crashed run comes back paused", state.project?.status === "paused", state.project?.status)
    check("nothing generated on reopen", calls.length === 0, calls.join(","))
    check("progress recovered from the document", state.project?.written === 2)
    check("manuscript is intact", countChaptersWritten(state.manuscript) === 2)

    useBookRun.getState().resume()
    await settle()
    check("resume continues at chapter 3", calls[0] === 3, calls.join(","))
    check("no chapter was written twice", new Set(calls).size === calls.length, calls.join(","))
  }

  /* ------------------------------------------------- D: failure and repair */
  section("Test D — failure, repair, bounded retry")
  {
    reset()
    const { generator, calls } = makeGenerator((n, attempt) => {
      if (n === 2 && attempt < 3) return { ok: false, error: "model timeout" }
      return { ok: true, raw: chapterText(n, "x") }
    })
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c4", brief: "b", manuscript: PLAN })
    await settle()

    const state = useBookRun.getState()
    check("chapter 2 was retried", calls.filter((c) => c === 2).length === 3, calls.join(","))
    check("chapter 2 eventually landed", state.project!.written >= 2, `${state.project?.written}`)
    check("chapter 2 appears once in the manuscript", (state.manuscript.match(/##\s*Chapter 2\b/gi) ?? []).length === 1)
  }
  {
    reset()
    const { generator, calls } = makeGenerator(() => ({ ok: false, error: "always fails" }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c5", brief: "b", manuscript: PLAN })
    await settle()

    const state = useBookRun.getState()
    check("retries are bounded at 3 attempts", calls.length === 3, `${calls.length}`)
    check("status is failed", state.project?.status === "failed", state.project?.status)
    check("chapter 1 was not lost", countChaptersWritten(state.manuscript) === 1)
    check("failed offers Retry Chapter 2", bookActions(state.project!)[0]?.label === "Retry Chapter 2")

    const { generator: g2, calls: c2 } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, "x") }))
    useBookRun.getState().setGenerator(g2)
    useBookRun.getState().retryCurrent()
    await settle()
    check("retry recovers the run", useBookRun.getState().project?.status === "completed")
    check("retry did not duplicate chapter 2", c2.filter((c) => c === 2).length === 1, c2.join(","))
  }

  /* ------------------------------------------- duplicate-generation safety */
  section("Test H — duplicate generation")
  {
    reset()
    let concurrent = 0
    let maxConcurrent = 0
    const calls: number[] = []
    const generator: ChapterGenerator = async (request) => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      calls.push(request.chapter)
      await new Promise((r) => setTimeout(r, 5))
      concurrent -= 1
      return { ok: true, raw: chapterText(request.chapter, "x") }
    }
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c6", brief: "b", manuscript: PLAN })
    // Every way a duplicate trigger arrives: repeated effects, a resume click
    // during a run, and a burst in one tick.
    for (let i = 0; i < 8; i += 1) useBookRun.getState().tick()
    useBookRun.getState().resume()
    for (let i = 0; i < 8; i += 1) useBookRun.getState().tick()
    await settle()

    check("only one generation ran at a time", maxConcurrent === 1, `max ${maxConcurrent}`)
    check("each chapter was generated once", new Set(calls).size === calls.length, calls.join(","))
    check("manuscript has exactly 3 chapters", countChaptersWritten(useBookRun.getState().manuscript) === 3)
    check(
      "no chapter appears twice in the document",
      (useBookRun.getState().manuscript.match(/##\s*Chapter \d+/gi) ?? []).length === 3,
    )
  }

  /* --------------------------------------------- manual edit while paused */
  section("Test — manual edit while paused")
  {
    reset()
    const { generator, calls } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, "x") }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "c7", brief: "b", manuscript: PLAN })
    await settle()
    check("book completed first", useBookRun.getState().project?.status === "completed")

    // The reader deletes chapter 3 by hand.
    const trimmed = useBookRun.getState().manuscript.split(/##\s*Chapter 3/i)[0]!.trim()
    useBookRun.getState().resync(trimmed)
    const after = useBookRun.getState().project!
    check("deleting a chapter is noticed", after.written === 2, `${after.written}`)
    check("memory was truncated to match", after.memory.chapterSummaries.every((s) => s.chapter <= 2))

    useBookRun.getState().resume()
    await settle()
    check("resume rewrites the deleted chapter", calls.filter((c) => c === 3).length === 2, calls.join(","))
    check("book is complete again", useBookRun.getState().project?.status === "completed")
  }

  /* ------------------------------------------------------------- memory */
  section("Book memory and context")
  {
    let memory = emptyBookMemory()
    memory = applyChapterToMemory({
      memory,
      chapter: 1,
      title: "The Train",
      text: chapterText(1, "The Train"),
      raw: '[chapter-summary:"Mara arrives."]\n[carry:"Mara — a new pupil"]\n[thread-open:"bell — what rings under the lake"]',
    })
    memory = applyChapterToMemory({
      memory,
      chapter: 2,
      title: "The Bell",
      text: chapterText(2, "The Bell"),
      raw: '[chapter-summary:"The bell is heard."]\n[thread-resolved:"bell"]',
    })
    check("summaries accumulate", memory.chapterSummaries.length === 2)
    check("carries are recorded", memory.facts.some((f) => f.name === "Mara"))
    check("a thread opens and resolves", memory.threads[0]?.resolvedIn === 2)

    const rendered = renderMemoryForPrompt(memory, 2)
    check("memory renders for the prompt", rendered.includes("Mara") && /the book has covered/i.test(rendered))

    const project: BookProject = {
      conversationId: "c8",
      title: "The Bell Under Wintermere",
      brief: "a school book",
      chapters: parseBookOutline(PLAN),
      status: "writing",
      currentChapter: 3,
      written: 2,
      autoContinue: true,
      memory,
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    const manuscript = `${PLAN}\n\n${chapterText(2, "The Bell")}`
    const prompt = buildChapterPrompt({ project, manuscript, chapter: 3 })
    check("prompt names the chapter", prompt.includes("Write CHAPTER 3"))
    check("prompt carries the brief", prompt.includes("a school book"))
    check("prompt carries memory", prompt.includes("Mara"))
    check("prompt carries the tail", prompt.includes("MANUSCRIPT-TAIL"))
    check("prompt forbids running on", prompt.includes("Do not begin chapter 4"))
    check(
      "prompt is far smaller than the manuscript",
      prompt.length < manuscript.length,
      `${prompt.length} vs ${manuscript.length}`,
    )
  }

  /* --------------------------------------------------- G: contextual actions */
  section("Test G — contextual actions")
  {
    const base: BookProject = {
      conversationId: "c9",
      title: "t",
      brief: "b",
      chapters: parseBookOutline(PLAN),
      status: "writing",
      currentChapter: 2,
      written: 1,
      autoContinue: true,
      memory: emptyBookMemory(),
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    const writing = buildNextActions({ bookProject: base, hasCanvasDraft: true })
    check("writing never offers Continue", !writing.some((a) => /continue/i.test(a.label)))
    check("writing offers Pause first", writing[0]?.action === "book_stop_after", writing[0]?.label)

    const paused = buildNextActions({ bookProject: { ...base, status: "paused" }, hasCanvasDraft: true })
    check("paused offers Resume first", paused[0]?.action === "book_resume", paused[0]?.label)

    const completed = buildNextActions({
      bookProject: { ...base, status: "completed", written: 3 },
      hasCanvasDraft: true,
    })
    check("completed offers Polish first", completed[0]?.label === "Polish manuscript", completed[0]?.label)
    check("completed offers continuity", completed.some((a) => a.label === "Check continuity"))
    check("completed never offers Resume", !completed.some((a) => /resume/i.test(a.label)))

    const notes = buildNextActions({
      artifact: "study-notes",
      hasCanvasDraft: true,
      advisory: ["Tighten the section on tariffs"],
    })
    check("study notes offer a quiz", notes.some((a) => a.label === "Quiz me on this"))
    check("advisory suggestions are carried", notes.some((a) => a.label === "Tighten the section on tariffs"))
    check(
      "advisory suggestions edit the draft in place",
      Boolean(notes.find((a) => a.label === "Tighten the section on tariffs")?.prompt?.startsWith("/modify")),
    )
    check(
      "no generic filler when better actions exist",
      !notes.some((a) => /go deeper|explain simply/i.test(a.label)),
    )
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
