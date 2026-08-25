import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Title and Summarize must stay usable while a transcript is running.
 *
 * The tabs share one transcript, so they are not independent in the data —
 * but they must be independent in the interface. Asking for a title while a
 * transcript is being prepared has to queue onto the running job, not hide
 * the button behind "Waiting for transcript…" until the other tab finishes.
 *
 * There is no DOM environment in this suite, so these are contract checks on
 * the source. They are narrow on purpose: each one pins a specific regression.
 */

const COMPONENTS = join(process.cwd(), "apps/web/components/libraries")
const title = readFileSync(join(COMPONENTS, "video-ai-title.tsx"), "utf8")
const summarize = readFileSync(join(COMPONENTS, "video-ai-summarize.tsx"), "utf8")

const tabs: [string, string, string][] = [
  ["Title", title, "generate-ai-title"],
  ["Summarize", summarize, "generate-ai-summary"],
]

describe.each(tabs)("%s tab", (_name, source, testId) => {
  it("keeps its generate button when a transcript is already running", () => {
    // The regression: `transcriptRunning ? <waiting text> : <Button>` removed
    // the only way to start, so the tab was dead until the transcript landed.
    const gated = new RegExp(
      `transcriptRunning\\s*\\?[\\s\\S]{0,400}?data-testid="${testId}"`,
    )
    expect(source).not.toMatch(gated)
    expect(source).toContain(`data-testid="${testId}"`)
  })

  it("never renders a dead-end 'Waiting for transcript' in place of the button", () => {
    expect(source).not.toContain("Waiting for transcript…")
  })

  it("queues onto a running transcript instead of starting a second one", () => {
    expect(source).toContain("if (!transcriptRunning) onGenerateTranscript()")
  })

  it("still starts a transcript when none is running", () => {
    expect(source).toMatch(/setAwaitingTranscript\(true\)/)
    expect(source).toMatch(/onGenerateTranscript\(\)/)
  })

  it("tells the reader the request is queued rather than blocked", () => {
    expect(source).toMatch(/A transcript is being prepared/)
  })
})
