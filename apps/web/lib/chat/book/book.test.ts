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
  type BookRunSync,
  type ChapterGenerator,
} from "./book-orchestrator"
import {
  BOOK_CONTROL_TAGS,
  countChaptersWritten,
  hasBookControlTags,
  isBookContinueRequest,
  parseBookOutline,
  stripBookControlTags,
} from "./book-parser"
import { applyChapterToMemory, parseMemoryReport, renderMemoryForPrompt } from "./book-memory"
import { buildChapterPrompt } from "./book-prompts"
import { bookRepository, MemoryBookRepository, setBookRepository } from "./book-storage"
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
      formatProfile: "fiction",
      manuscript: PLAN,
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
      formatProfile: "fiction",
      manuscript: PLAN,
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
      formatProfile: "fiction",
      manuscript: PLAN,
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

}

void main().then(regressionSuite).then(metadataSuite).then(backgroundSuite)

/* ------------------------------------------------------- the real regression */
/**
 * The handoff that failed in production.
 *
 * A fresh chat has no conversation id when `/book` completes, so the plan is
 * adopted under a placeholder and the id arrives moments later. That fires the
 * attach effect, which treated every attach as a page reload and paused the
 * run — on the very first turn of every new book.
 */
async function regressionSuite() {
  section("Regression — conversation id arriving mid-run")
  {
    reset()
    const { generator, calls } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, "x") }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({
      conversationId: "__new__",
      brief: "a 3-chapter mystery",
      manuscript: PLAN,
    })
    check("the run starts writing", useBookRun.getState().project?.status === "writing")

    // Exactly what chat-page does once the turn persists.
    bookRepository().rekey("conv-real")
    useBookRun.getState().attach("conv-real", useBookRun.getState().manuscript)

    check(
      "attach does not pause a live run",
      useBookRun.getState().project?.status !== "paused",
      useBookRun.getState().project?.status,
    )

    await settle()
    check("chapters 2 and 3 still ran", calls.join(",") === "2,3", calls.join(","))
    check("the book completed", useBookRun.getState().project?.status === "completed")
    check("no chapter was written twice", new Set(calls).size === calls.length, calls.join(","))
  }

  section("Regression — attach in the gap between chapters")
  {
    reset()
    let secondDone = false
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      await new Promise((x) => setTimeout(x, 3))
      // Re-attach in the window where nothing is in flight — the case that
      // killed the run permanently rather than being rescued by luck.
      if (r.chapter === 2 && !secondDone) {
        secondDone = true
        setTimeout(() => useBookRun.getState().attach("conv-real", useBookRun.getState().manuscript), 0)
      }
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "conv-real", brief: "b", manuscript: PLAN })
    await settle()
    check("a mid-gap attach does not stop the run", calls.includes(3), calls.join(","))
    check("it still completes", useBookRun.getState().project?.status === "completed")
  }

  section("Regression — a genuine reload is still recovered as paused")
  {
    reset()
    const repo = new MemoryBookRepository()
    setBookRepository(repo)
    repo.save({
      conversationId: "conv-old",
      title: "t",
      brief: "b",
      chapters: parseBookOutline(PLAN),
      status: "writing",
      currentChapter: 2,
      written: 1,
      autoContinue: true,
      formatProfile: "fiction",
      manuscript: PLAN,
      memory: emptyBookMemory(),
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    })
    const { generator, calls } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, "x") }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().attach("conv-old", PLAN)
    await new Promise((r) => setTimeout(r, 40))
    check(
      "a run this session never started comes back paused",
      useBookRun.getState().project?.status === "paused",
      useBookRun.getState().project?.status,
    )
    check("and generates nothing on its own", calls.length === 0, calls.join(","))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}


/* ------------------------------------------------ metadata must never leak */
/**
 * The tags a real reader saw in the middle of their manuscript.
 *
 * The stripper knew `next` and `chapter-summary`; the memory instruction had
 * since grown `carry`, `thread-open` and `thread-resolved`, and those three
 * went into the document. One list now drives both, and these assert it.
 */
