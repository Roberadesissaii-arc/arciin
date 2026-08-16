/**
 * What the shell says about a running book.
 *
 * The indicator's whole value is that it is honest — a badge that says
 * "running" over a finished book, or "Chapter 3" over a chapter that has not
 * started, is worse than no badge at all. Every label below is asserted
 * against a project state that can actually occur, and the live-run cases are
 * driven through the real orchestrator rather than hand-built, so the derived
 * view and the run cannot drift apart.
 *
 * Run with:  node_modules/.bin/tsx lib/tasks/ai-tasks.test.ts
 */

import { deriveBookTask, isTaskRunning } from "./ai-tasks"
import {
  __resetBookOrchestratorForTests,
  useBookRun,
  type ChapterGenerator,
} from "../chat/book/book-orchestrator"
import { MemoryBookRepository, setBookRepository } from "../chat/book/book-storage"
import { emptyBookMemory, type BookProject } from "../chat/book/types"

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

const PLAN = `# The Ledger of Later

## Contents

1. The Locked Stair — a door that is not on the plan
2. The Second Key — who else has been down there
3. What the Ledger Says — the debt is older than the building

## Chapter 1: The Locked Stair

${"She counted the steps down and got a different answer each time. ".repeat(40)}
`

function chapterText(n: number, title: string): string {
  return `## Chapter ${n}: ${title}\n\n${"A sentence that carries the chapter forward without hurry. ".repeat(60)}\n\n[chapter-summary:"Chapter ${n} happened."]`
}

function project(over: Partial<BookProject> = {}): BookProject {
  return {
    conversationId: "convo-1",
    title: "The Ledger of Later",
    brief: "a short mystery",
    chapters: [
      { number: 1, title: "The Locked Stair", summary: "" },
      { number: 2, title: "The Second Key", summary: "" },
      { number: 3, title: "What the Ledger Says", summary: "" },
    ],
    status: "writing",
    currentChapter: 2,
    written: 1,
    autoContinue: true,
    formatProfile: "fiction",
    manuscript: PLAN,
    memory: emptyBookMemory(),
    attempts: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
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
    phase: null,
    operationId: null,
    lastRejection: null,
    planning: null,
  })
}

async function settle(ms = 2000) {
  const started = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 10))
    const s = useBookRun.getState()
    if (s.project && (s.project.status === "completed" || s.project.status === "failed")) return
    if (Date.now() - started > ms) return
  }
}

async function main() {
  section("Nothing to show")
  {
    const task = deriveBookTask({
      project: null,
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("no book, no task", task === null)
  }

  section("The opening turn, before there is a plan")
  {
    const task = deriveBookTask({
      project: null,
      streamingChapter: null,
      phase: null,
      planning: { conversationId: null, brief: "Write a short 3-chapter mystery about a student" },
    })
    check("a task exists", task !== null)
    check("it says planning", task?.status === "Planning", task?.status)
    check("it counts as running", task !== null && isTaskRunning(task))
    check("no invented chapter count", task?.total === undefined, String(task?.total))
    check(
      "the brief stands in for a title",
      task?.title.startsWith("Write a short 3-chapter mystery") ?? false,
      task?.title,
    )
    check("no link before the chat has an id", task?.conversationId === undefined)
  }

  section("Phases are reported, not guessed")
  {
    const cases: Array<[Parameters<typeof deriveBookTask>[0]["phase"], string]> = [
      ["thinking", "Thinking · Chapter 2"],
      ["writing", "Writing Chapter 2"],
      ["validating", "Validating Chapter 2"],
      ["saving", "Saving Chapter 2"],
    ]
    for (const [phase, expected] of cases) {
      const task = deriveBookTask({
        project: project(),
        streamingChapter: 2,
        phase,
        planning: null,
      })
      check(`${phase} → ${expected}`, task?.status === expected, task?.status)
    }
  }

  section("Between chapters")
  {
    const task = deriveBookTask({
      project: project(),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("the gap is named", task?.status === "Starting Chapter 2", task?.status)
    check("still running", task !== null && isTaskRunning(task))
    check("progress is chapters written", task?.current === 1 && task?.total === 3)
  }

  section("Stopping says what will happen")
  {
    const task = deriveBookTask({
      project: project({ status: "stopping" }),
      streamingChapter: 2,
      phase: "writing",
      planning: null,
    })
    check(
      "it finishes then pauses",
      task?.status === "Writing Chapter 2 · pausing after this",
      task?.status,
    )
    check("still counted as running", task !== null && isTaskRunning(task))
  }

  section("Paused, failed, completed")
  {
    const paused = deriveBookTask({
      project: project({ status: "paused", autoContinue: false }),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("paused names the next chapter", paused?.status === "Paused · Chapter 2 next", paused?.status)
    check("paused is not running", paused !== null && !isTaskRunning(paused))

    const failedTask = deriveBookTask({
      project: project({ status: "failed", lastError: "boom" }),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("failed says failed", failedTask?.status === "Failed", failedTask?.status)
    check("failed is not running", failedTask !== null && !isTaskRunning(failedTask))

    const done = deriveBookTask({
      project: project({ status: "completed", written: 3, currentChapter: 4 }),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("completed says completed", done?.status === "Completed", done?.status)
    check("completed is NOT running", done !== null && !isTaskRunning(done))
    check("completed still shows 3 / 3", done?.current === 3 && done?.total === 3)
  }

  section("Clicking a task can find its conversation")
  {
    const task = deriveBookTask({
      project: project({ conversationId: "abc-123" }),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check("it carries the conversation id", task?.conversationId === "abc-123", task?.conversationId)

    const pending = deriveBookTask({
      project: project({ conversationId: "__new__" }),
      streamingChapter: null,
      phase: null,
      planning: null,
    })
    check(
      "the placeholder key is not offered as a link",
      pending?.conversationId === undefined,
      pending?.conversationId,
    )
  }

  section("Against a real run")
  {
    reset()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const gen: ChapterGenerator = async (r) => {
      if (r.chapter === 2) await gate
      r.onToken("first words")
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter, "t") }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().beginPlanning({ conversationId: null, brief: "a short mystery" })

    const planningTask = deriveBookTask(useBookRun.getState())
    check("planning is visible before the project exists", planningTask?.state === "planning")

    useBookRun.getState().startFromPlan({ conversationId: "live", brief: "b", manuscript: PLAN })
    check("the planning placeholder is cleared", useBookRun.getState().planning === null)

    await new Promise((x) => setTimeout(x, 20))
    const mid = deriveBookTask(useBookRun.getState())
    check("the live run reports chapter 2", /Chapter 2/.test(mid?.status ?? ""), mid?.status)
    check("the live run counts as running", mid !== null && isTaskRunning(mid))
    check("it shows 1 of 3", mid?.current === 1 && mid?.total === 3, `${mid?.current}/${mid?.total}`)
    check("the title comes from the manuscript", mid?.title === "The Ledger of Later", mid?.title)

    release()
    await settle(4000)

    const done = deriveBookTask(useBookRun.getState())
    check("it ends completed", done?.state === "completed", done?.state)
    check("and stops counting as running", done !== null && !isTaskRunning(done), done?.status)
    check("with every chapter counted", done?.current === 3 && done?.total === 3)
  }

  section("A plan turn that fails leaves no badge behind")
  {
    reset()
    useBookRun.getState().beginPlanning({ conversationId: null, brief: "a book" })
    check("running while planning", deriveBookTask(useBookRun.getState()) !== null)
    useBookRun.getState().endPlanning()
    check("nothing left after the failure", deriveBookTask(useBookRun.getState()) === null)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
