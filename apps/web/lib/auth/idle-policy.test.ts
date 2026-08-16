/**
 * The idle-logout policy, including its interaction with a running book.
 *
 * This is a security control, so the cases below are written to fail loudly if
 * someone later "simplifies" the deferral into an activity reset. The two
 * properties that matter:
 *
 *   1. With no AI task running, the control behaves exactly as it did before —
 *      same threshold, same outcome. The feature must not buy background work
 *      at the cost of everyone's session security.
 *   2. A running task defers the sign-out and never *resets* the idle clock, so
 *      the moment the task stops the expired threshold is honoured at once.
 *
 * The task states are driven through the real orchestrator rather than
 * hand-written booleans, so "running" cannot drift from what the sidebar shows.
 *
 * Run with:  node_modules/.bin/tsx lib/auth/idle-policy.test.ts
 */

import { decideIdleLogout } from "./idle-policy"
import {
  __resetBookOrchestratorForTests,
  useBookRun,
  type ChapterGenerator,
} from "../chat/book/book-orchestrator"
import { MemoryBookRepository, setBookRepository } from "../chat/book/book-storage"
import { hasActiveBackgroundAITask } from "../tasks/ai-tasks"

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

const IDLE_MS = 30 * 60_000

const PLAN = `# The Locked Stair

## Contents

1. One — the door
2. Two — the key
3. Three — the ledger

## Chapter 1: One

${"She counted the steps down and got a different answer each time. ".repeat(40)}
`

function chapterText(n: number): string {
  return `## Chapter ${n}: Title ${n}\n\n${"A sentence that carries the chapter forward without hurry at all. ".repeat(80)}`
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

async function settle(maxMs = 4000) {
  const started = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 10))
    const s = useBookRun.getState().project
    if (s && (s.status === "completed" || s.status === "failed" || s.status === "paused")) return
    if (Date.now() - started > maxMs) return
  }
}