async function metadataSuite() {
  section("Metadata — every surface the reply reaches, not just the manuscript")
  {
    /**
     * The leak a real run caught. The orchestrator strips control tags on its
     * own path, so the manuscript was always clean — but the plan turn's reply
     * is *also* the chat message and the Canvas draft, and those went to the
     * database raw. A reader reopening their book conversation found the
     * model's internal `[carry:…]` and `[thread-open:…]` reports in it.
     *
     * The rule this pins: whatever the composer keeps from a book turn, it
     * keeps stripped. `stripBookControlTags` is the single gate, so asserting
     * it here covers the chat message, the draft and the Canvas together.
     */
    const planReply = `# The Room Under the Stacks

A short mystery about what a university keeps in its walls.

## Contents

1. The Door That Is Not on the Plan — Maya finds it
2. The Second Key — someone else has been down there
3. What the Register Says — the debt is older than the building

## Chapter 1: The Door That Is Not on the Plan

${"She counted the steps down and got a different answer each time. ".repeat(40)}

[chapter-summary:"Maya finds a paneled-over door in the sub-basement."]
[carry:"Maya Okafor — second-year history student, works nights"]
[thread-open:"the-card — who left a card with Maya's name in the drawer"]
[next:"Seed Tomas's thesis topic more visibly in chapter 1"]`

    const kept = stripBookControlTags(planReply)
    check("the prose survives", kept.includes("She counted the steps down"))
    check("the title survives", kept.includes("# The Room Under the Stacks"))
    check("the contents survive", kept.includes("## Contents"))
    check("no tag of any kind is left", !hasBookControlTags(kept), kept.slice(-160))
    for (const tag of BOOK_CONTROL_TAGS) {
      check(`[${tag}: is gone`, !kept.includes(`[${tag}:`))
    }
    check(
      "and nothing is left dangling at the end",
      !/\[[a-z-]+:\s*"?$/.test(kept.trim()),
      kept.trim().slice(-60),
    )
  }

  section("Metadata — stripping")
  {
    const raw = `## Chapter 2: Example

Actual prose.

[chapter-summary:"Summary"]
[carry:"Fact"]
[thread-open:"Question"]
[thread-resolved:"other"]
[next:"tighten the middle"]
`
    const clean = stripBookControlTags(raw)
    check("no tag survives", !hasBookControlTags(clean), clean.slice(-80))
    check("prose survives", clean.includes("Actual prose."))
    check("the heading survives", clean.startsWith("## Chapter 2: Example"))
    check("no trailing blank run", !/\n{3,}/.test(clean))

    const report = parseMemoryReport(raw)
    check("summary captured", report.summary === "Summary", report.summary)
    check("carry captured", report.carries[0]?.name === "Fact", report.carries[0]?.name)
    check("open thread captured", report.opened.length === 1)
    check("resolved thread captured", report.resolved[0] === "other", report.resolved[0])
  }

  section("Metadata — awkward values")
  {
    const raw = `## Chapter 3: X

She said "no" and left. It was Élodie's — the boy's — decision.

[carry:"Élodie — she's the prefect's sister"]
[carry:"the bell: rings at 3:15"]
[carry:"Mara — doesn't trust him"]
[carry:"the ledger — hidden"]
[thread-open:"who rang it — nobody saw"]

[chapter-summary:"A quote: she said "no" and left."]
`
    const clean = stripBookControlTags(raw)
    check("unicode and apostrophes stripped", !hasBookControlTags(clean), clean)
    check("a value with inner quotes is still removed", !clean.includes("A quote"))
    check("prose containing quotes is untouched", clean.includes('She said "no" and left.'))
    check(
      "prose containing an apostrophe is untouched",
      clean.includes("Élodie's — the boy's — decision"),
    )

    const report = parseMemoryReport(raw)
    check("four carries captured", report.carries.length === 4, `${report.carries.length}`)
    check("colon inside a value survives", report.carries[1]?.name === "the bell", report.carries[1]?.name)
    check("unicode name captured", report.carries[0]?.name === "Élodie", report.carries[0]?.name)
    check("blank-line-separated tag captured", report.opened.length === 1)
  }

  section("Metadata — a malformed tag costs a note, not the chapter")
  {
    const raw = `## Chapter 4: Y\n\n${"Prose here now. ".repeat(200)}\n\n[carry:"unterminated\n[chapter-summary:"Good"]\n`
    const clean = stripBookControlTags(raw)
    const v = validateChapter({ raw: clean, expected: 4 })
    check("the chapter still validates", v.ok, v.ok ? "" : v.rejection.code)
    check("the well-formed tag is still read", parseMemoryReport(raw).summary === "Good")
  }

  section("Metadata — end to end through a run")
  {
    reset()
    const { generator } = makeGenerator((n) => ({
      ok: true,
      raw: `${chapterText(n, "x")}\n\n[chapter-summary:"Ch ${n} happened."]\n[carry:"Mara — suspicious"]\n[thread-open:"bell — what rings"]\n[next:"expand the middle"]`,
    }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "cm", brief: "b", manuscript: PLAN })
    await settle()

    const state = useBookRun.getState()
    check("the stored manuscript is clean", !hasBookControlTags(state.manuscript))
    check("no tag text at all", !/\[(?:carry|thread-open|chapter-summary|next|thread-resolved):/i.test(state.manuscript))
    check("all 3 chapters present", countChaptersWritten(state.manuscript) === 3)
    check("memory still captured the summaries", state.project!.memory.chapterSummaries.length === 2)
    check("memory still captured the carries", state.project!.memory.facts.some((f) => f.name === "Mara"))
    check("threads still tracked", state.project!.memory.threads.length === 1)
    check(
      "word counts exclude the tags",
      state.project!.memory.chapterSummaries.every((s) => s.words > 100),
    )
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

/* -------------------------------------------- the run outlives the chat page */
/**
 * Navigating away must not stop a book.
 *
 * The transport, the lock and the scheduler are all module-level, so the only
 * thing that ever tied a run to `ChatPage` was a cleanup that unregistered the
 * generator. That registration moved to the app root; this asserts the property
 * that change was made for — a run survives the Canvas mirror being torn down
 * and reattached, and the manuscript written meanwhile is still there.
 */
async function backgroundSuite() {
  section("Background — generation survives Chat unmounting")
  {
    reset()
    let unmounted = false
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      // Chapter 2 is in flight when the reader leaves Chat.
      if (r.chapter === 2 && !unmounted) {
        unmounted = true
        useBookRun.getState().setOnManuscriptChange(null)
      }
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().setOnManuscriptChange(() => {})
    useBookRun.getState().startFromPlan({ conversationId: "nav", brief: "b", manuscript: PLAN })
    await settle()

    const state = useBookRun.getState()
    check("chapters kept coming after unmount", calls.join(",") === "2,3", calls.join(","))
    check("the book completed", state.project?.status === "completed", state.project?.status)
    check("no duplicates", new Set(calls).size === calls.length)
    check(
      "the manuscript is on the project, not in a component",
      countChaptersWritten(state.project!.manuscript) === 3,
      `${countChaptersWritten(state.project?.manuscript ?? "")}`,
    )
  }

  section("Background — returning to Chat sees the new chapters")
  {
    // Re-attaching is what a route change back to /chat does. The stored
    // manuscript must win over whatever stale text the caller has.
    const before = useBookRun.getState().project!.manuscript
    useBookRun.getState().attach("nav", "")
    const after = useBookRun.getState()
    check("the stored manuscript wins over an empty caller", after.manuscript === before)
    check("progress is intact", after.project?.written === 3)
    check("status is still completed", after.project?.status === "completed")
  }

  section("Background — a persisted project carries its manuscript")
  {
    const stored = bookRepository().load("nav")
    check("the repository holds the document", countChaptersWritten(stored?.manuscript ?? "") === 3)
    check("and no control tags", !hasBookControlTags(stored?.manuscript ?? ""))
  }

  section("Background — a fresh Chat mount cannot cancel a running book")
  {
    /**
     * The regression: `ChatPage` attaches with `conversationId` still null on
     * its first render and only learns the real id a beat later. That call
     * finds nothing stored under the placeholder key, and clearing the store
     * on that basis took the *running* book with it — the store is global, so
     * "this route has no book" was being written as "there is no book". The
     * run then stopped at the next tick with `no_project`, and a chapter
     * landing in the gap would have been appended to an empty manuscript.
     */
    reset()
    let leaving: () => void = () => {}
    const held = new Promise<void>((r) => {
      leaving = r
    })
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      if (r.chapter === 2) await held
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "live", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 20))

    const midManuscript = useBookRun.getState().manuscript
    check("chapter 2 is in flight", useBookRun.getState().streamingChapter === 2)

    // A route change back to /chat, before the deep link resolves.
    useBookRun.getState().attach(null, "")
    const afterProvisional = useBookRun.getState()
    check("the project survives", afterProvisional.project !== null)
    check(
      "and so does the manuscript",
      afterProvisional.manuscript === midManuscript,
      `${afterProvisional.manuscript.length} vs ${midManuscript.length}`,
    )
    check("the run is still writing", afterProvisional.project?.status === "writing")

    leaving()
    await settle()
    const done = useBookRun.getState()
    check("the book still finished", done.project?.status === "completed", done.project?.status)
    check(
      "with every chapter, not just the last",
      countChaptersWritten(done.project?.manuscript ?? "") === 3,
      `${countChaptersWritten(done.project?.manuscript ?? "")}`,
    )
    check("no chapter written twice", new Set(calls).size === calls.length, calls.join(","))
  }

  section("Background — a live run adopts the conversation id when it arrives")
  {
    /**
     * The regression the real run caught. `/book` on a fresh chat creates the
     * project under `__new__`, because the conversation row does not exist
     * yet. Chat rekeys the store once the first exchange is saved — but that
     * lands *after* `setConversationId`, so the attach fires first and finds
     * nothing under the real id. The run then stayed on the placeholder for
     * good: AI Tasks had no conversation to open, and every persist wrote to
     * `__new__` while the row the URL pointed at went stale.
     */
    reset()
    let held: () => void = () => {}
    const gate = new Promise<void>((r) => {
      held = r
    })
    const gen: ChapterGenerator = async (r) => {
      if (r.chapter === 2) await gate
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    // Exactly what the composer does before the conversation exists.
    useBookRun.getState().startFromPlan({ conversationId: "__new__", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 20))
    check("the run starts on the placeholder key", useBookRun.getState().project?.conversationId === "__new__")

    // The chat receives its id; storage has not been rekeyed yet.
    useBookRun.getState().attach("real-convo", "")
    const adopted = useBookRun.getState().project
    check("the project takes the real id", adopted?.conversationId === "real-convo", adopted?.conversationId)
    check("the run is untouched", adopted?.status === "writing", adopted?.status)
    check("nothing is left under the placeholder", bookRepository().load("__new__") === null)
    check("and it is stored under the real id", bookRepository().load("real-convo") !== null)

    held()
    await settle()
    const finished = useBookRun.getState().project
    check("the book finishes under the real id", finished?.conversationId === "real-convo")
    check("it completed", finished?.status === "completed", finished?.status)
    const persisted = bookRepository().load("real-convo")
    check(
      "the persisted row has every chapter, not a stale one",
      countChaptersWritten(persisted?.manuscript ?? "") === 3,
      `${countChaptersWritten(persisted?.manuscript ?? "")}`,
    )
  }

  section("Background — a live run is not dragged onto someone else's conversation")
  {
    // Adoption is only for the placeholder. A running book keyed to a real
    // conversation must not follow the reader into a different one.
    reset()
    const gen: ChapterGenerator = async () =>
      await new Promise(() => {}) as never
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "book-a", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 20))
    useBookRun.getState().attach("other-conversation", "")
    const after = useBookRun.getState().project
    check("it keeps its own conversation", after?.conversationId === "book-a", after?.conversationId)
    check("and is still running", after?.status === "writing", after?.status)
  }

  section("Background — a finished book is still cleared on a new chat")
  {
    // The guard above is for *running* work only. A completed project has
    // nothing in flight to protect, and leaving it on screen in a brand-new
    // conversation would be a different kind of wrong.
    reset()
    const { generator } = makeGenerator((n) => ({ ok: true, raw: chapterText(n, titles[n - 1] ?? `C${n}`) }))
    useBookRun.getState().setGenerator(generator)
    useBookRun.getState().startFromPlan({ conversationId: "done", brief: "b", manuscript: PLAN })
    await settle()
    const completed = useBookRun.getState().project
    check("the run really is finished", completed?.status === "completed", completed?.status)
    useBookRun.getState().attach(null, "")
    check("a new chat starts empty", useBookRun.getState().project === null)
  }


  section("Cross-device — an observer never generates")
  {
    /**
     * The failure this prevents costs real money. A second computer signed into
     * the same account reaches the scheduler with its own empty view, concludes
     * the same chapter is missing, and pays for it again — and the reader ends
     * up with two chapter fours.
     *
     * The server answers who owns the run; the session that does not own it
     * must not call the generator at all.
     */
    reset()
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    const sync: BookRunSync = {
      // Someone else is writing.
      publish: async () => ({ executedElsewhere: true }),
      heartbeat: async () => {},
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().setRunSync(sync)
    useBookRun.getState().startFromPlan({ conversationId: "obs", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 120))

    check("the observer generated nothing", calls.length === 0, calls.join(","))
    check(
      "and the manuscript was not touched",
      countChaptersWritten(useBookRun.getState().manuscript) === 1,
    )
  }

  section("Cross-device — the executor still writes normally")
  {
    reset()
    const calls: number[] = []
    const published: string[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    const sync: BookRunSync = {
      publish: async (input) => {
        published.push(input.status)
        return { executedElsewhere: false }
      },
      heartbeat: async () => {},
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().setRunSync(sync)
    useBookRun.getState().startFromPlan({ conversationId: "exec", brief: "b", manuscript: PLAN })
    await settle()

    check("the owner wrote the rest", calls.join(",") === "2,3", calls.join(","))
    check("it completed", useBookRun.getState().project?.status === "completed")
    check("progress reached the server", published.length > 0, `${published.length}`)
    check("including a completion", published.includes("COMPLETED"), published.join(","))
  }

  section("Cross-device — a sync outage does not stall the book")
  {
    // Status is nice to have; the book is the point. A server that cannot be
    // reached must not become a reason to stop writing.
    reset()
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().setRunSync({
      publish: async () => {
        throw new Error("network down")
      },
      heartbeat: async () => {},
    })
    useBookRun.getState().startFromPlan({ conversationId: "offline", brief: "b", manuscript: PLAN })
    await settle()
    check("the book still finished", useBookRun.getState().project?.status === "completed")
    check("every chapter was written", calls.join(",") === "2,3", calls.join(","))
  }

  section("Cross-device — hydrating from the server")
  {
    reset()
    const gen: ChapterGenerator = async (r) => ({ ok: true, raw: chapterText(r.chapter, "x") })
    useBookRun.getState().setGenerator(gen)

    const remoteManuscript = `${PLAN}\n\n${chapterText(2, "The Bell in the Lake")}`
    useBookRun.getState().hydrateFromServer("remote", {
      title: "The Bell Under Wintermere",
      status: "WRITING",
      totalChapters: 3,
      writtenChapters: 2,
      currentChapter: 3,
      manuscript: remoteManuscript,
      error: null,
      isExecutor: false,
      executedElsewhere: true,
    })

    const state = useBookRun.getState()
    check("the project appears", state.project !== null)
    check("with the remote title", state.project?.title === "The Bell Under Wintermere")
    check(
      "and the chapters already written",
      state.project?.written === 2,
      `${state.project?.written}`,
    )
    check(
      "the manuscript came with it",
      countChaptersWritten(state.manuscript) === 2,
      `${countChaptersWritten(state.manuscript)}`,
    )
    check(
      "the observer is not in a generating status",
      state.project?.status !== "writing",
      state.project?.status,
    )

    // And a tick must still do nothing.
    let generated = 0
    useBookRun.getState().setGenerator(async (r) => {
      generated += 1
      return { ok: true, raw: chapterText(r.chapter, "y") }
    })
    for (let i = 0; i < 4; i += 1) useBookRun.getState().tick()
    await new Promise((x) => setTimeout(x, 60))
    check("an observer tick generates nothing", generated === 0, `${generated}`)
  }

  section("Cross-device — the document still decides")
  {
    // The server says three are written; the manuscript contains one. The
    // manuscript wins, exactly as it always has.
    reset()
    useBookRun.getState().hydrateFromServer("disagree", {
      title: "Mismatch",
      status: "PAUSED",
      totalChapters: 3,
      writtenChapters: 3,
      currentChapter: 4,
      manuscript: PLAN,
      error: null,
      isExecutor: false,
      executedElsewhere: false,
    })
    const p = useBookRun.getState().project
    check("written comes from the headings", p?.written === 1, `${p?.written}`)
    check("so the next chapter is 2", p?.currentChapter === 2, `${p?.currentChapter}`)
  }

  section("Cross-device — the executor is not overwritten by its own echo")
  {
    reset()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    useBookRun.getState().setGenerator(async (r) => {
      if (r.chapter === 2) await gate
      return { ok: true, raw: chapterText(r.chapter, "x") }
    })
    useBookRun.getState().setRunSync({
      publish: async () => ({ executedElsewhere: false }),
      heartbeat: async () => {},
    })
    useBookRun.getState().startFromPlan({ conversationId: "echo", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 30))

    const before = useBookRun.getState().project?.status
    // The poll returns our own state back to us mid-chapter.
    useBookRun.getState().hydrateFromServer("echo", {
      title: "The Bell Under Wintermere",
      status: "WRITING",
      totalChapters: 3,
      writtenChapters: 1,
      currentChapter: 2,
      manuscript: PLAN,
      error: null,
      isExecutor: true,
      executedElsewhere: false,
    })
    check("the running status is untouched", useBookRun.getState().project?.status === before, before)

    release()
    await settle()
    check("and the book still finishes", useBookRun.getState().project?.status === "completed")
  }

  section("Background — slow first token")
  {
    reset()
    const calls: number[] = []
    const gen: ChapterGenerator = async (r) => {
      calls.push(r.chapter)
      // Long silence before any output, as a reasoning model does.
      await new Promise((x) => setTimeout(x, 60))
      r.onToken("first words")
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter, "x") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "slow", brief: "b", manuscript: PLAN })

    await new Promise((x) => setTimeout(x, 30))
    const mid = useBookRun.getState()
    check("still writing during the silence", mid.project?.status === "writing", mid.project?.status)
    check("the chapter is marked in flight", mid.streamingChapter === 2, `${mid.streamingChapter}`)
    check("no second operation started", calls.length === 1, calls.join(","))

    // Ticks during the wait — what a route change or a rerender would cause.
    for (let i = 0; i < 5; i += 1) useBookRun.getState().tick()
    check("ticks during thinking start nothing", calls.length === 1, calls.join(","))

    await settle(5000)
    check("it finishes normally", useBookRun.getState().project?.status === "completed")
    check("no duplicate chapters", new Set(calls).size === calls.length, calls.join(","))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}