async function main() {
  section("No AI task — the control is exactly what it was")
  {
    reset()
    check("no task is running", !hasActiveBackgroundAITask())
    check(
      "inside the threshold, nothing happens",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS - 1,
        backgroundTaskRunning: false,
      }) === "wait",
    )
    check(
      "at the threshold, sign out",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS,
        backgroundTaskRunning: false,
      }) === "logout",
    )
    check(
      "well past it, sign out",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS * 10,
        backgroundTaskRunning: false,
      }) === "logout",
    )
    check(
      "disabled means never",
      decideIdleLogout({
        idleEnabled: false,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS * 10,
        backgroundTaskRunning: false,
      }) === "wait",
    )
    check(
      "a zero threshold is treated as off, not as instant logout",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: 0,
        msSinceActivity: 1,
        backgroundTaskRunning: false,
      }) === "wait",
    )
  }

  section("A running task defers, it does not reset")
  {
    check(
      "past the threshold with work running, defer",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS + 1,
        backgroundTaskRunning: true,
      }) === "defer",
    )
    check(
      "hours later, still only a deferral",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: 8 * 60 * 60_000,
        backgroundTaskRunning: true,
      }) === "defer",
    )
    // The property that makes the deferral safe: the decision is a pure
    // function of elapsed time, so nothing about it can extend the window.
    // The instant the task stops, the same elapsed time gives "logout".
    check(
      "the moment work stops, the expired threshold is honoured immediately",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: 8 * 60 * 60_000,
        backgroundTaskRunning: false,
      }) === "logout",
    )
    check(
      "a running task cannot sign someone out early either",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: 5_000,
        backgroundTaskRunning: true,
      }) === "wait",
    )
    check(
      "and it cannot override the control being switched off",
      decideIdleLogout({
        idleEnabled: false,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS * 2,
        backgroundTaskRunning: true,
      }) === "wait",
    )
  }

  section("Against a real book — planning")
  {
    reset()
    useBookRun.getState().beginPlanning({ conversationId: null, brief: "a mystery" })
    check("planning counts as running", hasActiveBackgroundAITask())
    check(
      "so an expired session is held",
      decideIdleLogout({
        idleEnabled: true,
        idleMs: IDLE_MS,
        msSinceActivity: IDLE_MS + 1,
        backgroundTaskRunning: hasActiveBackgroundAITask(),
      }) === "defer",
    )
    useBookRun.getState().endPlanning()
    check("a plan turn that ends releases the hold", !hasActiveBackgroundAITask())
  }

  section("Against a real book — writing, then completed")
  {
    reset()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const gen: ChapterGenerator = async (r) => {
      if (r.chapter === 2) await gate
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter) }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "idle", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 20))

    check("a writing book is running", hasActiveBackgroundAITask())
    const held = decideIdleLogout({
      idleEnabled: true,
      idleMs: IDLE_MS,
      msSinceActivity: IDLE_MS + 60_000,
      backgroundTaskRunning: hasActiveBackgroundAITask(),
    })
    check("an idle session is held open while it writes", held === "defer", held)

    release()
    await settle()
    check(
      "the book finished",
      useBookRun.getState().project?.status === "completed",
      useBookRun.getState().project?.status,
    )
    check("a completed book is not running", !hasActiveBackgroundAITask())
    const afterDone = decideIdleLogout({
      idleEnabled: true,
      idleMs: IDLE_MS,
      // The clock was never reset, so it is still long past the threshold.
      msSinceActivity: IDLE_MS + 60_000,
      backgroundTaskRunning: hasActiveBackgroundAITask(),
    })
    check("and the deferred sign-out happens at once", afterDone === "logout", afterDone)
  }

  section("Against a real book — paused does not hold a session open")
  {
    reset()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const gen: ChapterGenerator = async (r) => {
      if (r.chapter === 2) await gate
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter) }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "paused", brief: "b", manuscript: PLAN })
    await new Promise((x) => setTimeout(x, 20))
    useBookRun.getState().stopAfterCurrent()
    release()
    await settle()

    check(
      "the book is paused",
      useBookRun.getState().project?.status === "paused",
      useBookRun.getState().project?.status,
    )
    check("a paused book is not running", !hasActiveBackgroundAITask())
    const decision = decideIdleLogout({
      idleEnabled: true,
      idleMs: IDLE_MS,
      msSinceActivity: IDLE_MS + 1,
      backgroundTaskRunning: hasActiveBackgroundAITask(),
    })
    check("so the session signs out normally", decision === "logout", decision)
  }

  section("Against a real book — failed does not hold a session open")
  {
    reset()
    const gen: ChapterGenerator = async () => ({ ok: false, error: "provider is down" })
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "failed", brief: "b", manuscript: PLAN })
    await settle()

    check(
      "the book failed",
      useBookRun.getState().project?.status === "failed",
      useBookRun.getState().project?.status,
    )
    check("a failed book is not running", !hasActiveBackgroundAITask())
    const decision = decideIdleLogout({
      idleEnabled: true,
      idleMs: IDLE_MS,
      msSinceActivity: IDLE_MS + 1,
      backgroundTaskRunning: hasActiveBackgroundAITask(),
    })
    check("so the session signs out normally", decision === "logout", decision)
  }

  section("Against a real book — the whole sequence, on a shortened threshold")
  {
    /**
     * The acceptance shape, without a thirty-minute wait or a paid book: the
     * threshold is crossed while a chapter is in flight, the reader stays
     * signed in, the book carries on, and the sign-out lands as soon as it
     * finishes.
     */
    reset()
    const SHORT_IDLE = 50
    const decisions: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const gen: ChapterGenerator = async (r) => {
      if (r.chapter === 2) await gate
      await new Promise((x) => setTimeout(x, 5))
      return { ok: true, raw: chapterText(r.chapter) }
    }
    useBookRun.getState().setGenerator(gen)
    useBookRun.getState().startFromPlan({ conversationId: "seq", brief: "b", manuscript: PLAN })

    const lastActivity = Date.now()
    // The watcher's timer, sped up. `lastActivity` is never touched — exactly
    // as in the component.
    const tick = () =>
      decideIdleLogout({
        idleEnabled: true,
        idleMs: SHORT_IDLE,
        msSinceActivity: Date.now() - lastActivity,
        backgroundTaskRunning: hasActiveBackgroundAITask(),
      })

    for (let i = 0; i < 8; i += 1) {
      await new Promise((x) => setTimeout(x, 20))
      decisions.push(tick())
    }
    check(
      "the threshold was crossed during generation",
      decisions.includes("defer"),
      decisions.join(","),
    )
    check(
      "and it never signed out while writing",
      !decisions.includes("logout"),
      decisions.join(","),
    )
    check("the book is still going", useBookRun.getState().project?.status === "writing")

    release()
    await settle()
    check("the book finished", useBookRun.getState().project?.status === "completed")
    check("and now the sign-out lands", tick() === "logout", tick())
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
